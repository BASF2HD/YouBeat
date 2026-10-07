import { useState, useEffect, useRef } from 'react';
import { Album, RenderSettings, LogItem, Track, ScanProgressPayload } from '../shared/types';
import { getTrackLayout, getTrackFontSizes } from '../shared/trackLayout';
import { shuffleMixOrder } from '../shared/mixOrder';
import { getArtworkTheme } from '../shared/artworkTheme';
import { getCoverflowFontSizes, getCoverflowSideCount } from '../shared/coverflow';
import appLogo from '../../resources/albumforge-icon.png';
import jewelCaseOverlay from '../../resources/cd-jewel-case-overlay.png';

const PREVIEW_PANE_MIN_WIDTH = 320;
const PREVIEW_PANE_MAX_WIDTH = 720;

const clampPreviewPaneWidth = (width: number) =>
  Math.min(PREVIEW_PANE_MAX_WIDTH, Math.max(PREVIEW_PANE_MIN_WIDTH, width));

// Supported font list for text layout
const SYSTEM_FONTS = [
  { label: 'Segoe UI (Clean modern)', value: 'Segoe UI' },
  { label: 'Outfit (Sleek Geometric)', value: 'Outfit' },
  { label: 'Arial (Standard sans)', value: 'Arial' },
  { label: 'Helvetica (Premium clean)', value: 'Helvetica' },
  { label: 'Times New Roman (Classic serif)', value: 'Times New Roman' },
  { label: 'Courier New (Monospace tech)', value: 'Courier New' },
  { label: 'Georgia (Elegant warm)', value: 'Georgia' }
];

export interface ColorPalette {
  id: string;
  name: string;
  backgroundColor: string;
  activeColor: string;
  inactiveColor: string;
  tag?: string;
}

export const PREDEFINED_PALETTES: ColorPalette[] = [
  {
    id: 'midnight',
    name: 'Midnight Black',
    backgroundColor: '#000000',
    activeColor: '#ffffff',
    inactiveColor: '#737373',
    tag: 'Classic'
  },
  {
    id: 'charcoal',
    name: 'Studio Slate',
    backgroundColor: '#111216',
    activeColor: '#f1f2f6',
    inactiveColor: '#6e7182',
    tag: 'Modern'
  },
  {
    id: 'cyan',
    name: 'Cyber Neon',
    backgroundColor: '#070b14',
    activeColor: '#00f2fe',
    inactiveColor: '#43587d',
    tag: 'EDM / Synth'
  },
  {
    id: 'amber',
    name: 'Warm Sunset',
    backgroundColor: '#140e0c',
    activeColor: '#fbbf24',
    inactiveColor: '#8a6e5a',
    tag: 'Lo-fi / Acoustic'
  },
  {
    id: 'emerald',
    name: 'Emerald Echo',
    backgroundColor: '#08130e',
    activeColor: '#34d399',
    inactiveColor: '#4d7060',
    tag: 'Chill'
  },
  {
    id: 'violet',
    name: 'Neon Velvet',
    backgroundColor: '#100a1a',
    activeColor: '#c084fc',
    inactiveColor: '#74598b',
    tag: 'R&B / Soul'
  },
  {
    id: 'paper',
    name: 'Clean Studio',
    backgroundColor: '#f5f5f7',
    activeColor: '#121214',
    inactiveColor: '#7a7a8c',
    tag: 'Light Video'
  },
  {
    id: 'crimson',
    name: 'Crimson Night',
    backgroundColor: '#14090a',
    activeColor: '#f87171',
    inactiveColor: '#845054',
    tag: 'Rock / Bold'
  }
];

