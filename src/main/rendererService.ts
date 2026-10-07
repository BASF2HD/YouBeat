import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Album, RenderSettings } from '../shared/types';
import { getTrackLayout } from '../shared/trackLayout';
import { getArtworkTheme } from '../shared/artworkTheme';

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
  const layout = getTrackLayout(trackCount, activeTrackIndex, settings.resolution);

  // Cover image source (base64 or SVG placeholder)
  let coverImgSrc = '';
  if (coverBase64) {
    const ext = album.coverPath ? path.extname(album.coverPath).replace('.', '') : 'jpeg';
    coverImgSrc = `data:image/${ext};base64,${coverBase64}`;
  } else {
    coverImgSrc = `data:image/svg+xml;utf8,${encodeURIComponent(getDefaultCoverSVG(album.albumName, album.year))}`;
  }

  const artworkTheme = getArtworkTheme(settings);
  coverImgSrc = coverSources[activeTrackIndex] || coverImgSrc;
  const jewelCaseEnabled = artworkTheme === 'jewel' && Boolean(jewelCaseSrc);
  const coverContainerClass = jewelCaseEnabled ? 'cover-art-container jewel-case-enabled' : 'cover-art-container';
  const jewelCaseOverlayHTML = jewelCaseEnabled
    ? `<img class="jewel-case-overlay" src="${escapeHtml(jewelCaseSrc!)}" />`
    : '';
  const coverflowCover = (index: number) => coverSources[index] || coverImgSrc;
  const coverflowHTML = `
    <div class="coverflow-stage">
      ${activeTrackIndex > 0 ? `<img class="coverflow-card coverflow-previous" src="${escapeHtml(coverflowCover(activeTrackIndex - 1))}" />` : ''}
      <img class="coverflow-card coverflow-current" src="${escapeHtml(coverflowCover(activeTrackIndex))}" />
      ${activeTrackIndex < trackCount - 1 ? `<img class="coverflow-card coverflow-next" src="${escapeHtml(coverflowCover(activeTrackIndex + 1))}" />` : ''}
      <div class="coverflow-caption"><span>NOW PLAYING · ${String(activeTrackIndex + 1).padStart(2, '0')} / ${String(trackCount).padStart(2, '0')}</span><strong>${escapeHtml(album.tracks[activeTrackIndex]?.title || album.albumName)}</strong><small>${escapeHtml(album.tracks[activeTrackIndex]?.artist || '')} · ${escapeHtml(album.tracks[activeTrackIndex]?.album || album.albumName)}</small></div>
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
          <span class="track-num" style="font-size: ${layout.artistSize}px; ${isActive ? `color: ${settings.activeColor}; font-weight: 700;` : ''}">${trackNumDisplay}</span>
        </div>
        <div class="track-info-col">
          <div class="track-title" style="font-size: ${layout.titleSize}px;">${escapeHtml(track.title)}</div>
          ${layout.compact ? '' : `<div class="track-artist" style="font-size: ${layout.artistSize}px; ${artistStyle}">${escapeHtml(track.artist)}</div>`}
        </div>
        <div class="track-duration" style="font-size: ${layout.artistSize}px; color: ${isActive ? color : 'rgba(255,255,255,0.3)'};">
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

        .coverflow-stage { position: relative; width: 100%; height: 100%; perspective: 1200px; }
        .coverflow-card { position: absolute; left: 50%; top: 40%; width: 62%; max-height: 64%; aspect-ratio: 1; object-fit: cover; border: 1px solid rgba(255,255,255,.22); box-shadow: 0 18px 42px rgba(0,0,0,.72); }
        .coverflow-current { z-index: 3; transform: translate(-50%,-50%); }
        .coverflow-previous { z-index: 2; width: 46%; opacity: .58; transform: translate(-50%,-50%) translateX(-73%) rotateY(30deg) scale(.82); }
        .coverflow-next { z-index: 2; width: 46%; opacity: .58; transform: translate(-50%,-50%) translateX(73%) rotateY(-30deg) scale(.82); }
        .coverflow-caption { position: absolute; left: 8%; right: 8%; bottom: 3%; display: flex; flex-direction: column; gap: 7px; text-align: center; overflow: hidden; }
        .coverflow-caption span { font-size: 14px; letter-spacing: .18em; color: ${settings.activeColor}; font-weight: 800; }
        .coverflow-caption strong { font-size: 30px; line-height: 1.12; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .coverflow-caption small { font-size: 17px; color: rgba(255,255,255,.68); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Right Side: Track List */
        .right-panel {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          padding-left: 10px;
          min-width: 0;
        }

        .album-header {
          margin-bottom: 12px;
          border-bottom: 2px solid rgba(255,255,255,0.06);
          padding-bottom: 12px;
          flex-shrink: 0;
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
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: repeat(${layout.rows}, minmax(0, 1fr));
          overflow: hidden;
        }

        .track-item {
          display: flex;
          align-items: center;
          border-radius: 8px;
          padding-left: 14px;
          padding-right: 14px;
          gap: 12px;
          min-height: 0;
          background: transparent;
        }

        .track-active {
          background: rgba(255, 255, 255, 0.06);
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
          padding-right: 0;
          min-width: 0;
        }

        .track-title {
          font-weight: 700;
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .track-artist {
          font-weight: 400;
          opacity: 0.8;
          line-height: 1.1;
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
          ${artworkTheme === 'coverflow' ? coverflowHTML : `<div class="${coverContainerClass}">
            <img class="cover-art" src="${coverImgSrc}" />
            ${jewelCaseOverlayHTML}
          </div>`}
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
    }
  } finally {
    win.close();
    if (fs.existsSync(slideHtmlPath)) {
      await fs.promises.unlink(slideHtmlPath).catch(() => {});
    }
  }

  return slidePaths;
}
