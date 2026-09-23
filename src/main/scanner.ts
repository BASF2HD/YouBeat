import * as fs from 'fs';
import * as path from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac']);

/** Per-operation timeout in milliseconds (10 seconds) */
const FS_TIMEOUT_MS = 10_000;

/**
 * Wraps a promise with a timeout. Rejects if the operation takes too long.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms: ${label}`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Checks if a filename has a supported audio extension.
 */
export function isSupportedAudioFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Reads directory entries with a fallback strategy and timeout protection.
 * 1. Try readdir with withFileTypes (fast, single syscall)
 * 2. If that fails (common on UNC/network shares), fall back to plain readdir + individual stat
 * 3. Each operation is wrapped with a timeout to prevent indefinite hangs
 */
async function safeReaddir(dirPath: string): Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>> {
  // Attempt 1: withFileTypes
  try {
    const entries = await withTimeout(
      fs.promises.readdir(dirPath, { withFileTypes: true }),
      FS_TIMEOUT_MS,
      `readdir(withFileTypes) ${dirPath}`
    );
    return entries;
  } catch (err: any) {
    console.warn(`readdir withFileTypes failed for "${dirPath}": ${err.message}. Trying plain readdir...`);
  }

  // Attempt 2: plain readdir + stat
  try {
    const names = await withTimeout(
      fs.promises.readdir(dirPath),
      FS_TIMEOUT_MS,
      `readdir(plain) ${dirPath}`
    );

    const entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    for (const name of names) {
      const fullPath = path.join(dirPath, name);
      try {
        const stat = await withTimeout(
          fs.promises.stat(fullPath),
          5_000, // Shorter timeout per individual stat
          `stat ${fullPath}`
        );
        entries.push({
          name,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile()
        });
      } catch (statErr: any) {
        console.warn(`  Skipping "${name}": ${statErr.message}`);
      }
    }
    return entries;
  } catch (err: any) {
    console.warn(`Plain readdir also failed for "${dirPath}": ${err.message}. Skipping folder.`);
    return [];
  }
}

export interface ScanProgress {
  phase: 'discovering' | 'parsing';
  current: number;
  total: number;
  currentFolder: string;
  foldersFound: number;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Scans the root folder and detects folders containing supported audio files.
 * Returns an array of absolute directory paths that contain audio tracks.
 */
export async function scanForAlbums(
  rootFolder: string,
  recursive: boolean,
  onProgress?: ScanProgressCallback
): Promise<string[]> {
  const albumFolders: string[] = [];
  console.log(`[Scanner] Starting scan of: "${rootFolder}" (recursive: ${recursive})`);

  let discovered = 0;

  async function checkDir(dirPath: string, depth: number) {
    try {
      discovered++;
      console.log(`[Scanner] Scanning directory (depth=${depth}): "${dirPath}"`);

      if (onProgress) {
        onProgress({
          phase: 'discovering',
          current: discovered,
          total: 0,
          currentFolder: dirPath,
          foldersFound: albumFolders.length
        });
      }

      const entries = await safeReaddir(dirPath);

      if (entries.length === 0 && depth > 0) {
        console.log(`[Scanner]   -> Empty or inaccessible, skipping.`);
        return;
      }

      let hasAudio = false;
      const subdirs: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          subdirs.push(path.join(dirPath, entry.name));
        } else if (entry.isFile() && isSupportedAudioFile(entry.name)) {
          hasAudio = true;
        }
      }

      if (hasAudio) {
        console.log(`[Scanner]   -> Found audio files, adding as album folder.`);
        albumFolders.push(dirPath);
      }

      // If recursive scan is enabled OR we are at the root level (depth === 0)
      // we scan further. (Note: if not recursive, we only scan root's direct subfolders)
      if (recursive || depth === 0) {
        for (const subdir of subdirs) {
          // Avoid system folders or common hidden folders
          const folderName = path.basename(subdir);
          if (folderName.startsWith('.') || folderName.toLowerCase() === 'node_modules' || folderName.toLowerCase() === '$recycle.bin') {
            continue;
          }
          await checkDir(subdir, depth + 1);
        }
      }
    } catch (err) {
      console.error(`[Scanner] Failed to scan folder: ${dirPath}`, err);
    }
  }

  await checkDir(rootFolder, 0);
  
  console.log(`[Scanner] Scan complete. Found ${albumFolders.length} album folder(s).`);
  
  // Deduplicate and return
  return Array.from(new Set(albumFolders));
}
