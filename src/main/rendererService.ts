import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Album, RenderSettings } from '../shared/types';

/**
 * Escapes HTML characters to prevent XSS/rendering issues with metadata text.
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats duration in seconds to MM:SS or HH:MM:SS.
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const minsStr = String(mins).padStart(2, '0');
  const secsStr = String(secs).padStart(2, '0');

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${minsStr}:${secsStr}`;
  }
  return `${minsStr}:${secsStr}`;
}

/**
 * Generates an elegant SVG cover art design as a fallback placeholder.
 */
function getDefaultCoverSVG(albumName: string, year: string): string {
  const hash = albumName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  
  // A beautiful radial vinyl record svg placeholder
  return `
    <svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="hsl(${hue}, 80%, 35%)" />
          <stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 90%, 12%)" />
        </radialGradient>
        <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="white" stop-opacity="0.15" />
          <stop offset="50%" stop-color="white" stop-opacity="0" />
          <stop offset="100%" stop-color="black" stop-opacity="0.4" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#bg-grad)" />
      
      <!-- Vinyl record visual -->
      <circle cx="200" cy="200" r="160" fill="#111" stroke="#333" stroke-width="1.5" />
      <circle cx="200" cy="200" r="140" fill="none" stroke="#222" stroke-width="2" stroke-dasharray="10 4" />
      <circle cx="200" cy="200" r="120" fill="none" stroke="#222" stroke-width="1.5" stroke-dasharray="1 3" />
      <circle cx="200" cy="200" r="100" fill="none" stroke="#222" stroke-width="2" />
      <circle cx="200" cy="200" r="80" fill="none" stroke="#222" stroke-width="1" />
      
      <!-- Center Sticker -->
      <circle cx="200" cy="200" r="60" fill="hsl(${(hue + 180) % 360}, 60%, 40%)" />
      <circle cx="200" cy="200" r="12" fill="#000" />
      
      <!-- Overlaid details -->
      <text x="200" y="80" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="bold" font-size="22" opacity="0.9">${escapeHtml(albumName.slice(0, 20))}</text>
      <text x="200" y="340" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="600" font-size="14" opacity="0.6">${escapeHtml(year)}</text>
      
      <!-- Plastic Reflection -->
      <rect width="400" height="400" fill="url(#shine)" pointer-events="none" />
    </svg>
  `;
}

/**
 * Returns HTML document for a specific slide with track-active highlighting.
 */
