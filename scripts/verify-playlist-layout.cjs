// Build main first, then run with Electron. Covers both export resolutions and
// density thresholds; screenshots are local QA artifacts, not library videos.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { getSlideHTML } = require('../dist/main/rendererService');
const { getTrackLayout } = require('../dist/shared/trackLayout');
const { shuffleMixOrder } = require('../dist/shared/mixOrder');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const original = ['one', 'two', 'three', 'four'];
  const shuffled = shuffleMixOrder(original, () => 0);
  assert.deepEqual(original, ['one', 'two', 'three', 'four']);
  assert.deepEqual([...shuffled].sort(), [...original].sort());
  assert.notDeepEqual(shuffled, original);
  assert.deepEqual(shuffleMixOrder([]), []);
  assert.deepEqual(shuffleMixOrder(['one']), ['one']);
  assert.deepEqual(shuffleMixOrder(['one', 'two'], () => .99), ['two', 'one']);
  const outputDir = path.join(__dirname, '../.design-qa/playlist-layout');
  fs.mkdirSync(outputDir, { recursive: true });
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  let cases = 0;
  for (const resolution of ['1920x1080', '1280x720']) {
    const [width, height] = resolution.split('x').map(Number);
    window.setContentSize(width, height);
    for (const theme of ['plain', 'jewel']) {
      for (const count of [1, 12, 18, 24, 36, 40]) {
        const album = {
          albumName: 'Compact playlist — longer song titles', year: '2026', tracksCount: count,
          tracks: Array.from({ length: count }, (_, index) => ({ trackNumber: index + 1,
            title: `Song ${index + 1} — A longer title with room to breathe`, artist: 'AlbumForge Studio', duration: 180 })),
          totalDuration: count * 180,
        };
        const settings = { resolution, artworkTheme: theme, fontFamily: 'Arial', backgroundColor: '#000', activeColor: '#fff', inactiveColor: '#888', artistItalic: true };
        const active = count - 1;
        const layout = getTrackLayout(count, active, resolution);
        const htmlPath = path.join(outputDir, 'frame.html');
        fs.writeFileSync(htmlPath, getSlideHTML(album, active, settings, null,
          pathToFileURL(path.join(__dirname, '../resources/cd-jewel-case-overlay.png')).href));
        await window.loadFile(htmlPath);
        await window.webContents.executeJavaScript('document.fonts.ready');
        const metrics = await window.webContents.executeJavaScript(`(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect();
          const cover = rect('.cover-art-container'), right = rect('.right-panel');
          const rows = [...document.querySelectorAll('.track-item')];
          const list = rect('.tracklist');
          return { gap: right.left - cover.right, coverRatio: cover.width / cover.height,
            rowHeight: rows[0].getBoundingClientRect().height, count: rows.length,
            activeNumber: document.querySelector('.track-active .track-num').textContent,
            fits: rows.every(row => { const box = row.getBoundingClientRect(); return box.bottom <= list.bottom + 1 && box.bottom <= innerHeight; }),
            textFits: rows.every(row => [...row.querySelectorAll('.track-title, .track-artist')].every(text => {
              const box = text.getBoundingClientRect(), parent = row.getBoundingClientRect();
              return box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1;
            })),
            playFirst: document.querySelector('.track-active .track-icon-col').firstElementChild.className === 'track-play-mark' };
        })()`);
        assert.equal(metrics.count, layout.rows);
        assert.equal(Number(metrics.activeNumber), count);
        assert.ok(metrics.fits && metrics.textFits && metrics.playFirst, JSON.stringify({ resolution, theme, count, metrics }));
        assert.ok(Math.abs(metrics.rowHeight - layout.rowHeight) < 1);
        assert.ok(Math.abs(metrics.gap - 20 * layout.scale) < 1);
        assert.ok(Math.abs(metrics.coverRatio - (theme === 'plain' ? 1 : 3295 / 3008)) < .01);
        if (resolution === '1920x1080' && [12, 36].includes(count)) {
          const image = await window.webContents.capturePage();
          fs.writeFileSync(path.join(outputDir, `${theme}-${count}.png`), image.toPNG());
        }
        console.log(`${resolution} ${theme} ${count}: ${metrics.count} visible, ${metrics.rowHeight.toFixed(1)}px rows, ${metrics.gap.toFixed(1)}px gap`);
        cases++;
      }
    }
  }
  window.destroy();
  console.log(`PASS: shuffle invariants and ${cases} playlist layouts`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
