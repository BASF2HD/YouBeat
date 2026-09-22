import { useState, useEffect, useRef } from 'react';
import { Album, RenderSettings, LogItem, Track } from '../shared/types';
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
  const [activeTab, setActiveTab] = useState<'library' | 'queue' | 'logs' | 'settings'>('library');

  // General App settings
  const [settings, setSettings] = useState<RenderSettings>({
    resolution: '1920x1080',
    fps: 30,
    backgroundColor: '#000000',
    fontFamily: 'Outfit',
    activeColor: '#ffffff',
    inactiveColor: '#888888',
    artistItalic: true,
    useJewelCase: false,
    exportQuality: 'medium',
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
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Queue state
  const [isQueueRunning, setIsQueueRunning] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);

  // Logging state
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsCopied, setLogsCopied] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const selectAllAlbumsRef = useRef<HTMLInputElement>(null);

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
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings(prev => ({ ...prev, ...parsed }));
      } catch (err) {
        console.error('Failed to parse saved settings:', err);
      }
    }

    const savedRoot = localStorage.getItem('root_folder');
    if (savedRoot) {
      setRootFolder(savedRoot);
    }
  }, []);

  // Sync settings modifications to localStorage
  const updateSettings = (updated: Partial<RenderSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('render_settings', JSON.stringify(next));
      return next;
    });
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

    return () => {
      unsubscribeLog();
      unsubscribeAlbum();
      unsubscribeFinished();
    };
  }, []);

  // Autoscroll logger panel to the bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  const allAlbumsSelected = albums.length > 0 && albums.every(album => selectedAlbumIds.has(album.id));
  const someAlbumsSelected = albums.some(album => selectedAlbumIds.has(album.id));

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
    setSelectedAlbumIds(allAlbumsSelected ? new Set() : new Set(albums.map(album => album.id)));
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
    setLogs([]);
    setActiveTab('library');
    
    try {
      const results = await window.api.scanAlbums(rootFolder, settings.scanRecursive);
      setAlbums(results);
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
    }
  };

  // Selected albums compile trigger
  const handleRenderSelected = async () => {
    const selectedAlbums = albums.filter(album => selectedAlbumIds.has(album.id));
    if (selectedAlbums.length === 0) return;

    if (!settings.outputFolder) {
      alert('Please select an output folder in settings first!');
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
    if (albums.length === 0) return;
    
    if (!settings.outputFolder) {
      alert('Please select an output folder in settings first!');
      setActiveTab('settings');
      return;
    }

    const uncompleted = albums.filter(a => a.status !== 'completed');
    if (uncompleted.length === 0) {
      if (!confirm('All albums are already rendered. Re-render all?')) {
        return;
      }
    }

    try {
      setActiveTab('queue');
      setIsQueueRunning(true);
      
      const targetList = uncompleted.length > 0 ? uncompleted : albums;
      await window.api.renderAll(targetList, settings);
    } catch (err) {
      console.error(err);
    }
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
  const selectedAlbum = albums.find(a => a.id === selectedAlbumId) || null;
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
          {activeTab === 'library' && albums.length > 0 && (
            <>
              <button className="btn btn-secondary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleRenderSelected} disabled={selectedAlbumIds.size === 0 || isQueueRunning}>
                Render Selected ({selectedAlbumIds.size})
              </button>
              <button className="btn btn-primary" style={{ padding: '7px 14px', fontSize: '12px' }} onClick={handleRenderAll} disabled={isQueueRunning}>
                Render All ({albums.length})
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

                {/* Scanned Albums table */}
                {albums.length > 0 ? (
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
                        {albums.map((album) => (
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

            {/* Queue Tab */}
            {activeTab === 'queue' && (
              <div className="table-container" style={{ padding: '15px' }}>
                <div style={{ marginBottom: '15px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                  <h3 style={{ margin: 0 }}>Rendering queue ({albums.filter(a => a.status === 'queued' || a.status === 'processing').length} active)</h3>
                </div>

                {albums.filter(a => a.status !== 'idle').length > 0 ? (
                  <table className="album-table">
                    <thead>
                      <tr>
                        <th>Album</th>
                        <th>Tracks</th>
                        <th>Progress</th>
                        <th>Status</th>
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
                  <div className="picker-row">
                    <input 
                      type="text" 
                      className="text-input" 
                      readOnly 
                      value={settings.outputFolder} 
                      placeholder="Please select an output folder" 
                    />
                    <button className="btn btn-secondary" onClick={handleSelectOutput}>Choose Path</button>
                  </div>
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
                    <span className="input-label">Frame rate (FPS)</span>
                    <select 
                      className="select-input"
                      value={settings.fps}
                      onChange={(e) => updateSettings({ fps: Number(e.target.value) })}
                    >
                      <option value="30">30 Frames per second (Standard)</option>
                      <option value="24">24 Frames per second (Cinema)</option>
                      <option value="15">15 Frames per second (Fast render)</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <span className="input-label">Export quality</span>
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
                <label className={`jewel-case-setting ${settings.useJewelCase ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    className="checkbox-input"
                    checked={settings.useJewelCase}
                    onChange={(e) => updateSettings({ useJewelCase: e.target.checked })}
                  />
                  <img src={jewelCaseOverlay} alt="" />
                  <span className="jewel-case-setting-copy">
                    <strong>Add CD jewel case</strong>
                    <small>Frame album artwork with the supplied transparent jewel-case overlay in previews and final videos.</small>
                  </span>
                </label>

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
                          <div className="visual-preview-canvas" style={{ backgroundColor: settings.backgroundColor }}>
                            <div className="canvas-bg-glow" />

                            <div className="preview-left">
                              <div className={`preview-cover-art-container ${settings.useJewelCase ? 'jewel-case-enabled' : ''}`}>
                                {selectedAlbum.coverFound && selectedAlbum.coverPath ? (
                                  <img className="preview-cover-art" src={`file:///${selectedAlbum.coverPath.replace(/\\/g, '/')}`} />
                                ) : (
                                  <div className="preview-cover-placeholder">
                                    <span>AF</span>
                                    {selectedAlbum.albumName.slice(0, 20)}
                                  </div>
                                )}
                                {settings.useJewelCase && (
                                  <img className="preview-jewel-case-overlay" src={jewelCaseOverlay} alt="" />
                                )}
                              </div>
                            </div>

                            <div className="preview-right" style={{ fontFamily: settings.fontFamily }}>
                              <div className="preview-album-header">
                                <div className="preview-album-name">{selectedAlbum.albumName}</div>
                                <div className="preview-album-meta">
                                  {selectedAlbum.year} &bull; {selectedAlbum.tracksCount} Songs &bull; {totalDurationStr(selectedAlbum.totalDuration)}
                                </div>
                              </div>

                              <div className="preview-tracklist">
                                {selectedAlbum.tracks.slice(0, 6).map((track, i) => (
                                  <div
                                    key={track.id}
                                    className={`preview-track-item ${i === 0 ? 'preview-track-active' : ''}`}
                                    style={{ color: i === 0 ? settings.activeColor : settings.inactiveColor }}
                                  >
                                    <div className="preview-track-num-col">
                                      {String(track.trackNumber || i + 1).padStart(2, '0')}
                                    </div>
                                    <div className="preview-track-info-col">
                                      <div className="preview-track-title">{track.title}</div>
                                      <div className="preview-track-artist" style={{ fontStyle: settings.artistItalic ? 'italic' : 'normal' }}>
                                        {track.artist}
                                      </div>
                                    </div>
                                    <div className="preview-track-duration" style={{ color: i === 0 ? settings.activeColor : settings.inactiveColor }}>
                                      {formatTrackTime(track.duration)}
                                    </div>
                                  </div>
                                ))}
                                {selectedAlbum.tracks.length > 6 && (
                                  <div className="preview-more-tracks">+ {selectedAlbum.tracks.length - 6} more songs</div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="preview-stage-meta">
                            <span><i /> Layout preview</span>
                            <span>{settings.resolution} · {settings.fps} fps</span>
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
