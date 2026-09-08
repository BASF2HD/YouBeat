export interface Track {
  id: string;
  filePath: string;
  fileName: string;
  trackNumber: number;
  title: string;
  artist: string;
  album: string;
  year: string;
  duration: number; // in seconds
}

export interface Album {
  id: string;
  folderPath: string;
  albumName: string;
  year: string;
  tracksCount: number;
  coverPath: string | null; // Local temporary path or extracted path
  coverFound: boolean;
  totalDuration: number; // in seconds
  tracks: Track[];
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number; // 0 to 100
  error?: string;
}

export interface RenderSettings {
  resolution: '1920x1080' | '1280x720';
  fps: number;
  backgroundColor: string;
  fontFamily: string;
  activeColor: string;
  inactiveColor: string;
  artistItalic: boolean;
  exportQuality: 'high' | 'medium' | 'small';
  introDuration: number; // in seconds
  fadeDuration: number; // in seconds
  scanRecursive: boolean;
  ffmpegPath: string;
  outputFolder: string;
  videoCodec: 'auto' | 'h264_qsv' | 'h264_nvenc' | 'h264_amf' | 'libx264';
  skipExisting: boolean;
}

export interface LogItem {
  id: string;
  type: 'info' | 'warn' | 'error' | 'success' | 'ffmpeg';
  timestamp: string;
  text: string;
}

export interface IPCAPI {
  selectFolder: () => Promise<string | null>;
  scanAlbums: (rootFolder: string, recursive: boolean) => Promise<Album[]>;
  saveAlbumMetadata: (albumId: string, updatedAlbum: Album) => Promise<boolean>;
  renderAlbum: (albumId: string, settings: RenderSettings) => Promise<void>;
  renderAll: (albums: Album[], settings: RenderSettings) => Promise<void>;
  pauseQueue: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  cancelQueue: () => Promise<void>;
  onAlbumUpdated: (callback: (album: Album) => void) => () => void;
  onLogAdded: (callback: (log: LogItem) => void) => () => void;
  onQueueFinished: (callback: () => void) => () => void;
  getFfmpegVersion: (path: string) => Promise<string>;
  getHwAccelerators: () => Promise<Array<{ id: string; name: string; available: boolean }>>;
  openFolder: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    api: IPCAPI;
  }
}
