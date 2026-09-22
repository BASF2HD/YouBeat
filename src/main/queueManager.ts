import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Album, RenderSettings, LogItem } from '../shared/types';
import { generateSlidesForAlbum } from './rendererService';
import { renderAlbumVideo, killActiveFfmpegProcess } from './ffmpegService';

class QueueManager {
  private queue: Album[] = [];
  private currentIndex = -1;
  private isPaused = false;
  private isRunning = false;
  private batchCompletedCount = 0;
  private batchFailedCount = 0;
  private currentSettings: RenderSettings | null = null;
  
  private mainWindow: BrowserWindow | null = null;

  private get cachePath(): string {
    return path.join(app.getPath('userData'), 'metadata_cache.json');
  }

  private get tempBaseDir(): string {
    return path.join(app.getPath('userData'), 'temp_renders');
  }

  constructor() {}

  public setMainWindow(win: BrowserWindow) {
    this.mainWindow = win;
  }

  private emit(channel: string, data?: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  private log(text: string, type: LogItem['type'] = 'info') {
    const logItem: LogItem = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      timestamp: new Date().toLocaleTimeString(),
      text
    };
    this.emit('log-added', logItem);
  }

  /**
   * Load metadata cache from disk
   */
  public async loadMetadataCache(): Promise<Record<string, Partial<Album>>> {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = await fs.promises.readFile(this.cachePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to load metadata cache:', err);
    }
    return {};
  }

  /**
   * Save album edits to local metadata cache
   */
  public async saveAlbumMetadata(albumId: string, updatedAlbum: Album): Promise<boolean> {
    try {
      const cache = await this.loadMetadataCache();
      
      // We cache key edited fields
      cache[albumId] = {
        albumName: updatedAlbum.albumName,
        year: updatedAlbum.year,
        tracks: updatedAlbum.tracks.map(t => ({
          id: t.id,
          trackNumber: t.trackNumber,
          title: t.title,
          artist: t.artist,
          duration: t.duration
        })) as any
      };

      await fs.promises.writeFile(this.cachePath, JSON.stringify(cache, null, 2), 'utf-8');
      this.log(`Saved local metadata cache for album: ${updatedAlbum.albumName}`, 'info');
      return true;
    } catch (err: any) {
      this.log(`Failed to cache metadata edits: ${err.message}`, 'error');
      return false;
    }
  }

  /**
   * Pushes albums into the process queue
   */
  public async addToQueue(albums: Album[], settings: RenderSettings) {
    this.currentSettings = settings;
    
    // Mark albums as queued
    for (const album of albums) {
      album.status = 'queued';
      album.progress = 0;
      album.error = undefined;
      album.outputVideoPath = undefined;
      
      // If already in queue, update it, otherwise push
      const idx = this.queue.findIndex(q => q.id === album.id);
      if (idx > -1) {
        this.queue[idx] = album;
      } else {
        this.queue.push(album);
      }
      
      this.emit('album-updated', album);
    }

    this.log(`Added ${albums.length} album(s) to rendering queue`, 'info');

    if (!this.isRunning) {
      this.startQueue();
    }
  }

  /**
   * Start executing queue items sequentially
   */
  private async startQueue() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentIndex = 0;
    this.isPaused = false;
    this.batchCompletedCount = 0;
    this.batchFailedCount = 0;

