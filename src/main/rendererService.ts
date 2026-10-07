import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Album, RenderSettings } from '../shared/types';
import { getTrackLayout } from '../shared/trackLayout';
import { getArtworkTheme } from '../shared/artworkTheme';
import { getCoverflowFontSizes, getCoverflowSideCount } from '../shared/coverflow';

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
  jewelCaseSrc: string | null = null,
  coverSources: string[] = []
): string {
  const trackCount = album.tracks.length;
  const layout = getTrackLayout(trackCount, activeTrackIndex, settings.resolution, settings);

  // Cover image source (base64 or SVG placeholder)
  let coverImgSrc = '';
  if (coverBase64) {
    const ext = album.coverPath ? path.extname(album.coverPath).replace('.', '') : 'jpeg';
    coverImgSrc = `data:image/${ext};base64,${coverBase64}`;
  } else {
    coverImgSrc = `data:image/svg+xml;utf8,${encodeURIComponent(getDefaultCoverSVG(album.albumName, album.year))}`;
  }

  const artworkTheme = getArtworkTheme(settings);
  const coverflowFontSizes = getCoverflowFontSizes(settings);
  coverImgSrc = coverSources[activeTrackIndex] || coverImgSrc;
  const jewelCaseEnabled = artworkTheme === 'jewel' && Boolean(jewelCaseSrc);
  const coverContainerClass = jewelCaseEnabled ? 'cover-art-container jewel-case-enabled' : 'cover-art-container';
  const jewelCaseOverlayHTML = jewelCaseEnabled
    ? `<img class="jewel-case-overlay" src="${escapeHtml(jewelCaseSrc!)}" />`
    : '';
  const coverflowCover = (index: number) => coverSources[index] || coverImgSrc;
  const sideCount = getCoverflowSideCount(trackCount);
  const flowOffsets = Array.from({ length: sideCount * 2 + 1 }, (_, index) => index - sideCount);
  const coverflowCards = flowOffsets.map(offset => {
    const index = (activeTrackIndex + offset + trackCount) % trackCount;
    const source = escapeHtml(coverflowCover(index));
    const position = offset === 0 ? 'center' : `${offset < 0 ? 'left' : 'right'}-${Math.abs(offset)}`;
    return `<div class="coverflow-item coverflow-${position}" data-flow-offset="${offset}"><img class="coverflow-cover" src="${source}" /><img class="coverflow-reflection" src="${source}" /></div>`;
  }).join('');
  const activeFlowTrack = album.tracks[activeTrackIndex];
  const flowAlbumName = activeFlowTrack?.album || album.albumName;
  const flowYear = activeFlowTrack?.year || album.year;
  const coverflowHTML = `
    <div class="coverflow-stage">
      ${coverflowCards}
      <div class="coverflow-caption"><strong>${escapeHtml(activeFlowTrack?.title || album.albumName)}</strong><small>${escapeHtml(flowAlbumName)} | ${escapeHtml(flowYear)}</small></div>
    </div>`;

  const tracksToRender = album.tracks.slice(layout.start, layout.end);

  const trackItemsHTML = tracksToRender.map((track, relativeIndex) => {
    const actualIndex = relativeIndex + layout.start;
    const isActive = actualIndex === activeTrackIndex;
    const color = isActive ? settings.activeColor : settings.inactiveColor;
    const artistStyle = settings.artistItalic ? 'font-style: italic;' : 'font-style: normal;';
    const activeClass = isActive ? 'track-active' : 'track-inactive';
    const trackNumDisplay = String(track.trackNumber || actualIndex + 1).padStart(2, '0');

    return `
      <div class="track-item ${activeClass}" style="color: ${color};">
        <div class="track-icon-col">
          <span class="track-play-mark" aria-hidden="true" style="visibility: ${isActive ? 'visible' : 'hidden'};">▶</span>
          <span class="track-num" style="font-size: ${layout.numberSize}px; ${isActive ? `color: ${settings.activeColor}; font-weight: 700;` : ''}">${trackNumDisplay}</span>
        </div>
        <div class="track-info-col">
          <div class="track-title" style="font-size: ${layout.titleSize}px;">${escapeHtml(track.title)}</div>
          ${layout.compact ? '' : `<div class="track-artist" style="font-size: ${layout.artistSize}px; ${artistStyle}">${escapeHtml(track.artist)}</div>`}
        </div>
        <div class="track-duration" style="font-size: ${layout.metaSize}px; color: ${isActive ? color : 'rgba(255,255,255,0.3)'};">
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
          padding: ${40 * layout.scale}px ${50 * layout.scale}px;
          gap: ${20 * layout.scale}px;
          align-items: center;
          background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0) 70%), 
                      linear-gradient(135deg, rgba(255,255,255,0.01) 0%, rgba(0,0,0,0.6) 100%);
        }

        /* Left Side: Cover Art (Large & Prominent) */
        .left-panel {
          flex: 0 0 46%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .cover-art-container {
          position: relative;
          height: auto;
          max-height: 100%;
          aspect-ratio: 1/1;
          width: 100%;
          max-width: 100%;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85);
          border-radius: 0;
          overflow: hidden;
          background: #111113;
          border: 1px solid rgba(255,255,255,0.12);
        }

        .cover-art-container.jewel-case-enabled {
          aspect-ratio: 3295 / 3008;
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
          /* Match the square artwork to the transparent case opening. */
          top: 2.36%;
          left: 10.68%;
          width: 87.65%;
          height: 96.01%;
          object-fit: contain;
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

        .container.coverflow-layout { display: block; padding: 0; background: #000; }
        .coverflow-stage { position: relative; width: 100%; height: 100%; perspective: 93.75vw; overflow: hidden; background: #000; }
        .coverflow-item { position: absolute; width: min(50vw, 72vh); aspect-ratio: 1; bottom: 24%; transform-style: preserve-3d; }
        .coverflow-cover, .coverflow-reflection { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
        .coverflow-cover { border: 1px solid rgba(255,255,255,.12); box-shadow: 0 10px 30px rgba(0,0,0,.8); }
        .coverflow-reflection { position: absolute; left: 0; top: 100%; transform: scaleY(-1); transform-origin: center; opacity: .32; -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,.7), transparent 65%); mask-image: linear-gradient(to top, rgba(0,0,0,.7), transparent 65%); }
        .coverflow-center { left: 50%; z-index: 7; transform: translateX(-50%); }
        /* Like NaviGlassPlayer, every side sleeve occupies the same plane and
           height. Only its horizontal position/depth changes through the row. */
        .coverflow-left-1, .coverflow-right-1, .coverflow-left-2, .coverflow-right-2, .coverflow-left-3, .coverflow-right-3, .coverflow-left-4, .coverflow-right-4 { bottom: 28%; width: min(42vw, 58vh); }
        .coverflow-left-1, .coverflow-right-1 { z-index: 6; }
        .coverflow-left-2, .coverflow-right-2 { z-index: 5; }
        .coverflow-left-3, .coverflow-right-3 { z-index: 4; }
        .coverflow-left-4, .coverflow-right-4 { z-index: 3; }
        .coverflow-left-1 { left: 29%; transform: translateX(-50%) rotateY(52deg); }
        .coverflow-right-1 { left: 71%; transform: translateX(-50%) rotateY(-52deg); }
        .coverflow-left-2 { left: 22%; transform: translateX(-50%) rotateY(52deg); }
        .coverflow-right-2 { left: 78%; transform: translateX(-50%) rotateY(-52deg); }
        .coverflow-left-3 { left: 15%; transform: translateX(-50%) rotateY(52deg); }
        .coverflow-right-3 { left: 85%; transform: translateX(-50%) rotateY(-52deg); }
        .coverflow-left-4 { left: 8%; transform: translateX(-50%) rotateY(52deg); }
        .coverflow-right-4 { left: 92%; transform: translateX(-50%) rotateY(-52deg); }
        .coverflow-caption { position: absolute; z-index: 10; left: 50%; width: min(50vw, 72vh); transform: translateX(-50%); top: calc(76% + ${8 * layout.scale}px); padding: 0 ${8 * layout.scale}px; display: flex; flex-direction: column; gap: ${4 * layout.scale}px; align-items: center; text-align: center; overflow: hidden; text-shadow: 0 2px 10px #000; }
        .coverflow-caption strong { font-size: ${coverflowFontSizes.song * layout.scale}px; line-height: 1.15; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .coverflow-caption small { font-size: ${coverflowFontSizes.album * layout.scale}px; line-height: 1.15; color: rgba(255,255,255,.78); width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Right Side: Track List */
        .right-panel {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          padding-left: 0;
          min-width: 0;
        }

        .album-header {
          margin-bottom: ${12 * layout.scale}px;
          border-bottom: 2px solid rgba(255,255,255,0.06);
          padding-bottom: ${12 * layout.scale}px;
          flex-shrink: 0;
        }

        .album-name {
          font-size: ${40 * layout.scale}px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: #ffffff;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: ${8 * layout.scale}px;
          text-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }

        .album-meta {
          font-size: ${16 * layout.scale}px;
          color: rgba(255, 255, 255, 0.45);
          font-weight: 500;
        }

        .tracklist {
          flex: 1;
          max-height: ${layout.rows * layout.rowHeight}px;
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: repeat(${layout.rows}, minmax(0, 1fr));
          overflow: hidden;
        }

        .track-item {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr) max-content;
          grid-template-rows: auto auto;
          align-content: center;
          align-items: center;
          border-radius: 4px;
          padding-left: ${8 * layout.scale}px;
          padding-right: ${8 * layout.scale}px;
          column-gap: ${8 * layout.scale}px;
          min-height: 0;
          background: transparent;
        }

        .track-active {
          background: rgba(255, 255, 255, 0.06);
        }

        .track-icon-col {
          grid-column: 1;
          grid-row: 1;
          width: ${layout.markerWidth}px;
          display: grid;
          grid-template-columns: ${layout.playSize}px minmax(0, 1fr);
          align-items: center;
          gap: ${layout.markerGap}px;
          flex-shrink: 0;
        }

        .track-play-mark { color: ${settings.activeColor}; font-size: ${layout.playSize}px; line-height: 1; }

        .track-num {
          line-height: 1;
          font-weight: 600;
          color: rgba(255,255,255,0.25);
          font-size: 14px;
        }

        .play-icon {
          color: #ffffff;
          animation: pulse 1.5s infinite alternate;
        }

        .track-info-col {
          display: contents;
        }

        .track-title {
          grid-column: 2;
          grid-row: 1;
          font-weight: 700;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-artist {
          grid-column: 2;
          grid-row: 2;
          font-weight: 400;
          opacity: 0.8;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-duration {
          grid-column: 3;
          grid-row: 1 / span 2;
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
      <div class="container ${artworkTheme === 'coverflow' ? 'coverflow-layout' : ''}">
        ${artworkTheme === 'coverflow' ? coverflowHTML : `
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
              ${trackCount > layout.end - layout.start ? ` &bull; <span>Showing ${layout.start + 1}-${layout.end} of ${trackCount}</span>` : ''}
            </div>
          </div>
          <div class="tracklist">
            ${trackItemsHTML}
          </div>
        </div>
        `}
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

  // Resolve each song's artwork once. Mixed-song projects can carry a distinct
  // cover on every track; normal albums reuse their single album cover.
  const coverCache = new Map<string, string>();
  const coverSources: string[] = [];
  for (const track of album.tracks) {
    const coverPath = track.coverPath || album.coverPath;
    if (!coverPath || !fs.existsSync(coverPath)) { coverSources.push(''); continue; }
    if (!coverCache.has(coverPath)) {
      const extension = path.extname(coverPath).toLowerCase();
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      coverCache.set(coverPath, `data:${mime};base64,${(await fs.promises.readFile(coverPath)).toString('base64')}`);
    }
    coverSources.push(coverCache.get(coverPath)!);
  }

  let jewelCaseSrc: string | null = null;
  if (getArtworkTheme(settings) === 'jewel') {
    const jewelCasePath = path.join(__dirname, '../../resources/cd-jewel-case-overlay.png');
    if (fs.existsSync(jewelCasePath)) {
      jewelCaseSrc = pathToFileURL(jewelCasePath).href;
    }
  }

  // Create a hidden browser window
  const win = new BrowserWindow({
    show: false,
    width: width,
    height: height,
    useContentSize: true,
    enableLargerThanScreen: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      offscreen: false
    }
  });

  // Ensure the window has a compositing surface ready before we try to capture it
  win.webContents.setBackgroundThrottling(false);

  const slidePaths: string[] = [];
  const slideHtmlPath = path.join(outputDir, 'slide_render.html');

  const captureSlideFallback = async (cw: number, ch: number): Promise<Buffer> => {
    const base64: string = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const W = ${cw};
          const H = ${ch};
          const dpr = window.devicePixelRatio || 1;

          // Grab the rendered HTML. Use documentElement since the slide is
          // styled with <body> background (gradient + album colors).
          const html = '<!doctype html><html>' +
            document.documentElement.innerHTML + '</html>';

          // Encode to SVG <foreignObject>. Use strict width/height so Chromium
          // doesn't treat the data URI as a different viewport size.
          const safeHtml = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const ratioCss = 'width:' + W + 'px;height:' + H + 'px;transform:scale(' + (1 / dpr) + ');transform-origin:0 0;box-sizing:border-box;';
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
            '<foreignObject width="' + W + '" height="' + H + '">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" style="' + ratioCss + '">' +
            '<meta charset="utf-8"/>' +
            safeHtml +
            '</div></foreignObject></svg>';
          const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('No 2D context');
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('SVG decode error'));
            img.src = url;
          });
          ctx.drawImage(img, 0, 0, W, H);
          return canvas.toDataURL('image/png');
        } catch (err) {
          // Must return a string so the main process receives a real message
          // even on failure (otherwise executeJavaScript resolves to undefined).
          return 'ERR:' + (err && err.message ? err.message : String(err));
        }
      })();
    `, true);

    if (!base64 || typeof base64 !== 'string') {
      throw new Error('Fallback canvas capture returned empty payload');
    }
    if (base64.startsWith('ERR:')) {
      throw new Error(base64.slice(4));
    }
    const comma = base64.indexOf(',');
    const data = comma >= 0 ? base64.slice(comma + 1) : base64;
    if (!data) throw new Error('Fallback canvas capture returned empty payload');
    return Buffer.from(data, 'base64');
  };

  try {
    for (let i = 0; i < album.tracks.length; i++) {
      const htmlContent = getSlideHTML(album, i, settings, coverBase64, jewelCaseSrc, coverSources);
      
      // Use a local HTML document instead of an oversized data URL. Large cover art
      // and jewel-case assets otherwise exceed Chromium's URL limits (ERR_INVALID_URL).
      await fs.promises.writeFile(slideHtmlPath, htmlContent, 'utf-8');
      await win.loadFile(slideHtmlPath);

      // Make image decoding deterministic before capturing the offscreen frame.
      await win.webContents.executeJavaScript(`Promise.all(
        Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }))
      )`);
      
      // Wait for layout paint (100ms for first slide to decode cover/fonts, 35ms for subsequent slides)
      await new Promise(resolve => setTimeout(resolve, i === 0 ? 100 : 35));
      
      let pngBuffer: Buffer | null = null;
      let lastErr: unknown = null;

      // Try native capturePage up to 3 times; fall back to in-page SVG rasterization
      for (let attempt = 0; attempt < 3 && pngBuffer === null; attempt++) {
        try {
          // Force a frame commit so Chromium's compositor produces a surface
          await win.webContents.beginFrameSubscription?.(() => {});
          const image = await win.webContents.capturePage();
          const resizedImage = image.resize({ width, height, quality: 'best' });
          pngBuffer = resizedImage.toPNG();
        } catch (err) {
          lastErr = err;
          console.warn(`capturePage attempt ${attempt + 1}/3 failed: ${(err as Error).message}`);
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 60 + attempt * 80));
          }
        }
      }

      if (pngBuffer === null) {
        console.warn('Falling back to in-page SVG→Canvas rasterization for slide capture.');
        try {
          pngBuffer = await captureSlideFallback(width, height);
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          const nativeMsg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown');
          throw new Error(
            `Could not capture slide ${i + 1} for album "${album.albumName}". ` +
            `Native capture: ${nativeMsg}; SVG fallback: ${fbMsg}. ` +
            `Try restarting the app without --disable-gpu or --disable-software-rasterizer flags.`
          );
        }
      }

      const slidePath = path.join(outputDir, `slide_${i}.png`);
      await fs.promises.writeFile(slidePath, pngBuffer);
      slidePaths.push(slidePath);

      if (getArtworkTheme(settings) === 'coverflow' && i > 0 && album.tracks[i].duration > 0.4) {
        // Render a short gallery movement before the static part of this song.
        // The 12 deterministic positions avoid timing-dependent CSS screenshots
        // and keep the rest of a long track at its compact ~1 fps encoding.
        for (let frame = 0; frame < 12; frame++) {
          const progress = 1 - Math.pow(1 - frame / 12, 2);
          await win.webContents.executeJavaScript(`(() => {
            const progress = ${progress};
            const centerWidth = Math.min(innerWidth * .5, innerHeight * .72);
            const sideWidth = Math.min(innerWidth * .42, innerHeight * .58);
            const target = offset => {
              if (offset === 0) return { left: 50, bottom: 24, width: centerWidth, angle: 0, opacity: 1, depth: 0 };
              const depth = Math.abs(offset);
              const isLeft = offset < 0;
              return { left: isLeft ? 29 - (depth - 1) * 7 : 71 + (depth - 1) * 7,
                bottom: 28, width: sideWidth, angle: isLeft ? 52 : -52,
                opacity: depth > 4 ? 0 : 1, depth };
            };
            document.querySelectorAll('.coverflow-item[data-flow-offset]').forEach(item => {
              const offset = Number(item.getAttribute('data-flow-offset'));
              const from = target(offset + 1);
              const to = target(offset);
              const mix = (a, b) => a + (b - a) * progress;
              item.style.left = mix(from.left, to.left) + '%';
              item.style.bottom = mix(from.bottom, to.bottom) + '%';
              item.style.width = mix(from.width, to.width) + 'px';
              item.style.transform = 'translateX(-50%) rotateY(' + mix(from.angle, to.angle) + 'deg)';
              item.style.opacity = String(mix(from.opacity, to.opacity));
              item.style.zIndex = String(7 - Math.min(from.depth, to.depth));
            });
          })()`);
          await new Promise(resolve => setTimeout(resolve, 16));
          const transitionImage = await win.webContents.capturePage();
          if (transitionImage.isEmpty()) throw new Error(`Could not capture Cover Flow transition frame ${frame + 1} for song ${i + 1}`);
          await fs.promises.writeFile(path.join(outputDir, `transition_${i}_${String(frame).padStart(2, '0')}.png`),
            transitionImage.resize({ width, height, quality: 'best' }).toPNG());
        }
      }
    }
  } finally {
    win.close();
    if (fs.existsSync(slideHtmlPath)) {
      await fs.promises.unlink(slideHtmlPath).catch(() => {});
    }
  }

  return slidePaths;
}
