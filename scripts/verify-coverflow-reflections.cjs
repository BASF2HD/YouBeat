// Pixel regression: altering farther sleeves must not alter a nearer reflection.
// Run after building main: electron scripts/verify-coverflow-reflections.cjs
// --without-occlusion is a negative control and must fail on overlapping pixels.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getSlideHTML } = require('../dist/main/rendererService');

const cover = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/></svg>`)}`;
const colors = ['#e63737', '#29ba61', '#3656df', '#f2ba32', '#ab39d1', '#37d2d2', '#ed8049', '#6d87ac', '#df46a1'];
const album = { albumName: 'Reflection occlusion', year: '2026', tracksCount: 9, totalDuration: 27,
  tracks: colors.map((_, index) => ({ title: `Song ${index + 1}`, duration: 3, trackNumber: index + 1 })) };
const outputDir = path.join(__dirname, '../.design-qa/coverflow-reflections');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer/index.css'), 'utf8');
const previewCSS = css.slice(css.indexOf('.preview-coverflow-stage'), css.indexOf('.preview-transport'))
  .replaceAll('preview-coverflow', 'coverflow').replaceAll('preview-flow', 'coverflow');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const settle = () => evaluate(`(async () => { await Promise.all([...document.images].map(img => img.decode())); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`);
  let cases = 0;
  for (const resolution of ['1920x1080', '1280x720']) {
    const [width, height] = resolution.split('x').map(Number);
    win.setContentSize(width, height);
    for (const mode of ['export', 'preview']) {
      for (const progress of [1, .5]) {
        let html = getSlideHTML(album, 4, { resolution, artworkTheme: 'coverflow', fontFamily: 'Arial', backgroundColor: '#000' }, null, null, colors.map(cover));
        if (mode === 'preview') html = html.replace('</style>', `${previewCSS}\nbody { container-type: inline-size; }</style>`);
        if (process.argv.includes('--without-occlusion')) html = html.replace('</style>', '.coverflow-reflection-plane { background: transparent; }</style>');
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        // Use the exact exported transition geometry at its midpoint, including
        // both a leaving and arriving centre sleeve. Static geometry stays intact.
        if (progress !== 1) await evaluate(`(() => {
          const target = offset => offset === 0
            ? { left: 50, bottom: 24, width: Math.min(innerWidth * .5, innerHeight * .72), angle: 0, depth: 0, opacity: 1 }
            : { left: offset < 0 ? 29 - (Math.abs(offset) - 1) * 7 : 71 + (Math.abs(offset) - 1) * 7,
                bottom: 28, width: Math.min(innerWidth * .42, innerHeight * .58), angle: offset < 0 ? 52 : -52, depth: Math.abs(offset), opacity: Math.abs(offset) > 4 ? 0 : 1 };
          document.querySelectorAll('[data-flow-offset]').forEach(item => {
            const offset = Number(item.dataset.flowOffset), from = target(offset + 1), to = target(offset);
            const mix = (a, b) => a + (b - a) * ${progress};
            item.style.left = mix(from.left, to.left) + '%'; item.style.bottom = mix(from.bottom, to.bottom) + '%';
            item.style.width = mix(from.width, to.width) + 'px';
            item.style.transform = 'translateX(-50%) rotateY(' + mix(from.angle, to.angle) + 'deg)';
            item.style.opacity = String(mix(from.opacity, to.opacity)); item.style.zIndex = String(7 - Math.min(from.depth, to.depth));
          });
        })()`);
        await settle();
        const original = (await win.webContents.capturePage()).resize({ width, height });
        fs.writeFileSync(path.join(outputDir, `${mode}-${resolution}-${progress}.png`), original.toPNG());
        let tested = 0;
        for (const offset of [-3, -2, -1, 1, 2, 3]) {
          const points = await evaluate(`(() => {
            const points = [], item = document.querySelector('[data-flow-offset="${offset}"]');
            for (let y = Math.ceil(innerHeight * .65); y < innerHeight - 2; y += 8) {
              for (let x = 2; x < innerWidth - 2; x += 8) {
                // Ignore the 2px antialiased silhouette where two planes meet.
                const inside = [-2, 0, 2].every(dx => [-2, 0, 2].every(dy =>
                  document.elementFromPoint(x + dx, y + dy)?.closest('.coverflow-reflection-plane')?.parentElement === item));
                if (inside &&
                    Number(getComputedStyle(item).opacity) === 1) points.push({ x, y });
              }
            }
            return points;
          })()`);
          // Some sleeves are completely occluded during the centre crossing.
          if (!points.length) continue;
          await evaluate(`(() => {
            const target = document.querySelector('[data-flow-offset="${offset}"]');
            const z = Number(getComputedStyle(target).zIndex);
            document.querySelectorAll('[data-flow-offset]').forEach(item => {
              if (Number(getComputedStyle(item).zIndex) < z) item.querySelectorAll('img').forEach(img => { img.dataset.original = img.src; img.src = ${JSON.stringify(cover('#ffffff'))}; });
            });
          })()`);
          await settle();
          const changed = (await win.webContents.capturePage()).resize({ width, height }).toBitmap();
          const baseline = original.toBitmap();
          const leaking = points.filter(({ x, y }) => {
            const index = (y * width + x) * 4;
            return [0, 1, 2].some(channel => Math.abs(changed[index + channel] - baseline[index + channel]) > 2);
          });
          assert.equal(leaking.length, 0, `${mode} ${resolution} progress ${progress} sleeve ${offset}: ${leaking.length}/${points.length} pixels bleed`);
          tested += points.length;
          await evaluate(`document.querySelectorAll('img[data-original]').forEach(img => { img.src = img.dataset.original; delete img.dataset.original; })`);
          await settle();
        }
        assert.ok(tested > 100, `Not enough reflection samples: ${tested}`);
        console.log(`PASS ${mode} ${resolution} progress ${progress}: ${tested} occluded pixels`);
        cases++;
      }
    }
  }
  win.destroy();
  console.log(`PASS: ${cases} reflection layouts, including moving sleeves and live-preview styles`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