export function getSlideHTML(
  album: Album,
  activeTrackIndex: number,
  settings: RenderSettings,
  coverBase64: string | null,
  jewelCaseBase64: string | null = null
): string {
  const trackCount = album.tracks.length;
  let titleSize = '28px';
  let artistSize = '18px';
  let itemGap = '18px';
  let padding = '20px';
  let activeIconSize = '24px';
  
  if (trackCount > 24) {
    titleSize = '14px';
    artistSize = '10px';
    itemGap = '4px';
    padding = '6px';
    activeIconSize = '14px';
  } else if (trackCount > 16) {
    titleSize = '18px';
    artistSize = '12px';
    itemGap = '6px';
    padding = '10px';
    activeIconSize = '16px';
  } else if (trackCount > 10) {
    titleSize = '22px';
    artistSize = '14px';
    itemGap = '10px';
    padding = '14px';
    activeIconSize = '20px';
  } else if (trackCount > 6) {
    titleSize = '26px';
    artistSize = '16px';
    itemGap = '15px';
    padding = '18px';
    activeIconSize = '24px';
  } else {
    titleSize = '32px';
    artistSize = '20px';
    itemGap = '24px';
    padding = '24px';
    activeIconSize = '28px';
  }

  // Cover image source (base64 or SVG placeholder)
  let coverImgSrc = '';
  if (coverBase64) {
    const ext = album.coverPath ? path.extname(album.coverPath).replace('.', '') : 'jpeg';
    coverImgSrc = `data:image/${ext};base64,${coverBase64}`;
  } else {
    coverImgSrc = `data:image/svg+xml;utf8,${encodeURIComponent(getDefaultCoverSVG(album.albumName, album.year))}`;
  }

  const jewelCaseEnabled = settings.useJewelCase && Boolean(jewelCaseBase64);
  const coverContainerClass = jewelCaseEnabled ? 'cover-art-container jewel-case-enabled' : 'cover-art-container';
  const jewelCaseOverlayHTML = jewelCaseEnabled
    ? `<img class="jewel-case-overlay" src="data:image/png;base64,${jewelCaseBase64}" />`
    : '';

  // Adaptive tracklist viewport (up to 12 tracks to fit cleanly without overflowing)
  const maxVisibleTracks = 12;
  let tracksToRender = album.tracks;
  let renderOffset = 0;
  
  if (trackCount > maxVisibleTracks) {
    let start = activeTrackIndex - Math.floor(maxVisibleTracks / 2);
    if (start < 0) start = 0;
    let end = start + maxVisibleTracks;
    if (end > trackCount) {
      end = trackCount;
      start = Math.max(0, end - maxVisibleTracks);
    }
    tracksToRender = album.tracks.slice(start, end);
    renderOffset = start;
  }

  const trackItemsHTML = tracksToRender.map((track, relativeIndex) => {
    const actualIndex = relativeIndex + renderOffset;
    const isActive = actualIndex === activeTrackIndex;
    const color = isActive ? settings.activeColor : settings.inactiveColor;
    const artistStyle = settings.artistItalic ? 'font-style: italic;' : 'font-style: normal;';
    const activeClass = isActive ? 'track-active' : 'track-inactive';
    const trackNumDisplay = String(track.trackNumber || actualIndex + 1).padStart(2, '0');

    return `
      <div class="track-item ${activeClass}" style="margin-bottom: ${itemGap}; color: ${color}; padding-top: ${padding}; padding-bottom: ${padding};">
        <div class="track-icon-col">
          <span class="track-num" style="font-size: ${artistSize}; ${isActive ? `color: ${settings.activeColor}; font-weight: 700;` : ''}">${trackNumDisplay}</span>
        </div>
        <div class="track-info-col">
          <div class="track-title" style="font-size: ${titleSize};">${escapeHtml(track.title)}</div>
          <div class="track-artist" style="font-size: ${artistSize}; ${artistStyle}">${escapeHtml(track.artist)}</div>
        </div>
        <div class="track-duration" style="font-size: ${artistSize}; color: ${isActive ? color : 'rgba(255,255,255,0.3)'};">
          ${formatDuration(track.duration)}
        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          width: 100vw;
          height: 100vh;
          background-color: ${settings.backgroundColor};
          font-family: '${settings.fontFamily}', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          display: flex;
          color: white;
          overflow: hidden;
        }
        
        .container {
          width: 100%;
          height: 100%;
          display: flex;
          padding: 40px 50px;
          gap: 45px;
          align-items: center;
          background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0) 70%), 
                      linear-gradient(135deg, rgba(255,255,255,0.01) 0%, rgba(0,0,0,0.6) 100%);
        }

        /* Left Side: Cover Art (Large & Prominent) */
        .left-panel {
          flex: 0 0 52%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .cover-art-container {
          position: relative;
          height: 100%;
          max-height: 980px;
          aspect-ratio: 1/1;
          width: auto;
          max-width: 100%;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85);
          border-radius: 0;
          overflow: hidden;
          background: #111113;
          border: 1px solid rgba(255,255,255,0.12);
        }

        .cover-art-container.jewel-case-enabled {
          aspect-ratio: 1344 / 1170;
          background: transparent;
          border: none;
        }

        .cover-art {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .cover-art-container.jewel-case-enabled .cover-art {
          position: absolute;
          z-index: 1;
          top: 4%;
          left: 10.8%;
          width: 86.5%;
          height: 92%;
          object-fit: cover;
        }

        .jewel-case-overlay {
          position: absolute;
          z-index: 2;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        /* Right Side: Track List */
        .right-panel {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding-left: 10px;
          min-width: 0;
        }

        .album-header {
          margin-bottom: 30px;
          border-bottom: 2px solid rgba(255,255,255,0.06);
          padding-bottom: 20px;
        }

        .album-name {
          font-size: 40px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: #ffffff;
          line-height: 1.2;
          margin-bottom: 8px;
          text-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        .album-meta {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.45);
          font-weight: 500;
        }

        .tracklist {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          overflow: hidden;
        }

        .track-item {
          display: flex;
          align-items: center;
          border-radius: 8px;
          padding-left: 14px;
          padding-right: 14px;
          gap: 12px;
          transition: all 0.2s ease;
          background: transparent;
        }

        .track-active {
          background: rgba(255, 255, 255, 0.06);
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          border-left: 4px solid #ffffff;
          padding-left: 10px !important;
        }

        .track-icon-col {
          width: 32px;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          flex-shrink: 0;
        }

        .track-num {
          font-weight: 600;
          color: rgba(255,255,255,0.25);
          font-size: 14px;
        }

        .play-icon {
          color: #ffffff;
          animation: pulse 1.5s infinite alternate;
        }

        .track-info-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding-right: 10px;
          min-width: 0;
        }

        .track-title {
          font-weight: 700;
          line-height: 1.3;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-artist {
          font-weight: 400;
          opacity: 0.8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-duration {
          font-weight: 600;
          text-align: right;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          margin-left: auto;
          flex-shrink: 0;
        }

        @keyframes pulse {
          0% { opacity: 0.6; transform: scale(0.95); }
          100% { opacity: 1; transform: scale(1.05); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="left-panel">
          <div class="${coverContainerClass}">
            <img class="cover-art" src="${coverImgSrc}" />
            ${jewelCaseOverlayHTML}
          </div>
        </div>
        <div class="right-panel">
          <div class="album-header">
            <h1 class="album-name">${escapeHtml(album.albumName)}</h1>
            <div class="album-meta">
              <span>${album.year}</span> &bull; 
              <span>${album.tracksCount} Tracks</span> &bull; 
              <span>Total Duration: ${formatDuration(album.totalDuration)}</span>
            </div>
          </div>
          <div class="tracklist">
            ${trackItemsHTML}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Renders slide images for each track offscreen using a hidden Electron BrowserWindow
 * and captures them to the specified directory.
 */
export async function generateSlidesForAlbum(
  album: Album,
  settings: RenderSettings,
  outputDir: string
): Promise<string[]> {
  const [width, height] = settings.resolution.split('x').map(Number);
  
  // Load cover art into base64 once to reuse for all slides
  let coverBase64: string | null = null;
  if (album.coverPath && fs.existsSync(album.coverPath)) {
    try {
      const buffer = await fs.promises.readFile(album.coverPath);
      coverBase64 = buffer.toString('base64');
    } catch (err) {
      console.error('Failed to read cover image to base64:', err);
    }
  }

  let jewelCaseBase64: string | null = null;
  if (settings.useJewelCase) {
    const jewelCasePath = path.join(__dirname, '../../resources/cd-jewel-case-overlay.png');
    if (fs.existsSync(jewelCasePath)) {
      try {
        const buffer = await fs.promises.readFile(jewelCasePath);
        jewelCaseBase64 = buffer.toString('base64');
      } catch (err) {
        console.error('Failed to read CD jewel case overlay:', err);
      }
    }
  }

  // Create a hidden browser window
  const win = new BrowserWindow({
    show: false,
    width: width,
    height: height,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const slidePaths: string[] = [];

  try {
    for (let i = 0; i < album.tracks.length; i++) {
      const htmlContent = getSlideHTML(album, i, settings, coverBase64, jewelCaseBase64);
      
      // Load HTML directly as a data URI
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
      
      // Wait for layout paint (100ms for first slide to decode cover/fonts, 35ms for subsequent slides)
      await new Promise(resolve => setTimeout(resolve, i === 0 ? 100 : 35));
      
      const image = await win.webContents.capturePage();
      const resizedImage = image.resize({ width, height, quality: 'best' });
      const pngBuffer = resizedImage.toPNG();
      
      const slidePath = path.join(outputDir, `slide_${i}.png`);
      await fs.promises.writeFile(slidePath, pngBuffer);
      slidePaths.push(slidePath);
    }
  } finally {
    win.close();
  }

  return slidePaths;
}