    this.log('Batch render queue started', 'info');
    this.processNext();
  }

  /**
   * Process the next item in the queue
   */
  private async processNext() {
    if (!this.isRunning) return;

    // Check pause state
    if (this.isPaused) {
      this.log('Queue paused. Waiting to resume...', 'info');
      return;
    }

    // Find next queued album
    const nextIndex = this.queue.findIndex((album, idx) => idx >= this.currentIndex && album.status === 'queued');
    
    if (nextIndex === -1) {
      // Completed all items in queue
      if (this.batchFailedCount > 0) {
        this.log(
          `Queue finished: ${this.batchCompletedCount} completed, ${this.batchFailedCount} failed. Review the error logs above.`,
          'error'
        );
      } else {
        this.log(`All ${this.batchCompletedCount} queue item(s) processed successfully!`, 'success');
      }
      this.isRunning = false;
      this.currentIndex = -1;
      this.emit('queue-finished');
      return;
    }

    this.currentIndex = nextIndex;
    const album = this.queue[this.currentIndex];

    // Create temp directory for this album render
    const safeAlbumFolder = path.basename(album.folderPath).replace(/[^a-zA-Z0-9]/g, '_');
    const albumTempDir = path.join(this.tempBaseDir, `render_${Date.now()}_${safeAlbumFolder}`);

    try {
      album.status = 'processing';
      album.progress = 5;
      this.emit('album-updated', album);
      this.log(`\n========================================\nProcessing Album: ${album.albumName}\n========================================`, 'info');

      // Ensure fresh temp directory
      if (fs.existsSync(albumTempDir)) {
        await fs.promises.rm(albumTempDir, { recursive: true, force: true });
      }
      await fs.promises.mkdir(albumTempDir, { recursive: true });

      // Step 1: Generate slide PNG images
      this.log('Generating slide PNG frames via offscreen window...', 'info');
      const slidePaths = await generateSlidesForAlbum(album, this.currentSettings!, albumTempDir);
      
      // Step 2: Render video and timestamps
      this.log('Compiling video segments and generating MP4...', 'info');
      const results = await renderAlbumVideo(
        album,
        this.currentSettings!,
        slidePaths,
        albumTempDir,
        (progress) => {
          // Update and emit progress
          album.progress = progress;
          this.emit('album-updated', album);
        },
        (logItem) => {
          // Pipe log item directly
          this.emit('log-added', logItem);
        }
      );

      // Complete
      album.status = 'completed';
      album.progress = 100;
      album.outputVideoPath = results.videoPath;
      this.batchCompletedCount++;
      this.emit('album-updated', album);
      this.log(`Album rendering succeeded: "${album.albumName}". Saved to: ${results.albumOutputDir}`, 'success');

    } catch (err: any) {
      // Failed
      album.status = 'failed';
      album.error = err.message;
      this.batchFailedCount++;
      this.emit('album-updated', album);
      this.log(`Rendering failed for album: "${album.albumName}". Error: ${err.message}`, 'error');
    } finally {
      // Cleanup temp files
      try {
        if (fs.existsSync(albumTempDir)) {
          this.log(`Cleaning up temporary files in: ${albumTempDir}`, 'info');
          await fs.promises.rm(albumTempDir, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        console.error('Failed to delete temp render folder:', cleanupErr);
      }

      // Move to next album
      this.currentIndex++;
      // Give system a minor 500ms breather before starting next compile
      setTimeout(() => this.processNext(), 500);
    }
  }

  /**
   * Pause queue execution
   */
  public pause() {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.log('Queue paused by user. Current render will finish or pause, next will not start.', 'warn');
  }

  /**
   * Resume queue execution
   */
  public resume() {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.log('Queue resumed by user.', 'info');
    this.processNext();
  }

  /**
   * Cancels queue execution, kills active FFmpeg operations immediately
   */
  public async cancel() {
    if (!this.isRunning) return;
    
    this.log('Cancelling queue batch render...', 'warn');
    
    // Kill running FFmpeg process
    killActiveFfmpegProcess();

    // Mark active album as failed/cancelled
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      const album = this.queue[this.currentIndex];
      if (album.status === 'processing' || album.status === 'queued') {
        album.status = 'failed';
        album.error = 'Render process cancelled by user.';
        album.progress = 0;
        this.emit('album-updated', album);
      }
    }

    // Set remaining queued items to idle
    for (const album of this.queue) {
      if (album.status === 'queued' || album.status === 'processing') {
        album.status = 'idle';
        album.progress = 0;
        this.emit('album-updated', album);
      }
    }

    this.isRunning = false;
    this.isPaused = false;
    this.currentIndex = -1;
    this.queue = [];
    
    this.log('Batch render queue cancelled and cleared successfully.', 'error');
    this.emit('queue-finished');
  }
}

// Export single instance
export const queueManager = new QueueManager();
