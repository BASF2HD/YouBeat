import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Album, RenderSettings } from '../shared/types';
import { scanForAlbums, ScanProgress } from './scanner';
import { parseAlbumFolder } from './metadata';
import { queueManager } from './queueManager';
import { readJewelCaseOverlay } from './jewelCaseAsset';
import { runPackagedSelfTest } from './releaseSelfTest';
import { testFfmpegPath, getAvailableHwEncoders, ensureOutputWritable } from './ffmpegService';
// Suppress benign Electron dev-time security warnings
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.setName('YouBeat');

// Copy the previous profile once so renaming does not reset settings or edits.
// Leave the old profile intact as a recoverable backup.
const releaseTest = process.argv.includes('--desktop-self-test');
const testProfile = process.argv.find(arg => arg.startsWith('--test-profile='))?.slice('--test-profile='.length);
if (releaseTest && (!testProfile || !path.isAbsolute(testProfile))) throw new Error('Release self-test requires an isolated absolute --test-profile');
const profilePath = releaseTest ? testProfile! : path.join(app.getPath('appData'), 'YouBeat');
const previousProfilePath = path.join(app.getPath('appData'), 'AlbumForge Studio');
if (!releaseTest && !fs.existsSync(profilePath) && fs.existsSync(previousProfilePath)) {
  fs.cpSync(previousProfilePath, profilePath, { recursive: true, errorOnExist: true });
}
app.setPath('userData', profilePath);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const appIconPath = path.join(__dirname, '../../resources/youbeat-icon.png');

  if (process.platform === 'darwin' && fs.existsSync(appIconPath)) {
    app.dock?.setIcon(appIconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    show: true,
    title: 'YouBeat',
    icon: appIconPath,
    frame: true, // Native frames are most reliable on Windows
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0c', // Dark modern backdrop matches theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Attach window to QueueManager so it can emit logs & progress
  queueManager.setMainWindow(mainWindow);

  // Load from local built files by default. If VITE_DEV_SERVER environment variable is set to 'true', load dev server.
  if (process.env.VITE_DEV_SERVER === 'true') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    if (!app.isPackaged && process.env.OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Enable single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    if (releaseTest && mainWindow) {
      const testWindow = mainWindow;
      testWindow.webContents.once('did-finish-load', () => {
        runPackagedSelfTest(testWindow).catch(error => { console.error(error); app.exit(1); });
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// =============================================================================
// Persistent Scan Cache
// =============================================================================
// Caches parsed Albums on disk so re-scanning the same root is near-instant.
// Each rootFolder+recursive combo has its own cache entry. Each album in the
// entry is keyed by folderPath with a fingerprint = sorted list of
// (fileName, size, mtimeMs). If the fingerprint matches, the cached Album is
// reused instead of re-parsing metadata/embedded covers over the network.

interface CachedAlbumEntry {
  fingerprint: string;
  cachedAt: number;
  album: Album;
}

interface ScanCacheFile {
  version: 1;
  libraries: Record<string, {
    cachedAt: number;
    recursive: boolean;
    rootFolder: string;
    albums: Record<string, CachedAlbumEntry>;
  }>;
}

function scanCachePath(): string {
  return path.join(app.getPath('userData'), 'scan_cache.json');
}

async function loadScanCache(): Promise<ScanCacheFile> {
  try {
    const p = scanCachePath();
    if (fs.existsSync(p)) {
      const data = await fs.promises.readFile(p, 'utf-8');
      const parsed = JSON.parse(data) as ScanCacheFile;
      if (parsed && parsed.version === 1 && parsed.libraries) return parsed;
    }
  } catch (err) {
    console.warn('Failed to load scan cache, starting fresh:', (err as Error).message);
  }
  return { version: 1, libraries: {} };
}

async function saveScanCache(cache: ScanCacheFile): Promise<void> {
  try {
    const p = scanCachePath();
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, JSON.stringify(cache), 'utf-8');
  } catch (err) {
    console.warn('Failed to persist scan cache:', (err as Error).message);
  }
}

function cacheKeyFor(rootFolder: string, recursive: boolean): string {
  // Short, deterministic, filesystem-safe key for each (root, recursive) pair
  const raw = `${recursive ? '1' : '0'}::${rootFolder}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Fast fingerprint of a folder = sorted list of (name, size, mtimeMs) for
 * audio + cover image files. This is cheap even for network folders because
 * it does 1 readdir + per-file stat (no file content reads, no metadata parse).
 */
async function fingerprintAlbumFolder(folderPath: string): Promise<string | null> {
  try {
    const names = await fs.promises.readdir(folderPath);
    const stats: string[] = [];
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!AUDIO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) continue;
      try {
        const s = await fs.promises.stat(path.join(folderPath, name));
        if (!s.isFile()) continue;
        stats.push(`${name}|${s.size}|${Math.round(s.mtimeMs)}`);
      } catch {
        // Per-file stat failures are ignored (permissions, locked files, etc.)
      }
    }
    stats.sort();
    return crypto.createHash('sha1').update(stats.join('\n')).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Quickly validate whether a folder still looks like an album folder
 * (1 readdir, 0 metadata reads). Used so we skip fingerprinting/fingerprint
 * checks on folders that don't contain audio anymore.
 */
async function folderHasAudioFiles(folderPath: string): Promise<boolean> {
  try {
    const names = await fs.promises.readdir(folderPath);
    return names.some(n => AUDIO_EXTS.has(path.extname(n).toLowerCase()));
  } catch {
    return false;
  }
}

// =============================================================================
// IPC Handler registration
// =============================================================================
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('get-jewel-case-overlay', () => readJewelCaseOverlay());

ipcMain.handle('copy-text', (_event, text: string): void => {
  clipboard.writeText(text);
});

ipcMain.handle('scan-albums', async (_event, rootFolder: string, recursive: boolean): Promise<Album[]> => {
  try {
    const emitProgress = (progress: ScanProgress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scan-progress', progress);
      }
    };

    const cacheKey = cacheKeyFor(rootFolder, recursive);
    const scanCache = await loadScanCache();
    const cachedLibrary = scanCache.libraries[cacheKey];
    const tempCoversDir = path.join(app.getPath('userData'), 'temp_covers');

    // Always rediscover directory membership: validating only cached folders
    // cannot detect newly added albums. Keep the expensive metadata cache below.
    const folders = await scanForAlbums(rootFolder, recursive, emitProgress);

    // ---- Cache validation phase: figure out which folders are cache hits ----
    const FINGERPRINT_CONCURRENCY = 12;
    const fingerprints = new Map<string, string | null>();
    let fpProcessed = 0;

    for (let i = 0; i < folders.length; i += FINGERPRINT_CONCURRENCY) {
      const chunk = folders.slice(i, i + FINGERPRINT_CONCURRENCY);
      await Promise.all(
        chunk.map(async (folder) => {
          try {
            // Fast shortcut: if folder has no audio anymore, skip fingerprinting
            if (!(await folderHasAudioFiles(folder))) {
              fingerprints.set(folder, null);
              return;
            }
            const fp = await fingerprintAlbumFolder(folder);
            fingerprints.set(folder, fp);
          } catch {
            fingerprints.set(folder, null);
          } finally {
            fpProcessed++;
            emitProgress({
              phase: 'parsing',
              current: Math.min(fpProcessed, folders.length),
              total: folders.length,
              currentFolder: folder,
              foldersFound: folders.length
            });
          }
        })
      );
    }

    // Categorize each folder: cache hit (valid) vs needs fresh parse
    const albums: Album[] = [];
    const freshParseNeeded: string[] = [];
    let cacheHits = 0;

    for (const folder of folders) {
      const fp = fingerprints.get(folder);
      const cachedEntry = cachedLibrary?.albums?.[folder];
      if (fp && cachedEntry && cachedEntry.fingerprint === fp) {
        albums.push(cachedEntry.album);
        cacheHits++;
      } else if (fp !== null) {
        freshParseNeeded.push(folder);
      }
    }

    console.log(`[ScanCache] ${cacheHits} cache hits, ${freshParseNeeded.length} albums need fresh parse (${folders.length} total)`);

    // ---- Fresh parse phase: only for cache misses / changed folders ----
    const CONCURRENCY = 8;
    const cacheWrites: Array<{ folder: string; fp: string; album: Album }> = [];
    let freshCount = 0;
    const alreadyProcessed = folders.length - freshParseNeeded.length;

    for (let i = 0; i < freshParseNeeded.length; i += CONCURRENCY) {
      const chunk = freshParseNeeded.slice(i, i + CONCURRENCY);
      const parsedChunk = await Promise.all(
        chunk.map(async (folder) => {
          try {
            emitProgress({
              phase: 'parsing',
              current: alreadyProcessed + freshCount,
              total: folders.length,
              currentFolder: folder,
              foldersFound: folders.length
            });

            const album = await Promise.race([
              parseAlbumFolder(folder, tempCoversDir),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout parsing album: ${folder}`)), 15_000)
              )
            ]);
            return album.tracks.length > 0 ? album : null;
          } catch (err: any) {
            console.error(`Skipping folder "${folder}": ${err.message}`);
            return null;
          } finally {
            freshCount++;
            emitProgress({
              phase: 'parsing',
              current: Math.min(alreadyProcessed + freshCount, folders.length),
              total: folders.length,
              currentFolder: folder,
              foldersFound: folders.length
            });
          }
        })
      );

      for (let j = 0; j < parsedChunk.length; j++) {
        const item = parsedChunk[j];
        if (item) {
          albums.push(item);
          const fp = fingerprints.get(chunk[j]);
          if (fp) {
            cacheWrites.push({ folder: chunk[j], fp, album: item });
          }
        }
      }
    }

    emitProgress({
      phase: 'parsing',
      current: folders.length,
      total: folders.length,
      currentFolder: '',
      foldersFound: folders.length
    });

    // Merge cached metadata edits to restore custom titles/artists
    const metadataCache = await queueManager.loadMetadataCache();
    for (const album of albums) {
      const cachedAlbum = metadataCache[album.id];
      if (cachedAlbum) {
        if (cachedAlbum.albumName) album.albumName = cachedAlbum.albumName;
        if (cachedAlbum.year) album.year = cachedAlbum.year;
        
        // Merge track details
        if (cachedAlbum.tracks && Array.isArray(cachedAlbum.tracks)) {
          for (const cachedTrack of cachedAlbum.tracks) {
            const track = album.tracks.find(t => t.id === cachedTrack.id);
            if (track) {
              if (cachedTrack.title) track.title = cachedTrack.title;
              if (cachedTrack.artist) track.artist = cachedTrack.artist;
              if (typeof cachedTrack.trackNumber === 'number') {
                track.trackNumber = cachedTrack.trackNumber;
              }
            }
          }
          // Re-sort tracks after merging cached track numbers
          album.tracks.sort((a, b) => a.trackNumber - b.trackNumber);
        }
      }
    }

    // Persist new/updated scan cache entry for this library
    try {
      const libraryEntry = {
        cachedAt: Date.now(),
        recursive,
        rootFolder,
        albums: { ...(cachedLibrary?.albums || {}) } as Record<string, CachedAlbumEntry>
      };
      for (const { folder, fp, album } of cacheWrites) {
        libraryEntry.albums[folder] = {
          fingerprint: fp,
          cachedAt: Date.now(),
          album
        };
      }
      // Drop entries for folders that no longer appear in the scan results
      const folderSet = new Set(folders);
      for (const existingFolder of Object.keys(libraryEntry.albums)) {
        if (!folderSet.has(existingFolder)) {
          delete libraryEntry.albums[existingFolder];
        }
      }
      scanCache.libraries[cacheKey] = libraryEntry;
      await saveScanCache(scanCache);
      console.log('[ScanCache] Persisted scan cache.');
    } catch (err) {
      console.warn('[ScanCache] Failed to persist cache (non-fatal):', err);
    }

    return albums;
  } catch (err) {
    console.error('Scan albums failed:', err);
    throw err;
  }
});