export default function App() {
  // Tabs routing state
  const [activeTab, setActiveTab] = useState<'library' | 'mix' | 'queue' | 'logs' | 'settings'>('library');

  // General App settings
  const [settings, setSettings] = useState<RenderSettings>({
    resolution: '1920x1080',
    backgroundColor: '#000000',
    fontFamily: 'Outfit',
    coverflowSongFontSize: 52,
    coverflowAlbumFontSize: 38,
    coverflowDefaultsVersion: 1,
    trackTitleFontSize: 40,
    trackArtistFontSize: 20,
    activeColor: '#ffffff',
    inactiveColor: '#888888',
    artistItalic: true,
    useJewelCase: false,
    artworkTheme: 'plain',
    exportQuality: 'medium',
    audioCodec: 'alac',
    introDuration: 0,
    fadeDuration: 0,
    scanRecursive: false,
    ffmpegPath: 'ffmpeg',
    outputFolder: '',
    videoCodec: 'auto',
    skipExisting: true
  });

  // Library scanning state
  const [rootFolder, setRootFolder] = useState<string>('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(() => new Set());
  const [mixTitle, setMixTitle] = useState('My Cover Flow Mix');
  const [mixSearch, setMixSearch] = useState('');
  const [mixTrackPaths, setMixTrackPaths] = useState<string[]>([]);
  const [mixPreviewIndex, setMixPreviewIndex] = useState(0);
  const [albumPreviewIndex, setAlbumPreviewIndex] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [draggedMixPath, setDraggedMixPath] = useState<string | null>(null);
  const [dragOverMixPath, setDragOverMixPath] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressPayload | null>(null);

  // Queue state
  const [isQueueRunning, setIsQueueRunning] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);

  // Logging state
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsCopied, setLogsCopied] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const selectAllAlbumsRef = useRef<HTMLInputElement>(null);
  const selectAllMixTracksRef = useRef<HTMLInputElement>(null);

  // Output folder preflight state (inline banner under Settings picker)
  const [outputCheck, setOutputCheck] = useState<{ checking: boolean; ok: boolean | null; message: string | null }>({
    checking: false,
    ok: null,
    message: null
  });

  const runOutputPreflight = async () => {
    if (!settings.outputFolder) {
      setOutputCheck({ checking: false, ok: false, message: 'No output folder selected yet.' });
      return false;
    }
    setOutputCheck({ checking: true, ok: null, message: 'Checking writability…' });
    const result = await window.api.testOutputWritable(settings.outputFolder);
    setOutputCheck({ checking: false, ok: result.ok, message: result.message });
    return result.ok;
  };

  // Inline Metadata Editor Modal State
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);

  // Live Preview section visibility & collapse states
  const [showPreviewPane, setShowPreviewPane] = useState<boolean>(() => {
    const saved = localStorage.getItem('show_preview_pane');
    return saved !== null ? saved === 'true' : true;
  });
  const [showPreviewCanvas, setShowPreviewCanvas] = useState<boolean>(() => {
    const saved = localStorage.getItem('show_preview_canvas');
    return saved !== null ? saved === 'true' : true;
  });
  const [previewPaneWidth, setPreviewPaneWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('preview_pane_width'));
    return Number.isFinite(saved) && saved > 0 ? clampPreviewPaneWidth(saved) : 420;
  });

  const togglePreviewPane = (val: boolean) => {
    setShowPreviewPane(val);
    localStorage.setItem('show_preview_pane', String(val));
  };

  const togglePreviewCanvas = () => {
    setShowPreviewCanvas(prev => {
      const next = !prev;
      localStorage.setItem('show_preview_canvas', String(next));
      return next;
    });
  };

  const updatePreviewPaneWidth = (width: number) => {
    const nextWidth = clampPreviewPaneWidth(width);
    setPreviewPaneWidth(nextWidth);
    localStorage.setItem('preview_pane_width', String(nextWidth));
  };

  const handlePreviewResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewPaneWidth;
    let nextWidth = startWidth;
    let animationFrame: number | null = null;

    document.body.classList.add('preview-resizing');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampPreviewPaneWidth(startWidth + startX - moveEvent.clientX);
      if (animationFrame !== null) return;

      animationFrame = window.requestAnimationFrame(() => {
        if (workspaceContentRef.current) {
          workspaceContentRef.current.style.gridTemplateColumns = `minmax(0, 1fr) ${nextWidth}px`;
        }
        animationFrame = null;
      });
    };

    const handlePointerUp = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      updatePreviewPaneWidth(nextWidth);
      document.body.classList.remove('preview-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePreviewResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updatePreviewPaneWidth(previewPaneWidth + 20);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      updatePreviewPaneWidth(previewPaneWidth - 20);
    }
  };

  // App interface theme state ('dark' | 'light')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const applyPalette = (palette: ColorPalette) => {
    updateSettings({
      backgroundColor: palette.backgroundColor,
      activeColor: palette.activeColor,
      inactiveColor: palette.inactiveColor,
    });
  };

  // Load basic configurations from localStorage upon mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('render_settings');
    let persistedHasOutput = false;
    if (savedSettings) {
      try {
        const { fps: _obsoleteFps, ...parsed } = JSON.parse(savedSettings);
        // Upgrade the old defaults once while retaining custom font sizes.
        if (!parsed.coverflowDefaultsVersion) {
          if (parsed.coverflowSongFontSize == null || parsed.coverflowSongFontSize === 40) parsed.coverflowSongFontSize = 52;
          if (parsed.coverflowAlbumFontSize == null || parsed.coverflowAlbumFontSize === 34) parsed.coverflowAlbumFontSize = 38;
          parsed.coverflowDefaultsVersion = 1;
        }
        setSettings(prev => {
          const next = { ...prev, ...parsed, artworkTheme: parsed.artworkTheme || (parsed.useJewelCase ? 'jewel' : 'plain') };
          localStorage.setItem('render_settings', JSON.stringify(next));
          return next;
        });
        if (parsed.outputFolder) persistedHasOutput = true;
      } catch (err) {
        console.error('Failed to parse saved settings:', err);
      }
    }

    const savedRoot = localStorage.getItem('root_folder');
    if (savedRoot) {
      setRootFolder(savedRoot);
    }

    // If no output folder was previously persisted, pre-populate with a safe
    // local default (your OS Videos / AlbumForge Studio folder) instead of
    // letting it default to a (potentially blocked) network share sibling.
    if (!persistedHasOutput) {
      (async () => {
        try {
          const safeLocal = await window.api.getDefaultOutputFolder();
          if (safeLocal) {
            setSettings(prev => {
              if (prev.outputFolder) return prev;
              const next = { ...prev, outputFolder: safeLocal };
              localStorage.setItem('render_settings', JSON.stringify(next));
              return next;
            });
          }
        } catch {
          // Best-effort; user can still choose manually in Settings.
        }
      })();
    }
  }, []);

  // Sync settings modifications to localStorage
  const updateSettings = (updated: Partial<RenderSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('render_settings', JSON.stringify(next));
      return next;
    });
    // If output folder was just set, re-check its writability
    if ('outputFolder' in updated) {
      setOutputCheck({ checking: false, ok: null, message: null });
      if (updated.outputFolder) {
        // Run asynchronously so it doesn't block settings commit
        queueMicrotask(runOutputPreflight);
      }
    }
  };

  // IPC Event listeners mapping for Electron Background processes
  useEffect(() => {
    // 1. Log arrival listener
    const unsubscribeLog = window.api.onLogAdded((log) => {
      setLogs(prev => [...prev.slice(-199), log]); // Keep latest 200 logs
    });

    // 2. Queue updates listener
    const unsubscribeAlbum = window.api.onAlbumUpdated((updatedAlbum) => {
      setAlbums(prev => {
        const idx = prev.findIndex(a => a.id === updatedAlbum.id);
        if (idx > -1) {
          const next = [...prev];
          next[idx] = updatedAlbum;
          return next;
        }
        return [...prev, updatedAlbum];
      });

      // Update queue run flags
      if (updatedAlbum.status === 'processing') {
        setIsQueueRunning(true);
      }
    });

    // 3. Queue finished listener
    const unsubscribeFinished = window.api.onQueueFinished(() => {
      setIsQueueRunning(false);
      setIsQueuePaused(false);
      
      // Flash notifications or play sound
      const audio = new Audio('data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YTABAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      audio.play().catch(() => {});
    });

    // 4. Scan progress listener
    const unsubscribeScanProgress = window.api.onScanProgress((progress) => {
      setScanProgress(progress);
    });

    return () => {
      unsubscribeLog();
      unsubscribeAlbum();
      unsubscribeFinished();
      unsubscribeScanProgress();
    };
  }, []);

  // Autoscroll logger panel to the bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const scannedAlbums = albums.filter(album => !album.id.startsWith('mix-'));
  const allAlbumsSelected = scannedAlbums.length > 0 && scannedAlbums.every(album => selectedAlbumIds.has(album.id));
  const someAlbumsSelected = scannedAlbums.some(album => selectedAlbumIds.has(album.id));

  useEffect(() => {
    if (selectAllAlbumsRef.current) {
      selectAllAlbumsRef.current.indeterminate = someAlbumsSelected && !allAlbumsSelected;
    }
  }, [allAlbumsSelected, someAlbumsSelected]);

  const toggleAlbumSelection = (albumId: string) => {
    setSelectedAlbumIds(previous => {
      const next = new Set(previous);
      if (next.has(albumId)) {
        next.delete(albumId);
      } else {
        next.add(albumId);
      }
      return next;
    });
  };

  const toggleSelectAllAlbums = () => {
    setSelectedAlbumIds(allAlbumsSelected ? new Set() : new Set(scannedAlbums.map(album => album.id)));
  };

  const toggleMixTrack = (filePath: string) => {
    setMixTrackPaths(previous => previous.includes(filePath)
      ? previous.filter(path => path !== filePath)
      : [...previous, filePath]);
  };

  const reorderMixTrack = (sourcePath: string, targetPath: string) => {
    const source = mixTrackPaths.indexOf(sourcePath);
    const target = mixTrackPaths.indexOf(targetPath);
    if (source < 0 || target < 0 || source === target) return;
    const activePath = mixTrackPaths[mixPreviewIndex];
    const next = [...mixTrackPaths];
    next.splice(target, 0, next.splice(source, 1)[0]);
    setMixTrackPaths(next);
    setMixPreviewIndex(Math.max(0, next.indexOf(activePath)));
  };

  const moveMixTrack = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= mixTrackPaths.length) return;
    reorderMixTrack(mixTrackPaths[index], mixTrackPaths[target]);
  };

  const shuffleMixTracks = () => {
    if (mixTrackPaths.length < 2) return;
    const activePath = mixTrackPaths[mixPreviewIndex];
    const next = shuffleMixOrder(mixTrackPaths);
    setMixTrackPaths(next);
    setMixPreviewIndex(Math.max(0, next.indexOf(activePath)));
  };

  // Actions
  const handleSelectRoot = async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      setRootFolder(folder);
      localStorage.setItem('root_folder', folder);
      
      // Auto-set output folder if currently empty
      if (!settings.outputFolder) {
        const defaultOut = `${folder}_Videos`;
        updateSettings({ outputFolder: defaultOut });
      }
    }
  };

  const handleSelectOutput = async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      updateSettings({ outputFolder: folder });
    }
  };

  const handleScan = async () => {
    if (!rootFolder) return;
    setIsScanning(true);
    setScanProgress(null);
    setLogs([]);
    setActiveTab('library');
    
    try {
      const results = await window.api.scanAlbums(rootFolder, settings.scanRecursive);
      setAlbums(previous => [...results, ...previous.filter(album => album.id.startsWith('mix-'))]);
      setSelectedAlbumIds(new Set());
      if (results.length > 0) {
        setSelectedAlbumId(results[0].id);
      } else {
        setSelectedAlbumId(null);
      }
      
      // Log completion
      setLogs(prev => [
        ...prev,
        {
          id: String(Date.now()),
          type: 'success',
          timestamp: new Date().toLocaleTimeString(),
          text: `Scan Complete! Found ${results.length} valid music album folders.`
        }
      ]);
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        {
          id: String(Date.now()),
          type: 'error',
          timestamp: new Date().toLocaleTimeString(),
          text: `Scan failed: ${err.message}`
        }
      ]);
    } finally {
      setIsScanning(false);
      setScanProgress(null);
    }
  };

  // Selected albums compile trigger
  const handleRenderSelected = async () => {
    const selectedAlbums = scannedAlbums.filter(album => selectedAlbumIds.has(album.id));
    if (selectedAlbums.length === 0) return;

    if (!settings.outputFolder) {
      alert('Please select an output folder in settings first!');
      setActiveTab('settings');
      return;
    }

    // Fail early: don't even add to queue if the output folder isn't writable
    if (!await runOutputPreflight()) {
      alert(`Cannot start render: ${outputCheck.message || 'Output folder is not writable.'}\n\nPlease pick a different output folder (local folders like C:\\Videos work best).`);
      setActiveTab('settings');
      return;
    }

    try {
      setActiveTab('queue');
      setIsQueueRunning(true);
      await window.api.renderAll(selectedAlbums, settings);
    } catch (err) {
      console.error(err);
    }
  };

  // Batch Queue Compile trigger
  const handleRenderAll = async () => {
    if (scannedAlbums.length === 0) return;
    
    if (!settings.outputFolder) {
      alert('Please select an output folder in settings first!');
      setActiveTab('settings');
      return;
    }

    // Fail early: don't even add to queue if the output folder isn't writable
    if (!await runOutputPreflight()) {
      alert(`Cannot start render: ${outputCheck.message || 'Output folder is not writable.'}\n\nPlease pick a different output folder (local folders like C:\\Videos work best).`);
      setActiveTab('settings');
      return;
    }

    const uncompleted = scannedAlbums.filter(a => a.status !== 'completed');
    if (uncompleted.length === 0) {
      if (!confirm('All albums are already rendered. Re-render all?')) {
        return;
      }
    }

    try {
      setActiveTab('queue');
      setIsQueueRunning(true);
      
      const targetList = uncompleted.length > 0 ? uncompleted : scannedAlbums;
      await window.api.renderAll(targetList, settings);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRenderMix = async () => {
    if (!mixPreviewAlbum || !mixTitle.trim()) return;
    if (!settings.outputFolder) { setActiveTab('settings'); alert('Choose an output folder first.'); return; }
    if (!await runOutputPreflight()) { alert('The output folder is not writable.'); return; }
    const mix: Album = {
      ...mixPreviewAlbum,
      id: `mix-${Date.now()}`,
      albumName: mixTitle.trim(),
      status: 'idle',
    };
    setSelectedAlbumId(mix.id);
    setActiveTab('queue');
    setIsQueueRunning(true);
    try { await window.api.renderAll([mix], settings); }
    catch (error) { setIsQueueRunning(false); alert(`Could not queue mix: ${String(error)}`); }
  };

  // Queue actions
  const handlePauseQueue = async () => {
    await window.api.pauseQueue();
    setIsQueuePaused(true);
  };

  const handleResumeQueue = async () => {
    await window.api.resumeQueue();
    setIsQueuePaused(false);
  };

  const handleCancelQueue = async () => {
    if (confirm('Are you sure you want to cancel the entire rendering process? Current progress will be lost.')) {
      await window.api.cancelQueue();
      setIsQueueRunning(false);
      setIsQueuePaused(false);
    }
  };

  // Verify FFmpeg command
  const handleVerifyFfmpeg = async () => {
    const res = await window.api.getFfmpegVersion(settings.ffmpegPath);
    alert(res);
  };

  // Detect available GPU hardware encoders
  const handleDetectGpu = async () => {
    try {
      const gpus = await window.api.getHwAccelerators();
      const statusText = gpus.map(g => `${g.name}: ${g.available ? '✅ Supported' : '❌ Not Available'}`).join('\n');
      alert(`Hardware Acceleration Engines:\n\n${statusText}`);
    } catch (err: any) {
      alert(`GPU check failed: ${err.message}`);
    }
  };

  const handleOpenOutput = async () => {
    if (!settings.outputFolder) return;
    try {
      await window.api.openFolder(settings.outputFolder);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOpenRenderedVideo = async (videoPath: string) => {
    try {
      await window.api.openVideo(videoPath);
    } catch (err: any) {
      alert(`Could not open the rendered video: ${err.message}`);
    }
  };

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    const text = logs.map(log => `[${log.timestamp}] ${log.text}`).join('\n');
    await window.api.copyText(text);
    setLogsCopied(true);
    window.setTimeout(() => setLogsCopied(false), 1500);
  };

  // Metadata editor handlers
  const openMetadataEditor = (album: Album) => {
    // Clone to prevent direct state mutability
    setEditingAlbum(JSON.parse(JSON.stringify(album)));
  };

  const handleSaveEditedMetadata = async () => {
    if (!editingAlbum) return;

    try {
      const success = await window.api.saveAlbumMetadata(editingAlbum.id, editingAlbum);
      if (success) {
        setAlbums(prev => prev.map(a => a.id === editingAlbum.id ? editingAlbum : a));
        setEditingAlbum(null);
      }
    } catch (err: any) {
      alert(`Failed to save edits: ${err.message}`);
    }
  };

  const updateEditingTrack = (trackId: string, updates: Partial<Track>) => {
    if (!editingAlbum) return;
    setEditingAlbum(prev => {
      if (!prev) return null;
      const nextTracks = prev.tracks.map(t => {
        if (t.id === trackId) {
          return { ...t, ...updates };
        }
        return t;
      });
      return {
        ...prev,
        tracks: nextTracks
      };
    });
  };

  // Active elements
  const libraryMixTracks = scannedAlbums.flatMap(album =>
    album.tracks.map(track => ({ track, album })));
  const filteredMixTracks = libraryMixTracks.filter(({ track, album }) =>
    `${track.title} ${track.artist} ${album.albumName}`.toLowerCase().includes(mixSearch.toLowerCase()));
  const visibleMixTracks = filteredMixTracks.slice(0, 500);
  const selectedMixPaths = new Set(mixTrackPaths);
  const allFilteredMixTracksSelected = filteredMixTracks.length > 0 && filteredMixTracks.every(({ track }) => selectedMixPaths.has(track.filePath));
  const someFilteredMixTracksSelected = filteredMixTracks.some(({ track }) => selectedMixPaths.has(track.filePath));
  useEffect(() => {
    if (selectAllMixTracksRef.current) {
      selectAllMixTracksRef.current.indeterminate = someFilteredMixTracksSelected && !allFilteredMixTracksSelected;
    }
  }, [allFilteredMixTracksSelected, someFilteredMixTracksSelected]);
  const toggleSelectAllMixTracks = () => {
    const matchingPaths = new Set(filteredMixTracks.map(({ track }) => track.filePath));
    setMixTrackPaths(previous => allFilteredMixTracksSelected
      ? previous.filter(filePath => !matchingPaths.has(filePath))
      : [...previous, ...filteredMixTracks.map(({ track }) => track.filePath).filter(filePath => !previous.includes(filePath))]);
  };
  const orderedMixTracks = mixTrackPaths.map(filePath =>
    libraryMixTracks.find(item => item.track.filePath === filePath)).filter((item): item is { track: Track; album: Album } => Boolean(item));
  const mixPreviewAlbum: Album | null = orderedMixTracks.length ? {
    id: 'mix-preview', folderPath: 'Mixed songs', albumName: mixTitle.trim() || 'Untitled Mix', year: 'Mix',
    tracksCount: orderedMixTracks.length,
    coverPath: orderedMixTracks[0].album.coverPath,
    coverFound: Boolean(orderedMixTracks[0].album.coverPath),
    totalDuration: orderedMixTracks.reduce((sum, item) => sum + item.track.duration, 0),
    tracks: orderedMixTracks.map((item, index) => ({ ...item.track, trackNumber: index + 1, coverPath: item.album.coverPath })),
    status: 'idle', progress: 0,
  } : null;
  const selectedAlbum = activeTab === 'mix' ? mixPreviewAlbum : albums.find(a => a.id === selectedAlbumId) || null;
  const previewActiveIndex = Math.min(activeTab === 'mix' ? mixPreviewIndex : albumPreviewIndex, (selectedAlbum?.tracks.length || 1) - 1);
  const previewFlowSideCount = getCoverflowSideCount(selectedAlbum?.tracks.length || 0);
  const coverflowFontSizes = getCoverflowFontSizes(settings);
  const trackFontSizes = getTrackFontSizes(settings);
  const previewTrackLayout = selectedAlbum
    ? getTrackLayout(selectedAlbum.tracks.length, previewActiveIndex, settings.resolution, settings)
    : null;
  const selectPreviewTrack = (index: number) => {
    setPreviewPlaying(false);
    if (activeTab === 'mix') setMixPreviewIndex(index);
    else setAlbumPreviewIndex(index);
  };
  const stepPreviewTrack = (direction: number) => {
    const count = selectedAlbum?.tracks.length || 0;
    if (count < 2) return;
    const setter = activeTab === 'mix' ? setMixPreviewIndex : setAlbumPreviewIndex;
    setter(previous => (previous + direction + count) % count);
  };
  useEffect(() => { setAlbumPreviewIndex(0); setPreviewPlaying(false); }, [selectedAlbumId]);
  useEffect(() => {
    if (!previewPlaying || !showPreviewCanvas || !selectedAlbum || selectedAlbum.tracks.length < 2) return;
    const timer = window.setInterval(() => {
      const setter = activeTab === 'mix' ? setMixPreviewIndex : setAlbumPreviewIndex;
      setter(previous => (previous + 1) % selectedAlbum.tracks.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [previewPlaying, showPreviewCanvas, activeTab, selectedAlbum?.id, selectedAlbum?.tracks.length]);
  const selectedVideoCodec = window.api.platform === 'darwin' &&
    !['auto', 'h264_videotoolbox', 'libx264'].includes(settings.videoCodec)
    ? 'auto'
    : settings.videoCodec || 'auto';

  // Render stats
  const totalDurationStr = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins % 60}m`;
    }
    return `${mins}m ${Math.floor(secs % 60)}s`;
  };

  const formatTrackTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      {/* 1. Top Navigation Bar */}
      <header className="top-bar">
        <div className="brand-section">
          <div className="brand-logo">
            <img src={appLogo} alt="" />
          </div>
          <div className="brand-wordmark">
            <span className="brand-name">AlbumForge</span>
            <span className="brand-edition">Studio</span>
          </div>
        </div>
        
        <nav className="nav-menu">
          <button
            className={`nav-item ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <span>📁</span> Library
          </button>
          <button
            className={`nav-item ${activeTab === 'mix' ? 'active' : ''}`}
            onClick={() => setActiveTab('mix')}
          >
            <span>🎶</span> Mix Builder
          </button>
          <button 
            className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            <span>⚡</span> Queue {albums.filter(a => a.status === 'queued' || a.status === 'processing').length > 0 && <span className="queue-badge" style={{ background: 'var(--accent-primary)', fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '50%', color: 'white' }}>{albums.filter(a => a.status === 'queued' || a.status === 'processing').length}</span>}
          </button>
          <button
            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <span>💻</span> Logs
          </button>
          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span>⚙️</span> Settings
          </button>
        </nav>

        {/* Queue controls inline */}
        {isQueueRunning && (
          <>
            <div className="top-bar-separator" />
            <div className="queue-indicator">
              <span className="play-icon">▶</span> Processing
            </div>
            {!isQueuePaused ? (
              <button className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '11px' }} onClick={handlePauseQueue}>Pause</button>
            ) : (
              <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '11px' }} onClick={handleResumeQueue}>Resume</button>
            )}
            <button className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '11px' }} onClick={handleCancelQueue}>Abort</button>
          </>
        )}

        {/* Right-side action buttons */}
        <div className="top-bar-actions">
          {activeTab === 'library' && scannedAlbums.length > 0 && (
            <>
              <button className="btn btn-secondary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleRenderSelected} disabled={selectedAlbumIds.size === 0 || isQueueRunning}>
                Render Selected ({selectedAlbumIds.size})
              </button>
              <button className="btn btn-primary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleRenderAll} disabled={isQueueRunning}>
                Render All ({scannedAlbums.length})
              </button>
            </>
          )}

          {settings.outputFolder && (
            <button className="btn btn-secondary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleOpenOutput}>
              📂 Output
            </button>
          )}

          {!showPreviewPane && (
            <button 
              className="btn btn-secondary" 
              onClick={() => togglePreviewPane(true)} 
              title="Show Live Preview section"
              style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span>👁️</span> Preview
            </button>
          )}

          <button 
            className="btn btn-secondary theme-toggle-btn" 
            onClick={toggleTheme} 
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>{theme === 'dark' ? '☀️' : '🌙'}</span> {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      {/* 2. Workspace Viewport */}
      <main className="workspace">
        {/* Multi-Pane workspace body */}
        <div
          ref={workspaceContentRef}
          className={`workspace-content ${!showPreviewPane ? 'preview-collapsed' : ''}`}
          style={showPreviewPane ? { gridTemplateColumns: `minmax(0, 1fr) ${previewPaneWidth}px` } : undefined}
        >
          
          {/* Left panel context dependent */}
          <div className="main-pane">
            
            {/* Library Tab */}
            {activeTab === 'library' && (
              <>
                {/* Folder scanner block */}
                <div className="scan-config-card">
                  <div className="picker-row">
                    <div className="input-group" style={{ flex: 1 }}>
                      <span className="input-label">Root music catalog directory</span>
                      <div className="picker-row">
                        <input 
                          type="text" 
                          className="text-input" 
                          readOnly 
                          placeholder="No music folder selected yet" 
                          value={rootFolder} 
                        />
                        <button className="btn btn-secondary" onClick={handleSelectRoot}>Choose Path</button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="checkbox-row">
                      <input 
                        type="checkbox" 
                        className="checkbox-input" 
                        checked={settings.scanRecursive}
                        onChange={(e) => updateSettings({ scanRecursive: e.target.checked })}
                      />
                      Scan nested folders recursively (recommends for multi-subfolders)
                    </label>

                    <button 
                      className="btn btn-primary scan-library-btn" 
                      onClick={handleScan}
                      disabled={!rootFolder || isScanning || isQueueRunning}
                    >
                      {isScanning ? 'Scanning…' : 'Scan Library'}
                    </button>
                  </div>
                </div>

                {isScanning && scanProgress && (
                  <div className="scan-progress-card" style={{
                    margin: '0 15px 15px 15px',
                    padding: '14px 18px',
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '10px',
                    backdropFilter: 'blur(8px)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {scanProgress.phase === 'discovering' ? '🔍 Discovering directories…' : '📖 Reading album metadata…'}
                      </div>
                      <div style={{ display: 'flex', gap: '14px', color: 'var(--text-secondary)' }}>
                        <span>
                          {scanProgress.phase === 'discovering' ? (
                            <>Folders searched: <strong style={{ color: 'var(--accent-primary)' }}>{scanProgress.current}</strong> · Albums found: <strong style={{ color: 'var(--accent-primary)' }}>{scanProgress.foldersFound}</strong></>
                          ) : (
                            <>Albums <strong style={{ color: 'var(--accent-primary)' }}>{scanProgress.current}</strong> / {scanProgress.total}</>
                          )}
                        </span>
                        {scanProgress.phase === 'parsing' && scanProgress.total > 0 && (
                          <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                            {Math.round((scanProgress.current / scanProgress.total) * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="progress-bar-container" style={{ height: '8px', marginTop: '0' }}>
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: scanProgress.phase === 'parsing' && scanProgress.total > 0
                            ? `${(scanProgress.current / scanProgress.total) * 100}%`
                            : `${Math.min(100, 30 + (scanProgress.current % 70))}%`,
                          transition: 'width 0.15s linear'
                        }}
                      />
                    </div>
                    {scanProgress.currentFolder && (
                      <div style={{
                        marginTop: '8px',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        fontFamily: 'Consolas, Menlo, monospace',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {scanProgress.currentFolder}
                      </div>
                    )}
                  </div>
                )}

                {/* Scanned Albums table */}
                {scannedAlbums.length > 0 ? (
                  <div className="table-container">
                    <table className="album-table library-table">
                      <thead>
                        <tr>
                          <th className="selection-column">
                            <input
                              ref={selectAllAlbumsRef}
                              type="checkbox"
                              className="table-select-checkbox"
                              checked={allAlbumsSelected}
                              onChange={toggleSelectAllAlbums}
                              aria-label="Select all albums"
                              title="Select all albums"
                            />
                          </th>
                          <th>Album Folder Name</th>
                          <th>Year</th>
                          <th>Tracks</th>
                          <th>Cover Art</th>
                          <th>Total duration</th>
                          <th>Process status</th>
                          <th className="actions-column" style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannedAlbums.map((album) => (
                          <tr 
                            key={album.id}
                            className={`${selectedAlbumId === album.id ? 'selected' : ''} ${selectedAlbumIds.has(album.id) ? 'render-selected' : ''}`.trim()}
                            onClick={() => setSelectedAlbumId(album.id)}
                          >
                            <td className="selection-column">
                              <input
                                type="checkbox"
                                className="table-select-checkbox"
                                checked={selectedAlbumIds.has(album.id)}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleAlbumSelection(album.id)}
                                aria-label={`Select ${album.albumName} for rendering`}
                              />
                            </td>
                            <td className="album-title-cell">{album.albumName}</td>
                            <td>{album.year}</td>
                            <td>{album.tracksCount} tracks</td>
                            <td>
                              {album.coverFound ? (
                                <span className="badge badge-yes">FOUND</span>
                              ) : (
                                <span className="badge badge-no">SVG DEFAULT</span>
                              )}
                            </td>
                            <td>{totalDurationStr(album.totalDuration)}</td>
                            <td>
                              <span className={`badge badge-status badge-status-${album.status}`}>
                                {album.status}
                              </span>
                              {album.status === 'processing' && (
                                <div className="progress-bar-container">
                                  <div className="progress-bar-fill" style={{ width: `${album.progress}%` }}></div>
                                </div>
                              )}
                            </td>
                            <td className="actions-column" style={{ textAlign: 'right' }}>
                              <button 
                                className="btn btn-secondary table-action-btn" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMetadataEditor(album);
                                }}
                              >
                                ✏️ Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">💿</div>
                    <h3>Your Music Library is Empty</h3>
                    <p style={{ maxWidth: '400px', fontSize: '13px', textAlign: 'center', lineHeight: '1.5' }}>
                      Choose your root folder containing album directories (MP3, FLAC, WAV, M4A, AAC) and click "Scan Music Library" to begin automatically compiling metadata.
                    </p>
                  </div>
                )}
              </>
            )}

            {activeTab === 'mix' && (
              <div className="mix-builder">
                <div className="mix-builder-header">
                  <div><h3>Mixed-song video</h3><p>Pick songs across albums, arrange their order, then render one video with each song’s own cover.</p></div>
                  <button className="btn btn-primary" onClick={handleRenderMix} disabled={!orderedMixTracks.length || isQueueRunning}>Render mix ({orderedMixTracks.length})</button>
                </div>
                <div className="mix-builder-fields">
                  <label className="input-group"><span className="input-label">Video title</span><input className="text-input" value={mixTitle} onChange={event => setMixTitle(event.target.value)} maxLength={100} /></label>
                  <label className="input-group"><span className="input-label">Find songs</span><input className="text-input" placeholder="Search title, artist or album" value={mixSearch} onChange={event => setMixSearch(event.target.value)} /></label>
                </div>
                <div className="mix-builder-columns">
                  <section className="mix-song-panel" aria-label="Available songs">
                    <div className="mix-song-panel-heading">
                      <label className="mix-select-all">
                        <input ref={selectAllMixTracksRef} type="checkbox" checked={allFilteredMixTracksSelected} disabled={filteredMixTracks.length === 0} onChange={toggleSelectAllMixTracks} aria-label={`Select all ${filteredMixTracks.length} matching songs`} />
                        <strong>Library songs</strong>
                      </label>
                      <small>{filteredMixTracks.length} matching</small>
                    </div>
                    {libraryMixTracks.length ? visibleMixTracks.map(({ track, album }) => (
                        <label className="mix-song-row" key={track.filePath}>
                          <input type="checkbox" checked={selectedMixPaths.has(track.filePath)} onChange={() => toggleMixTrack(track.filePath)} />
                          {album.coverPath && <img src={`file:///${album.coverPath.replace(/\\/g, '/')}`} alt="" />}
                          <span><strong>{track.title}</strong><small>{track.artist} · {album.albumName}</small></span>
                        </label>
                      )) : <p className="mix-empty">Scan your music library first, then return here to choose songs.</p>}
                    {filteredMixTracks.length > 500 && <p className="mix-empty">Showing the first 500 matches. Select all includes all {filteredMixTracks.length} matching songs.</p>}
                  </section>
                  <section className="mix-song-panel" aria-label="Mix order">
                    <div className="mix-song-panel-heading">
                      <strong>Playback order · {orderedMixTracks.length} songs</strong>
                      <button type="button" className="mix-shuffle-button" onClick={shuffleMixTracks} disabled={orderedMixTracks.length < 2} title="Randomize playback order" aria-label="Shuffle playback order">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c5 0 7-12 12-12h3M18 3l3 3-3 3M18 15l3 3-3 3" /></svg>
                        Shuffle
                      </button>
                    </div>
                    {orderedMixTracks.length ? orderedMixTracks.map(({ track, album }, index) => (
                      <div className={`mix-song-row ${previewActiveIndex === index ? 'is-previewing' : ''} ${dragOverMixPath === track.filePath && draggedMixPath !== track.filePath ? 'is-drop-target' : ''}`} key={track.filePath}
                        onDragOver={event => { if (draggedMixPath && draggedMixPath !== track.filePath) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverMixPath(track.filePath); } }}
                        onDrop={event => { event.preventDefault(); reorderMixTrack(event.dataTransfer.getData('text/plain') || draggedMixPath || '', track.filePath); setDraggedMixPath(null); setDragOverMixPath(null); }}>
                        <span className="mix-drag-handle" draggable="true" title={`Drag ${track.title} to reorder`} aria-label={`Drag ${track.title} to reorder`}
                          onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', track.filePath); setDraggedMixPath(track.filePath); }}
                          onDragEnd={() => { setDraggedMixPath(null); setDragOverMixPath(null); }}>Drag</span>
                        <button className="mix-preview-choice" onClick={() => selectPreviewTrack(index)} title="Preview this song">{String(index + 1).padStart(2, '0')}</button>
                        {album.coverPath && <img src={`file:///${album.coverPath.replace(/\\/g, '/')}`} alt="" />}
                        <span><strong>{track.title}</strong><small>{album.albumName}</small></span>
                        <button onClick={() => moveMixTrack(index, -1)} disabled={index === 0} aria-label={`Move ${track.title} up`}>↑</button>
                        <button onClick={() => moveMixTrack(index, 1)} disabled={index === orderedMixTracks.length - 1} aria-label={`Move ${track.title} down`}>↓</button>
                        <button onClick={() => toggleMixTrack(track.filePath)} aria-label={`Remove ${track.title}`}>×</button>
                      </div>
                    )) : <p className="mix-empty">Select songs on the left. Click a number to preview it, or drag rows to reorder.</p>}
                  </section>
                </div>
              </div>
            )}

            {/* Queue Tab */}
            {activeTab === 'queue' && (
              <div className="table-container" style={{ padding: '15px' }}>
                <div style={{ marginBottom: '15px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                  <h3 style={{ margin: 0 }}>Rendering queue ({albums.filter(a => a.status === 'queued' || a.status === 'processing').length} active)</h3>
                </div>

                {albums.filter(a => a.status !== 'idle').length > 0 ? (
                  <table className="album-table queue-table">
                    <thead>
                      <tr>
                        <th>Album</th>
                        <th>Tracks</th>
                        <th>Progress</th>
                        <th>Status</th>
                        <th className="queue-open-column" aria-label="Open video"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {albums.filter(a => a.status !== 'idle').map(album => (
                        <tr key={album.id}>
                          <td className="album-title-cell">{album.albumName}</td>
                          <td>{album.tracksCount} tracks</td>
                          <td style={{ width: '40%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div className="progress-bar-container" style={{ flex: 1, height: '8px' }}>
                                <div className="progress-bar-fill" style={{ width: `${album.progress}%` }}></div>
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 'bold' }}>{album.progress}%</span>
                            </div>
                          </td>
                          <td>
                            <span className={`badge badge-status badge-status-${album.status}`}>
                              {album.status}
                            </span>
                            {album.error && <div style={{ color: 'var(--accent-danger)', fontSize: '10px', marginTop: '4px' }}>{album.error}</div>}
                          </td>
                          <td className="queue-open-column">
                            <button
                              type="button"
                              className="queue-open-video"
                              aria-label={`Open rendered video for ${album.albumName}`}
                              title={album.outputVideoPath ? 'Open rendered video' : 'Video available after rendering completes'}
                              disabled={album.status !== 'completed' || !album.outputVideoPath}
                              onClick={() => album.outputVideoPath && handleOpenRenderedVideo(album.outputVideoPath)}
                            >
                              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="10.8" cy="10.8" r="6.3" />
                                <path d="m15.5 15.5 5 5" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">⚡</div>
                    <h3>No Active Renders</h3>
                    <p style={{ fontSize: '13px' }}>Select albums in the Library tab and trigger compilation to see progress lists.</p>
                  </div>
                )}
              </div>
            )}

            {/* Logs Tab */}
            {activeTab === 'logs' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ margin: 0 }}>Terminal output log</h3>
                  <div className="log-actions">
                    <button className="btn btn-secondary" onClick={handleCopyLogs} disabled={logs.length === 0}>
                      {logsCopied ? 'Copied' : 'Copy Logs'}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setLogs([])}>Clear Console</button>
                  </div>
                </div>
                <div className="terminal-card">
                  {logs.length > 0 ? (
                    logs.map((log) => (
                      <div key={log.id} className={`log-row ${log.type}`}>
                        [{log.timestamp}] {log.text}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Terminal idling. Spawn commands to view diagnostic pipelines...</div>
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                
                <div className="settings-section-title">Directory paths configurations</div>
                <div className="input-group" style={{ marginBottom: '15px' }}>
                  <span className="input-label">Output video target directory</span>
                  <div className="picker-row" style={{ gap: '6px' }}>
                    <input 
                      type="text" 
                      className="text-input" 
                      readOnly 
                      value={settings.outputFolder} 
                      placeholder="Please select an output folder" 
                    />
                    <button className="btn btn-secondary" onClick={handleSelectOutput}>Choose Path</button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0 12px', fontSize: '11px', flexShrink: 0 }}
                      onClick={runOutputPreflight}
                      disabled={!settings.outputFolder || outputCheck.checking}
                    >
                      {outputCheck.checking ? 'Checking…' : '✅ Test'}
                    </button>
                  </div>

                  {settings.outputFolder && (
                    <div style={{
                      marginTop: '10px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--glass-border)',
                      fontSize: '11px',
                      lineHeight: 1.55,
                      background:
                        outputCheck.checking ? 'rgba(255,193,7,0.07)' :
                        outputCheck.ok === true ? 'rgba(46,204,113,0.07)' :
                        outputCheck.ok === false ? 'rgba(231,76,60,0.07)' :
                        'var(--glass-bg)',
                      borderColor:
                        outputCheck.ok === true ? 'rgba(46,204,113,0.35)' :
                        outputCheck.ok === false ? 'rgba(231,76,60,0.35)' :
                        'var(--glass-border)'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '3px', color:
                        outputCheck.checking ? '#f39c12' :
                        outputCheck.ok === true ? '#2ecc71' :
                        outputCheck.ok === false ? '#e74c3c' :
                        'var(--text-secondary)'
                      }}>
                        {outputCheck.checking
                          ? '⏳ Verifying write access…'
                          : outputCheck.ok === true
                            ? '✅ Output folder is writable'
                            : outputCheck.ok === false
                              ? '⛔ Output folder is NOT writable'
                              : 'ℹ️  Click "Test" to verify write access before rendering'}
                      </div>
                      {outputCheck.message && (
                        <div style={{ color: 'var(--text-secondary)', fontFamily: 'Consolas, Menlo, monospace', wordBreak: 'break-word' }}>
                          {outputCheck.message}
                        </div>
                      )}
                      {outputCheck.ok === false && (
                        <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                          💡 TRAE sandbox and/or network-share permissions typically block writes to UNC paths like <code>Z:\</code>. Pick a local folder like{' '}
                          <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>C:\Videos</code>,{' '}
                          <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>D:\Renders</code>, or your Desktop.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="input-group" style={{ marginBottom: '20px' }}>
                    <span className="input-label">FFmpeg executable (optional override)</span>
                  <div className="picker-row">
                    <input 
                      type="text" 
                      className="text-input" 
                      value={settings.ffmpegPath} 
                      onChange={(e) => updateSettings({ ffmpegPath: e.target.value })}
                      placeholder="ffmpeg (uses bundled copy)"
                    />
                    <button className="btn btn-secondary" onClick={handleVerifyFfmpeg}>Test Binary</button>
                    <button className="btn btn-secondary" onClick={handleDetectGpu}>Check Encoders</button>
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Leave as 'ffmpeg' to use the copy bundled with AlbumForge. Enter a full path only to override it.</span>
                </div>

                <div className="settings-section-title">Video encoding parameters</div>
                <div className="settings-grid">
                  <div className="input-group">
                    <span className="input-label">Video encoding engine</span>
                    <select 
                      className="select-input"
                      value={selectedVideoCodec}
                      onChange={(e) => updateSettings({ videoCodec: e.target.value as any })}
                    >
                      <option value="auto">Auto — hardware when available</option>
                      {window.api.platform === 'darwin' && <option value="h264_videotoolbox">Apple VideoToolbox (hardware)</option>}
                      {window.api.platform !== 'darwin' && <option value="h264_qsv">Intel Quick Sync (h264_qsv)</option>}
                      {window.api.platform !== 'darwin' && <option value="h264_nvenc">NVIDIA NVENC (h264_nvenc)</option>}
                      {window.api.platform !== 'darwin' && <option value="h264_amf">AMD AMF (h264_amf)</option>}
                      <option value="libx264">CPU Software (libx264)</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Video resolution</span>
                    <select 
                      className="select-input"
                      value={settings.resolution}
                      onChange={(e) => updateSettings({ resolution: e.target.value as any })}
                    >
                      <option value="1920x1080">1080p Full HD (1920x1080) - Recommended</option>
                      <option value="1280x720">720p HD (1280x720) - Faster rendering</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Frame rate</span>
                    <span className="input-hint">Still portions use about 1 fps; Cover Flow transitions use 30 fps</span>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Video export quality</span>
                    <select 
                      className="select-input"
                      value={settings.exportQuality}
                      onChange={(e) => updateSettings({ exportQuality: e.target.value as any })}
                    >
                      <option value="high">High Quality (Larger files)</option>
                      <option value="medium">Balanced (Standard YouTube)</option>
                      <option value="small">Compact (Faster upload)</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Audio encoding</span>
                    <select
                      className="select-input"
                      value={settings.audioCodec || 'alac'}
                      aria-label="Audio encoding"
                      onChange={(e) => updateSettings({ audioCodec: e.target.value as RenderSettings['audioCodec'] })}
                    >
                      <option value="alac">Lossless ALAC — preserve source audio (larger MP4)</option>
                      <option value="aac">AAC-LC 384 kb/s — YouTube-friendly (lossy)</option>
                    </select>
                    <span className="input-hint">{settings.audioCodec === 'aac' ? 'AAC is lossy. Choose Lossless ALAC for the best source-preserving local export. ' : 'Lossless ALAC avoids an additional lossy audio codec. '}Audio quality is independent of video quality. Mixed-format songs are resampled/upmixed to the highest source sample rate and channel count. YouTube processes uploads separately; lossless streaming cannot be guaranteed.</span>
                  </div>
                </div>

                <div className="settings-section-title">App interface theme</div>
                <div className="theme-selector-grid">
                  <div 
                    className={`theme-card ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    <span className="theme-icon">🌙</span>
                    <div>
                      <div className="theme-card-title">Dark Theme</div>
                      <div className="theme-card-desc">Sleek, high contrast dark workspace</div>
                    </div>
                  </div>
                  <div 
                    className={`theme-card ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    <span className="theme-icon">☀️</span>
                    <div>
                      <div className="theme-card-title">Light Theme</div>
                      <div className="theme-card-desc">Clean, bright daytime workspace</div>
                    </div>
                  </div>
                </div>

                <div className="settings-section-title">Album artwork presentation</div>
                <div className="artwork-theme-choices" role="radiogroup" aria-label="Artwork theme">
                  {([
                    ['plain', 'Classic cover', 'A clean, full-size album cover'],
                    ['jewel', 'CD jewel case', 'The transparent CD case around each cover'],
                    ['coverflow', 'Cover Flow', 'Current cover with previous and next covers'],
                  ] as const).map(([value, label, description]) => (
                    <label key={value} className={`artwork-theme-choice ${getArtworkTheme(settings) === value ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name="artwork-theme"
                        value={value}
                        checked={getArtworkTheme(settings) === value}
                        onChange={() => updateSettings({ artworkTheme: value, useJewelCase: value === 'jewel' })}
                      />
                      <span><strong>{label}</strong><small>{description}</small></span>
                    </label>
                  ))}
                </div>
                {getArtworkTheme(settings) === 'coverflow' ? <div className="coverflow-size-settings">
                  <label className="input-group"><span className="input-label">Song title size <strong>{coverflowFontSizes.song} px</strong></span><input type="range" min="24" max="72" step="2" value={coverflowFontSizes.song} onChange={event => updateSettings({ coverflowSongFontSize: Number(event.target.value) })} /></label>
                  <label className="input-group"><span className="input-label">Album name and year size <strong>{coverflowFontSizes.album} px</strong></span><input type="range" min="18" max="48" step="2" value={coverflowFontSizes.album} onChange={event => updateSettings({ coverflowAlbumFontSize: Number(event.target.value) })} /></label>
                  <small>Sizes are based on 1080p and scale for 720p/preview. Captions stay within the centre cover width. Long titles and album names end in an ellipsis.</small>
                </div> : <div className="coverflow-size-settings track-size-settings">
                  <label className="input-group"><span className="input-label">Song list title size <strong>{trackFontSizes.title} px</strong></span><input aria-label="Song list title size" type="range" min="24" max="64" step="2" value={trackFontSizes.title} onChange={event => updateSettings({ trackTitleFontSize: Number(event.target.value) })} /></label>
                  <label className="input-group"><span className="input-label">Artist name size <strong>{trackFontSizes.artist} px</strong></span><input aria-label="Artist name size" type="range" min="12" max="36" step="2" value={trackFontSizes.artist} onChange={event => updateSettings({ trackArtistFontSize: Number(event.target.value) })} /></label>
                  <small>Sizes are based on 1080p and scale for 720p/preview. Rows grow with the text, using minimal gaps. Long lists follow the active song without shrinking your chosen sizes or hiding artist names.</small>
                </div>}

                <div className="settings-section-title">Predefined video color palettes</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Select a curated designer palette or customize individual colors below:
                </div>
                <div className="palette-preset-grid">
                  {PREDEFINED_PALETTES.map(palette => {
                    const isSelected = 
                      settings.backgroundColor.toLowerCase() === palette.backgroundColor.toLowerCase() &&
                      settings.activeColor.toLowerCase() === palette.activeColor.toLowerCase() &&
                      settings.inactiveColor.toLowerCase() === palette.inactiveColor.toLowerCase();
                    return (
                      <div 
                        key={palette.id}
                        className={`palette-card ${isSelected ? 'active' : ''}`}
                        onClick={() => applyPalette(palette)}
                        title={`Apply ${palette.name} palette`}
                      >
                        <div className="palette-preview-bar">
                          <div 
                            className="palette-color-slice" 
                            style={{ width: '42%', backgroundColor: palette.backgroundColor }} 
                            title={`Background: ${palette.backgroundColor}`}
                          />
                          <div 
                            className="palette-color-slice" 
                            style={{ width: '33%', backgroundColor: palette.activeColor }} 
                            title={`Active Song: ${palette.activeColor}`}
                          />
                          <div 
                            className="palette-color-slice" 
                            style={{ width: '25%', backgroundColor: palette.inactiveColor }} 
                            title={`Inactive Song: ${palette.inactiveColor}`}
                          />
                        </div>
                        <div className="palette-info">
                          <span className="palette-name">{palette.name}</span>
                          {isSelected ? (
                            <span className="palette-badge">✓ ACTIVE</span>
                          ) : (
                            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{palette.tag}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="settings-section-title">Custom color & typography overrides</div>
                <div className="settings-grid">
                  <div className="input-group">
                    <span className="input-label">Text font family</span>
                    <select 
                      className="select-input"
                      value={settings.fontFamily}
                      onChange={(e) => updateSettings({ fontFamily: e.target.value })}
                    >
                      {SYSTEM_FONTS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Background color hex</span>
                    <input 
                      type="color" 
                      className="text-input" 
                      style={{ height: '38px', padding: '2px', cursor: 'pointer' }}
                      value={settings.backgroundColor} 
                      onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
                    />
                  </div>
                  <div className="input-group">
                    <span className="input-label">Active song color</span>
                    <div className="color-picker-row">
                      <input 
                        type="color" 
                        className="color-box-input"
                        value={settings.activeColor} 
                        onChange={(e) => updateSettings({ activeColor: e.target.value })}
                      />
                      <input type="text" className="text-input" value={settings.activeColor} onChange={(e) => updateSettings({ activeColor: e.target.value })} />
                    </div>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Inactive song color</span>
                    <div className="color-picker-row">
                      <input 
                        type="color" 
                        className="color-box-input"
                        value={settings.inactiveColor} 
                        onChange={(e) => updateSettings({ inactiveColor: e.target.value })}
                      />
                      <input type="text" className="text-input" value={settings.inactiveColor} onChange={(e) => updateSettings({ inactiveColor: e.target.value })} />
                    </div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                  <label className="checkbox-row">
                    <input 
                      type="checkbox" 
                      className="checkbox-input" 
                      checked={settings.artistItalic}
                      onChange={(e) => updateSettings({ artistItalic: e.target.checked })}
                    />
                    Render singer/artist below titles in italic font
                  </label>
                </div>

                <div className="settings-section-title" style={{ marginTop: '25px' }}>Batch production & fast resume</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  <label className="checkbox-row">
                    <input 
                      type="checkbox" 
                      className="checkbox-input" 
                      checked={settings.skipExisting}
                      onChange={(e) => updateSettings({ skipExisting: e.target.checked })}
                    />
                    <span><strong>Skip already rendered albums (Fast Resume)</strong> — Skips albums if their finished MP4 already exists in the output folder. Essential for uninterrupted 1,000+ album batch jobs.</span>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', padding: '12px 14px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '10px', gap: '14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>Smart scan cache</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        Album fingerprints (file list + sizes + mtimes) are saved to <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, fontSize: '10px' }}>scan_cache.json</code> so re-scanning the same folder takes seconds instead of minutes. Cache is automatically invalidated per-folder whenever any audio or cover file changes.
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '8px 14px', fontSize: '11px', whiteSpace: 'nowrap', flexShrink: 0 }}
                      onClick={async () => {
                        if (!confirm('Clear the persistent album scan cache? Next library scan will rebuild everything from scratch.')) return;
                        const ok = await window.api.clearScanCache();
                        alert(ok ? 'Scan cache cleared successfully.' : 'Failed to clear scan cache.');
                      }}
                    >
                      🗑️ Clear Scan Cache
                    </button>
                  </div>
                </div>

              </div>
            )}

          </div>

          {/* Right sidebar: Live Visual Layout Preview */}
          {showPreviewPane ? (
            <aside className="preview-pane-shell">
              <div
                className="preview-resize-handle"
                role="separator"
                aria-label="Resize live preview section"
                aria-orientation="vertical"
                aria-valuemin={PREVIEW_PANE_MIN_WIDTH}
                aria-valuemax={PREVIEW_PANE_MAX_WIDTH}
                aria-valuenow={previewPaneWidth}
                tabIndex={0}
                title="Drag to resize the Live Preview section"
                onPointerDown={handlePreviewResizeStart}
                onKeyDown={handlePreviewResizeKeyDown}
              >
                <span className="preview-resize-grip" aria-hidden="true" />
              </div>
              <section className="side-pane" aria-label="Live preview panel">
                <div className="preview-header-bar">
                  <div
                    className="preview-title-group"
                    onClick={togglePreviewCanvas}
                    title={showPreviewCanvas ? 'Hide preview canvas' : 'Show preview canvas'}
                  >
                    <button className="preview-chevron-btn" aria-label="Toggle preview canvas">
                      <svg
                        className="preview-chevron-icon"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ transform: showPreviewCanvas ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <span className="preview-heading-copy">
                      <span className="preview-eyebrow">Output monitor</span>
                      <span className="preview-title">Live Preview</span>
                    </span>
                  </div>

                  <div className="preview-header-actions">
                    <span className="preview-format-pill">16:9</span>
                    <button
                      className="btn-preview-hide"
                      onClick={() => togglePreviewPane(false)}
                      title="Hide Live Preview section"
                      aria-label="Hide Live Preview section"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="preview-pane-body">
                  {selectedAlbum ? (
                    <>
                      {showPreviewCanvas && (
                        <div className="preview-stage-card">
                          <div className={`visual-preview-canvas ${getArtworkTheme(settings) === 'coverflow' ? 'preview-flow-layout' : ''}`} style={{ backgroundColor: settings.backgroundColor }}>
                            <div className="canvas-bg-glow" />
                            {getArtworkTheme(settings) === 'coverflow' ? (
                              <div className="preview-coverflow-stage" style={{ fontFamily: settings.fontFamily }}>
                                {Array.from({ length: previewFlowSideCount * 2 + 1 }, (_, index) => index - previewFlowSideCount).map(offset => {
                                  const index = (previewActiveIndex + offset + selectedAlbum.tracks.length) % selectedAlbum.tracks.length;
                                  const coverPath = selectedAlbum.tracks[index].coverPath || selectedAlbum.coverPath;
                                  const position = offset === 0 ? 'center' : `${offset < 0 ? 'left' : 'right'}-${Math.abs(offset)}`;
                                  return <div key={`${index}-${selectedAlbum.tracks[index].filePath}`} className={`preview-flow-item preview-flow-${position}`}>
                                    {coverPath ? <><img className="preview-flow-cover" src={`file:///${coverPath.replace(/\\/g, '/')}`} alt="" /><img className="preview-flow-reflection" src={`file:///${coverPath.replace(/\\/g, '/')}`} alt="" /></> : <div className="preview-flow-fallback">AF</div>}
                                  </div>;
                                })}
                                <div className="preview-coverflow-caption"><strong style={{ fontSize: `${coverflowFontSizes.song / 19.2}cqw` }}>{selectedAlbum.tracks[previewActiveIndex]?.title}</strong><small style={{ fontSize: `${coverflowFontSizes.album / 19.2}cqw` }}>{selectedAlbum.tracks[previewActiveIndex]?.album || selectedAlbum.albumName} | {selectedAlbum.tracks[previewActiveIndex]?.year || selectedAlbum.year}</small></div>
                              </div>
                            ) : <>
                            <div className="preview-left">
                              <div className={`preview-cover-art-container ${getArtworkTheme(settings) === 'jewel' ? 'jewel-case-enabled' : ''}`}>
                                {selectedAlbum.coverFound && selectedAlbum.coverPath ? (
                                  <img className="preview-cover-art" src={`file:///${(selectedAlbum.tracks[previewActiveIndex]?.coverPath || selectedAlbum.coverPath).replace(/\\/g, '/')}`} />
                                ) : (
                                  <div className="preview-cover-placeholder">
                                    <span>AF</span>
                                    {selectedAlbum.albumName.slice(0, 20)}
                                  </div>
                                )}
                                {getArtworkTheme(settings) === 'jewel' && (
                                  <img className="preview-jewel-case-overlay" src={jewelCaseOverlay} alt="" />
                                )}
                              </div>
                            </div>

                            <div className="preview-right" style={{ fontFamily: settings.fontFamily }}>
                              <div className="preview-album-header">
                                <div className="preview-album-name">{selectedAlbum.albumName}</div>
                                <div className="preview-album-meta">
                                  {selectedAlbum.year} &bull; {selectedAlbum.tracksCount} Songs &bull; {totalDurationStr(selectedAlbum.totalDuration)}
                                  {previewTrackLayout && selectedAlbum.tracks.length > previewTrackLayout.end - previewTrackLayout.start &&
                                    <> &bull; Showing {previewTrackLayout.start + 1}-{previewTrackLayout.end}</>}
                                </div>
                              </div>

                              <div
                                className={`preview-tracklist ${previewTrackLayout!.compact ? 'preview-dense' : ''}`}
                                style={{
                                  gridTemplateRows: `repeat(${previewTrackLayout!.rows}, minmax(0, 1fr))`,
                                  maxHeight: `${previewTrackLayout!.rows * previewTrackLayout!.rowHeight / previewTrackLayout!.frameWidth * 100}cqw`,
                                  fontSize: `${previewTrackLayout!.metaSize / previewTrackLayout!.frameWidth * 100}cqw`,
                                }}
                              >
                                {selectedAlbum.tracks.slice(previewTrackLayout!.start, previewTrackLayout!.end).map((track, i) => (
                                  <div
                                    key={track.id}
                                    className={`preview-track-item ${i + previewTrackLayout!.start === previewActiveIndex ? 'preview-track-active' : ''}`}
                                    style={{ color: i + previewTrackLayout!.start === previewActiveIndex ? settings.activeColor : settings.inactiveColor }}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => selectPreviewTrack(i + previewTrackLayout!.start)}
                                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPreviewTrack(i + previewTrackLayout!.start); } }}
                                    aria-label={`Preview ${track.title}`}
                                  >
                                    <div className="preview-track-num-col">
                                      <span className="preview-track-play-mark" aria-hidden="true" style={{ visibility: i + previewTrackLayout!.start === previewActiveIndex ? 'visible' : 'hidden' }}>▶</span>
                                      <span>{String(track.trackNumber || i + previewTrackLayout!.start + 1).padStart(2, '0')}</span>
                                    </div>
                                    <div className="preview-track-info-col">
                                      <div className="preview-track-title" style={{ fontSize: `${previewTrackLayout!.titleSize / previewTrackLayout!.frameWidth * 100}cqw` }}>{track.title}</div>
                                      {!previewTrackLayout!.compact &&
                                        <div className="preview-track-artist" style={{ fontSize: `${previewTrackLayout!.artistSize / previewTrackLayout!.frameWidth * 100}cqw`, fontStyle: settings.artistItalic ? 'italic' : 'normal' }}>
                                          {track.artist}
                                        </div>}
                                    </div>
                                    <div className="preview-track-duration" style={{ color: i + previewTrackLayout!.start === previewActiveIndex ? settings.activeColor : settings.inactiveColor }}>
                                      {formatTrackTime(track.duration)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            </>}
                          </div>
                          {selectedAlbum.tracks.length > 1 && <div className="preview-transport" aria-label="Song slide preview controls">
                            <button type="button" onClick={() => stepPreviewTrack(-1)} aria-label="Previous song">‹</button>
                            <button type="button" onClick={() => setPreviewPlaying(previous => !previous)} aria-label={previewPlaying ? 'Pause slide preview' : 'Play slide preview'}>{previewPlaying ? 'Pause' : 'Play slides'}</button>
                            <button type="button" onClick={() => stepPreviewTrack(1)} aria-label="Next song">›</button>
                            <input type="range" min={0} max={selectedAlbum.tracks.length - 1} value={previewActiveIndex} onChange={event => selectPreviewTrack(Number(event.target.value))} aria-label="Jump to song" />
                            <span>{previewActiveIndex + 1} / {selectedAlbum.tracks.length}</span>
                          </div>}
                          <div className="preview-stage-meta">
                            <span><i /> Slide sequence preview · no audio</span>
                            <span>{settings.resolution} · {getArtworkTheme(settings) === 'coverflow' ? 'animated covers' : 'static slides'}</span>
                          </div>
                        </div>
                      )}

                      <div className="album-overview-card">
                        <div className="album-overview-heading">
                          <span>Album overview</span>
                          <span className="album-ready-badge">Ready</span>
                        </div>
                        <div className="album-overview-list">
                          <div className="album-overview-row">
                            <span>Folder</span>
                            <strong>{selectedAlbum.folderPath.split(/[\\/]/).pop()}</strong>
                          </div>
                          <div className="album-overview-row">
                            <span>Tracks</span>
                            <strong>{selectedAlbum.tracksCount} files</strong>
                          </div>
                          <div className="album-overview-row">
                            <span>Duration</span>
                            <strong>{totalDurationStr(selectedAlbum.totalDuration)}</strong>
                          </div>
                          <div className="album-overview-row">
                            <span>Audio</span>
                            <strong className="album-format-value">
                              {Array.from(new Set(selectedAlbum.tracks.map(t => t.fileName.split('.').pop()?.toUpperCase()))).join(', ')}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : showPreviewCanvas ? (
                    <div className="preview-empty-state">
                      <img src={appLogo} alt="" />
                      <strong>Select an album to preview</strong>
                      <p>Choose any scanned folder from the library to inspect its final video layout here.</p>
                    </div>
                  ) : (
                    <div className="preview-canvas-hidden">Preview hidden. Use the chevron above to expand it.</div>
                  )}
                </div>
              </section>
            </aside>
          ) : (
            <aside
              className="side-pane-collapsed" 
              onClick={() => togglePreviewPane(true)} 
              title="Show Live Preview section"
            >
              <button className="collapsed-preview-btn" title="Show Live Preview section">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <span className="collapsed-preview-text">Live Preview</span>
            </aside>
          )}

        </div>
      </main>

      {/* 3. Metadata Inline Editor Dialog Backdrop Overlay */}
      {editingAlbum && (
        <div className="editor-backdrop">
          <div className="editor-dialog">
            <header className="editor-header">
              <span className="editor-title">✏️ Edit Album Library Metadata Cache</span>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px' }}
                onClick={() => setEditingAlbum(null)}
              >
                ✕
              </button>
            </header>

            <div className="editor-body">
              {/* Album general edits */}
              <div className="settings-grid" style={{ marginBottom: '20px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '20px' }}>
                <div className="input-group">
                  <span className="input-label">Album Title</span>
                  <input 
                    type="text" 
                    className="text-input" 
                    value={editingAlbum.albumName}
                    onChange={(e) => setEditingAlbum({ ...editingAlbum, albumName: e.target.value })}
                  />
                </div>
                <div className="input-group">
                  <span className="input-label">Release Year</span>
                  <input 
                    type="text" 
                    className="text-input" 
                    value={editingAlbum.year}
                    onChange={(e) => setEditingAlbum({ ...editingAlbum, year: e.target.value })}
                  />
                </div>
              </div>

              {/* Tracks titles edits */}
              <span className="input-label" style={{ display: 'block', marginBottom: '12px' }}>Song tracklist tags overrides</span>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="track-editor-row" style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                  <div>No.</div>
                  <div>Song Track Title</div>
                  <div>Singer / Artist</div>
                  <div style={{ textAlign: 'right' }}>Time</div>
                </div>

                {editingAlbum.tracks.map((track) => (
                  <div key={track.id} className="track-editor-row">
                    <input 
                      type="number" 
                      className="text-input"
                      style={{ padding: '8px' }}
                      value={track.trackNumber || ''} 
                      onChange={(e) => updateEditingTrack(track.id, { trackNumber: Number(e.target.value) })}
                    />
                    <input 
                      type="text" 
                      className="text-input" 
                      value={track.title} 
                      onChange={(e) => updateEditingTrack(track.id, { title: e.target.value })}
                    />
                    <input 
                      type="text" 
                      className="text-input" 
                      value={track.artist} 
                      onChange={(e) => updateEditingTrack(track.id, { artist: e.target.value })}
                    />
                    <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)', paddingRight: '8px' }}>
                      {totalDurationStr(track.duration)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="editor-footer">
              <button className="btn btn-secondary" onClick={() => setEditingAlbum(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveEditedMetadata}>Save overrides</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
