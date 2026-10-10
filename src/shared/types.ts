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
  coverPath?: string | null; // Used by mixed-song Cover Flow projects
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
  outputVideoPath?: string;
}

export interface RenderSettings {
  resolution: '1920x1080' | '1280x720';
  backgroundColor: string;
  fontFamily: string;
  coverflowSongFontSize?: number;
  coverflowAlbumFontSize?: number;
  coverflowDefaultsVersion?: number;
  trackTitleFontSize?: number;
  trackArtistFontSize?: number;
  trackRowGap?: number;
  classicCoverSizePercent?: number;
  jewelCoverSizePercent?: number;
  trackDefaultsVersion?: number;
  audioDefaultsVersion?: number;
  activeColor: string;
  inactiveColor: string;
  artistItalic: boolean;
  useJewelCase: boolean;
  artworkTheme?: 'plain' | 'jewel' | 'coverflow';
  exportQuality: 'high' | 'medium' | 'small';
  audioCodec: 'alac' | 'aac';
  introDuration: number; // in seconds
  fadeDuration: number; // in seconds
  scanRecursive: boolean;
  ffmpegPath: string;
  outputFolder: string;
  videoCodec: 'auto' | 'h264_videotoolbox' | 'h264_qsv' | 'h264_nvenc' | 'h264_amf' | 'libx264';
  skipExisting: boolean;
}

export interface LogItem {
  id: string;
  type: 'info' | 'warn' | 'error' | 'success' | 'ffmpeg';
  timestamp: string;
  text: string;
}

export interface ScanProgressPayload {
  phase: 'discovering' | 'parsing';
  current: number;
  total: number;
  currentFolder: string;
  foldersFound: number;
}

export interface IPCAPI {
  getJewelCaseOverlay: () => Promise<string>;
  platform: string;
  selectFolder: () => Promise<string | null>;
  copyText: (text: string) => Promise<void>;
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
  onScanProgress: (callback: (progress: ScanProgressPayload) => void) => () => void;
  getFfmpegVersion: (path: string) => Promise<string>;
  getHwAccelerators: () => Promise<Array<{ id: string; name: string; available: boolean }>>;
  openFolder: (path: string) => Promise<void>;
  openVideo: (path: string) => Promise<void>;
  clearScanCache: () => Promise<boolean>;
  testOutputWritable: (outDir: string) => Promise<{ ok: boolean; message: string }>;
  getDefaultOutputFolder: () => Promise<string>;
}

declare global {
  interface Window {
    api: IPCAPI;
  }
}
