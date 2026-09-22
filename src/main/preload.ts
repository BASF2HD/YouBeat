import { contextBridge, ipcRenderer } from 'electron';
import { Album, RenderSettings, LogItem } from '../shared/types';

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  scanAlbums: (rootFolder: string, recursive: boolean) => ipcRenderer.invoke('scan-albums', rootFolder, recursive),
  saveAlbumMetadata: (albumId: string, updatedAlbum: Album) => ipcRenderer.invoke('save-album-metadata', albumId, updatedAlbum),
  renderAlbum: (albumId: string, settings: RenderSettings) => ipcRenderer.invoke('render-album', albumId, settings),
  renderAll: (albums: Album[], settings: RenderSettings) => ipcRenderer.invoke('render-all', albums, settings),
  pauseQueue: () => ipcRenderer.invoke('pause-queue'),
  resumeQueue: () => ipcRenderer.invoke('resume-queue'),
  cancelQueue: () => ipcRenderer.invoke('cancel-queue'),
  getFfmpegVersion: (path: string) => ipcRenderer.invoke('get-ffmpeg-version', path),
  getHwAccelerators: () => ipcRenderer.invoke('get-hw-accelerators'),
  openFolder: (path: string) => ipcRenderer.invoke('open-folder', path),
  
  onAlbumUpdated: (callback: (album: Album) => void) => {
    const listener = (_event: any, album: Album) => callback(album);
    ipcRenderer.on('album-updated', listener);
    return () => {
      ipcRenderer.off('album-updated', listener);
    };
  },
  
  onLogAdded: (callback: (log: LogItem) => void) => {
    const listener = (_event: any, log: LogItem) => callback(log);
    ipcRenderer.on('log-added', listener);
    return () => {
      ipcRenderer.off('log-added', listener);
    };
  },
  
  onQueueFinished: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('queue-finished', listener);
    return () => {
      ipcRenderer.off('queue-finished', listener);
    };
  }
});
