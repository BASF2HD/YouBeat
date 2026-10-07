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
const { getCoverflowFontSizes } = require('../dist/shared/coverflow');

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
      for (const fonts of [{}, { trackTitleFontSize: 24, trackArtistFontSize: 12 }, { trackTitleFontSize: 64, trackArtistFontSize: 36 }]) {
      for (const count of [1, 8, 12, 18, 24, 36, 40]) {
        const album = {
          albumName: 'Compact playlist — longer song titles', year: '2026', tracksCount: count,
          tracks: Array.from({ length: count }, (_, index) => ({ trackNumber: index + 1,
            title: `Song ${index + 1} — A longer title with room to breathe`, artist: 'AlbumForge Studio', duration: 180 })),
          totalDuration: count * 180,
        };
        const settings = { resolution, artworkTheme: theme, fontFamily: 'Arial', backgroundColor: '#000', activeColor: '#fff', inactiveColor: '#888', artistItalic: true, ...fonts };
        const active = count - 1;
        const layout = getTrackLayout(count, active, resolution, settings);
        for (let index = 0; index < count; index++) {
          const activeLayout = getTrackLayout(count, index, resolution, settings);
          assert.ok(index >= activeLayout.start && index < activeLayout.end);
          assert.equal(activeLayout.titleSize, layout.titleSize);
          assert.equal(activeLayout.artistSize, layout.artistSize);
        }
        if (!fonts.trackTitleFontSize && count <= 8) assert.equal(layout.rows, count);
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
            titleFont: parseFloat(getComputedStyle(document.querySelector('.track-title')).fontSize),
            artistFont: parseFloat(getComputedStyle(document.querySelector('.track-artist')).fontSize),
            artistCount: document.querySelectorAll('.track-artist').length,
            numberFont: parseFloat(getComputedStyle(document.querySelector('.track-num')).fontSize),
            playFont: parseFloat(getComputedStyle(document.querySelector('.track-play-mark')).fontSize),
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
        assert.equal(metrics.artistCount, layout.rows);
        assert.ok(Math.abs(metrics.titleFont - layout.titleSize) < .01);
        assert.ok(Math.abs(metrics.artistFont - layout.artistSize) < .01);
        assert.ok(Math.abs(metrics.numberFont - layout.titleSize * .75) < .01);
        assert.ok(Math.abs(metrics.playFont - layout.titleSize * .8) < .01);
        assert.ok(metrics.fits && metrics.textFits && metrics.playFirst, JSON.stringify({ resolution, theme, count, metrics }));
        assert.ok(Math.abs(metrics.rowHeight - layout.rowHeight) < 1);
        assert.ok(Math.abs(metrics.gap - 20 * layout.scale) < 1);
        assert.ok(Math.abs(metrics.coverRatio - (theme === 'plain' ? 1 : 3295 / 3008)) < .01);
        if (resolution === '1920x1080' && !fonts.trackTitleFontSize && [8, 12, 36].includes(count)) {
          const image = await window.webContents.capturePage();
          fs.writeFileSync(path.join(outputDir, `${theme}-${count}.png`), image.toPNG());
        }
        console.log(`${resolution} ${theme} ${count}: ${metrics.count} visible, title ${metrics.titleFont.toFixed(1)}px, artist ${metrics.artistFont.toFixed(1)}px, row ${metrics.rowHeight.toFixed(1)}px`);
        cases++;
      }
      }
    }
    for (const fonts of [{}, { coverflowSongFontSize: 72, coverflowAlbumFontSize: 48 }]) {
      const settings = { resolution, artworkTheme: 'coverflow', fontFamily: 'Arial', backgroundColor: '#000', activeColor: '#fff', inactiveColor: '#888', ...fonts };
      const album = { albumName: 'An extremely long album name '.repeat(10), year: '2026', tracksCount: 9,
        tracks: Array.from({ length: 9 }, (_, index) => ({ title: 'A very long song title '.repeat(10), trackNumber: index + 1, duration: 180 })), totalDuration: 1620 };
      const htmlPath = path.join(outputDir, 'caption.html');
      fs.writeFileSync(htmlPath, getSlideHTML(album, 4, settings, null));
      await window.loadFile(htmlPath);
      const metrics = await window.webContents.executeJavaScript(`(() => {
        const cover = document.querySelector('.coverflow-center').getBoundingClientRect();
        const caption = document.querySelector('.coverflow-caption').getBoundingClientRect();
        return { inside: caption.left >= cover.left - 1 && caption.right <= cover.right + 1,
          below: caption.top >= cover.bottom,
          lines: [...document.querySelector('.coverflow-caption').children].map(text => ({
            font: parseFloat(getComputedStyle(text).fontSize), ellipse: getComputedStyle(text).textOverflow,
            overflow: text.scrollWidth > text.clientWidth,
            inside: text.getBoundingClientRect().left >= cover.left && text.getBoundingClientRect().right <= cover.right })) };
      })()`);
      const sizes = getCoverflowFontSizes(settings), scale = height / 1080;
      assert.ok(metrics.inside && metrics.below && metrics.lines.every(line => line.inside && line.overflow && line.ellipse === 'ellipsis'), JSON.stringify(metrics));
      assert.ok(Math.abs(metrics.lines[0].font - sizes.song * scale) < .01);
      assert.ok(Math.abs(metrics.lines[1].font - sizes.album * scale) < .01);
      if (!fonts.coverflowSongFontSize) {
        assert.deepEqual(sizes, { song: 52, album: 38 });
        fs.writeFileSync(path.join(outputDir, `caption-${resolution}.png`), (await window.webContents.capturePage()).toPNG());
      }
      cases++;
    }
  }
  window.destroy();
  console.log(`PASS: shuffle invariants and ${cases} playlist layouts`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