ipcMain.handle('save-album-metadata', async (_event, albumId: string, updatedAlbum: Album): Promise<boolean> => {
  return queueManager.saveAlbumMetadata(albumId, updatedAlbum);
});

ipcMain.handle('render-album', async (_event, albumId: string, settings: RenderSettings) => {
  // Retrieve the loaded album folder contents
  const tempCoversDir = path.join(app.getPath('userData'), 'temp_covers');
  const album = await parseAlbumFolder(albumId, tempCoversDir);
  
  // Merge cache before queueing
  const cache = await queueManager.loadMetadataCache();
  const cached = cache[albumId];
  if (cached) {
    if (cached.albumName) album.albumName = cached.albumName;
    if (cached.year) album.year = cached.year;
    if (cached.tracks && Array.isArray(cached.tracks)) {
      for (const ct of cached.tracks) {
        const t = album.tracks.find(tr => tr.id === ct.id);
        if (t) {
          if (ct.title) t.title = ct.title;
          if (ct.artist) t.artist = ct.artist;
          if (typeof ct.trackNumber === 'number') t.trackNumber = ct.trackNumber;
        }
      }
      album.tracks.sort((a, b) => a.trackNumber - b.trackNumber);
    }
  }

  await queueManager.addToQueue([album], settings);
});

