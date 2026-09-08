import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Album, RenderSettings } from '../shared/types';
import { scanForAlbums } from './scanner';
import { parseAlbumFolder } from './metadata';
import { queueManager } from './queueManager';
import { testFfmpegPath, getAvailableHwEncoders } from './ffmpegService';

// Suppress benign Electron dev-time security warnings
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    show: true,
    title: 'Bulk Album Video Generator',
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
    if (!app.isPackaged) {
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

// IPC Handler registration
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

ipcMain.handle('scan-albums', async (_event, rootFolder: string, recursive: boolean): Promise<Album[]> => {
  try {
    const folders = await scanForAlbums(rootFolder, recursive);
    const tempCoversDir = path.join(app.getPath('userData'), 'temp_covers');

    // Parse eligible folders into albums using a parallel worker pool (8 concurrent workers)
    const CONCURRENCY = 8;
    const albums: Album[] = [];

    for (let i = 0; i < folders.length; i += CONCURRENCY) {
      const chunk = folders.slice(i, i + CONCURRENCY);
      const parsedChunk = await Promise.all(
        chunk.map(async (folder) => {
          try {
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
          }
        })
      );

      for (const item of parsedChunk) {
        if (item) {
          albums.push(item);
        }
      }
    }

    // Merge cached metadata edits to restore custom titles/artists
    const cache = await queueManager.loadMetadataCache();
    for (const album of albums) {
      const cachedAlbum = cache[album.id];
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
