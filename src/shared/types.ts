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

export interface YouTubeChannel { id: string; title: string; thumbnail?: string; uploadsPlaylistId: string; }
export interface YouTubePlaylist { id: string; title: string; itemCount: number; }
export interface YouTubeVideo { id: string; title: string; thumbnail?: string; publishedAt?: string; }
export interface YouTubePage<T> { items: T[]; nextPageToken?: string; }
export interface YouTubeLocalVideo { path: string; title: string; description: string; }

export interface IPCAPI {
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
  youtubeStatus: () => Promise<YouTubeChannel | null>;
  youtubeConnect: (clientId: string) => Promise<YouTubeChannel>;
  youtubeDisconnect: () => Promise<void>;
  youtubePlaylists: (pageToken?: string) => Promise<YouTubePage<YouTubePlaylist>>;
  youtubeVideos: (pageToken?: string) => Promise<YouTubePage<YouTubeVideo>>;
  youtubePlaylistVideos: (playlistId: string, pageToken?: string) => Promise<YouTubePage<YouTubeVideo>>;
  youtubeSelectVideo: () => Promise<YouTubeLocalVideo | null>;
  youtubePrepareVideo: (filePath: string) => Promise<YouTubeLocalVideo>;
  youtubeUpload: (video: YouTubeLocalVideo, privacy: 'private' | 'unlisted' | 'public') => Promise<string>;
  youtubeCancelUpload: () => Promise<void>;
  onYouTubeUploadProgress: (callback: (percent: number) => void) => () => void;
}

declare global {
  interface Window {
    api: IPCAPI;
  }
}