ipcMain.handle('render-all', async (_event, albums: Album[], settings: RenderSettings) => {
  await queueManager.addToQueue(albums, settings);
});

ipcMain.handle('pause-queue', () => {
  queueManager.pause();
});

ipcMain.handle('resume-queue', () => {
  queueManager.resume();
});

ipcMain.handle('cancel-queue', () => {
  queueManager.cancel();
});

ipcMain.handle('get-ffmpeg-version', async (_event, pathStr: string): Promise<string> => {
  try {
    return await testFfmpegPath(pathStr);
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
});

ipcMain.handle('get-hw-accelerators', async (): Promise<Array<{ id: string; name: string; available: boolean }>> => {
  try {
    return await getAvailableHwEncoders('ffmpeg');
  } catch (err) {
    console.error('Failed to get HW encoders:', err);
    return [];
  }
});

ipcMain.handle('open-folder', async (_event, folderPathStr: string): Promise<void> => {
  try {
    if (!fs.existsSync(folderPathStr)) {
      fs.mkdirSync(folderPathStr, { recursive: true });
    }
    await shell.openPath(folderPathStr);
  } catch (err) {
    console.error('Failed to open or create folder:', err);
    try {
      const parent = path.dirname(folderPathStr);
      if (fs.existsSync(parent)) {
        await shell.openPath(parent);
      }
    } catch (parentErr) {
      console.error('Failed to open parent directory:', parentErr);
    }
  }
});

ipcMain.handle('open-video', async (_event, videoPath: string): Promise<void> => {
  if (typeof videoPath !== 'string' || path.extname(videoPath).toLowerCase() !== '.mp4') {
    throw new Error('Invalid video path.');
  }
  const stat = await fs.promises.stat(videoPath);
  if (!stat.isFile()) {
    throw new Error('The rendered video is no longer available.');
  }
  const error = await shell.openPath(videoPath);
  if (error) throw new Error(error);
});

ipcMain.handle('clear-scan-cache', async (): Promise<boolean> => {
  try {
    const p = scanCachePath();
    if (fs.existsSync(p)) {
      await fs.promises.unlink(p);
    }
    return true;
  } catch (err) {
    console.error('Failed to clear scan cache:', err);
    return false;
  }
});

ipcMain.handle('test-output-writable', async (_event, outDir: string): Promise<{ ok: boolean; message: string }> => {
  try {
    if (!outDir) {
      return { ok: false, message: 'No output folder specified.' };
    }
    await ensureOutputWritable(outDir);
    return { ok: true, message: `Output folder "${outDir}" is writable.` };
  } catch (err: any) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('get-default-output-folder', async (): Promise<string> => {
  const base = app.getPath('videos') || app.getPath('userData');
  const out = path.join(base, 'YouBeat');
  try {
    await fs.promises.mkdir(out, { recursive: true });
  } catch {
    // Fallback to userData if Videos dir is unavailable for any reason
    return path.join(app.getPath('userData'), 'Output');
  }
  return out;
});
