// Run after build: electron scripts/verify-jewel-back-cover.cjs
// All profile, artwork and audio writes use a disposable temporary fixture.
const { app, BrowserWindow, ipcMain } = require('electron');
// Hosted Windows runners have no reliable native GPU; retain the same render
// and pixel checks using Chromium's software compositor.
if (process.env.YOUBEAT_SOFTWARE_RENDERING === '1') app.disableHardwareAcceleration();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getJewelFlipTiming, jewelFlipAngle } = require('../dist/shared/jewelFlip');
const { getSquareArtworkLayout } = require('../dist/shared/artworkCrop');
const { importArtworkFile, readArtwork, saveCroppedArtwork } = require('../dist/main/artworkStore');
const { generateSlidesForAlbum, getSlideHTML, captureRenderedWindow } = require('../dist/main/rendererService');
const { renderAlbumVideo, resolveFfmpegPath } = require('../dist/main/ffmpegService');
const { queueManager } = require('../dist/main/queueManager');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youbeat-back-cover-'));
app.setPath('userData', root);
app.setAppPath(path.resolve(__dirname, '..'));
app.on('window-all-closed', () => {});
const run = (args) => {
  const result = spawnSync(resolveFfmpegPath('ffmpeg'), ['-v', 'error', ...args], { maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};

app.whenReady().then(async () => {
  assert.deepEqual(getJewelFlipTiming(10), { turn: 1, hold: 5, total: 7, duration: 10 });
  assert.ok(Math.abs(jewelFlipAngle(.5) + 90) < 1e-9, 'Flip moves in the reverse direction');
  assert.equal(jewelFlipAngle(1), -180);
  assert.deepEqual(getSquareArtworkLayout(900, 300, { mode: 'crop', zoom: 1, x: 50, y: 50 }, 300),
    { sx: 300, sy: 0, sw: 300, sh: 300, dx: 0, dy: 0, dw: 300, dh: 300 });
  for (const duration of [.1, .6, 2.4, 6.2, 8.4]) {
    const timing = getJewelFlipTiming(duration);
    assert.ok(timing.total <= duration + 1e-9);
    assert.ok(timing.turn > 0 && timing.hold > 0 && timing.hold <= 5);
  }
  const front = path.join(root, 'front.png'), back = path.join(root, 'back.png');
  for (const [file, color] of [[front, '0xdf2040'], [back, '0x206cdd']]) {
    run(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=600x600`, '-frames:v', '1', file]);
  }
  const firstImport = await importArtworkFile(back);
  fs.copyFileSync(front, back);
  const secondImport = await importArtworkFile(back);
  assert.notEqual(firstImport, secondImport, 'Same-name replacement gets a new image URL');
  assert.notEqual(await readArtwork(firstImport), await readArtwork(secondImport), 'Replacement reads fresh bytes');
  fs.unlinkSync(back);
  assert.ok((await readArtwork(firstImport)).startsWith('data:image/png;base64,'), 'Saved image survives source deletion');
  fs.copyFileSync(firstImport, back);
  const rectangular = path.join(root, 'rectangular.png');
  run(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=900x300', '-vf', 'drawbox=x=300:y=0:w=300:h=300:color=green:t=fill,drawbox=x=600:y=0:w=300:h=300:color=blue:t=fill', '-frames:v', '1', rectangular]);
  const album = { id: root, folderPath: root, albumName: 'Back Cover Test', year: '2026', coverPath: front, coverFound: true,
    backCoverPath: back, status: 'idle', progress: 0, tracksCount: 3, totalDuration: 12.4,
    tracks: [8.4, 2.4, 1.6].map((duration, index) => {
      const filePath = path.join(root, `song-${index}.wav`);
      run(['-y', '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 100}:duration=${duration}`, '-ar', '48000', filePath]);
      return { id: String(index), title: `Song ${index + 1}`, artist: 'Fixture', album: 'Back Cover Test', year: '2026',
        trackNumber: index + 1, duration, filePath, fileName: path.basename(filePath), ...(index === 2 ? { backCoverPath: null } : {}) };
    }) };
  assert.ok(await queueManager.saveAlbumMetadata(album.id, album));
  let saved = (await queueManager.loadMetadataCache())[album.id];
  assert.equal(saved.backCoverPath, back);
  assert.equal(saved.coverPath, front);
  assert.ok(await queueManager.saveAlbumMetadata(album.id, { ...album, backCoverPath: null }));
  saved = (await queueManager.loadMetadataCache())[album.id];
  assert.equal(saved.backCoverPath, null, 'Removing back art persists across reloads');

  const settings = { resolution: '1280x720', artworkTheme: 'jewel', useJewelCase: true, fontFamily: 'Arial',
    backgroundColor: '#000', activeColor: '#fff', inactiveColor: '#888', artistItalic: true, audioCodec: 'alac',
    exportQuality: 'small', videoCodec: 'libx264', ffmpegPath: 'ffmpeg', outputFolder: root, skipExisting: false,
    introDuration: 0, fadeDuration: 0, scanRecursive: false };
  let video;
  if (!process.argv.includes('--ui-only')) {
  const slides = await generateSlidesForAlbum(album, settings, root);
  assert.equal(slides.length, 3);
  assert.ok(fs.existsSync(path.join(root, 'jewel_0.ffconcat')));
  assert.ok(fs.existsSync(path.join(root, 'jewel_1.ffconcat')));
  assert.ok(!fs.existsSync(path.join(root, 'jewel_2.ffconcat')), 'Missing back cover keeps a still front');
  assert.match(fs.readFileSync(path.join(root, 'jewel_0.ffconcat'), 'utf8'), /duration 5\.000000000/);
  assert.ok(!getSlideHTML(album, 0, { ...settings, artworkTheme: 'plain' }, null, 'overlay', [], 'back').includes('class="jewel-flip"'));
  video = await renderAlbumVideo(album, settings, slides, root, () => {}, log => { if (log.type === 'error') console.error(log.text); });
  run(['-i', video.videoPath, '-f', 'null', '-']);
  const pcm = file => run(['-i', file, '-map', '0:a:0', '-f', 's16le', '-c:a', 'pcm_s16le', '-']);
  assert.ok(pcm(video.videoPath).equals(Buffer.concat(album.tracks.map(track => pcm(track.filePath)))), 'All source audio samples remain aligned and intact');
  const pixelAt = seconds => [...run(['-i', video.videoPath, '-vf', `tpad=stop_mode=clone:stop_duration=1,fps=30,select=eq(n\\,${Math.round(seconds * 30)}),format=rgb24,crop=1:1:320:360`, '-frames:v', '1', '-f', 'rawvideo', '-'])];
  for (const time of [1.1, 5.5, 9.3, 9.5]) {
    const [r, g, b] = pixelAt(time);
    assert.ok(b > r * 1.5, `Back artwork should be blue at ${time}s: ${[r, g, b]}`);
  }
  for (const time of [0, 7.1, 8.2, 10.9, 12.1]) {
    const [r, g, b] = pixelAt(time);
    assert.ok(r > b * 1.5, `Front artwork should be red at ${time}s: ${[r, g, b]}`);
  }
  }
  if (process.argv.includes('--export-only')) {
    console.log(JSON.stringify({ ok: true, root, video: video?.videoPath, checks: ['offscreen-paint', 'five-second-hold', 'front-return', 'audio-sample-alignment'] }));
    app.exit(0);
    return;
  }
  // Exercise the built React editor with a fixture IPC backend and isolated storage.
  for (const [channel, handler] of Object.entries({
    'get-jewel-case-overlay': () => '', 'get-default-output-folder': () => root,
    'get-hw-accelerators': () => [], 'select-folder': () => root, 'scan-albums': () => [album],
    'test-output-writable': () => ({ ok: true }), 'get-ffmpeg-version': () => 'fixture',
    'select-artwork': () => importArtworkFile(back), 'read-artwork': (_event, file) => readArtwork(file),
    'save-cropped-artwork': (_event, data) => saveCroppedArtwork(data),
    'save-album-metadata': (_event, id, update) => queueManager.saveAlbumMetadata(id, update)
  })) ipcMain.handle(channel, handler);
  const window = new BrowserWindow({ show: false, width: 1360, height: 900, webPreferences: {
    preload: path.resolve(__dirname, '../dist/main/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    offscreen: process.platform === 'win32'
  } });
  await window.loadFile(path.resolve(__dirname, '../dist/renderer/index.html'));
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer:', message); });
  const evaluate = async expression => {
    try { return await window.webContents.executeJavaScript(expression); }
    catch (error) { throw new Error(`${error.message}\nExpression: ${expression}`); }
  };
  const click = async label => {
    assert.ok(await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(label)})); button?.click(); return Boolean(button); })()`), `Button missing: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  };
  await click('Choose Path');
  await click('Scan Library');
  await click('Edit');
  assert.ok(await evaluate(`document.querySelector('.album-artwork-editor').textContent.includes('Back cover (optional)')`));
  await click('Remove back cover');
  await click('Choose image');
  assert.equal(await evaluate(`document.querySelectorAll('.album-artwork-choice img').length`), 2);
  const selectedFirst = await evaluate(`document.querySelector('.album-artwork-choice:nth-child(2) img').src`);
  fs.copyFileSync(front, back);
  await evaluate(`document.querySelector('.album-artwork-choice:nth-child(2) button').click()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const selectedSecond = await evaluate(`document.querySelector('.album-artwork-choice:nth-child(2) img').src`);
  assert.notEqual(selectedFirst, selectedSecond, 'Editor refreshes same-name replacements');
  fs.copyFileSync(rectangular, back);
  await evaluate(`document.querySelector('.album-artwork-choice:nth-child(2) button').click()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  await click('Crop / fit to square');
  assert.ok(await evaluate(`[...document.querySelectorAll('.editor-footer button')].find(button => button.textContent.includes('Save overrides')).disabled`), 'Apply or cancel crop before saving album');
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(`!document.querySelector('.artwork-crop-actions .btn-primary').disabled`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const canvasPixel = async (x, y) => evaluate(`[...document.querySelector('.artwork-cropper canvas').getContext('2d').getImageData(${x}, ${y}, 1, 1).data]`);
  assert.ok((await canvasPixel(256, 256))[1] > 100, 'Default square crop shows the green centre');
  await evaluate(`document.querySelectorAll('.artwork-cropper input[type="radio"]')[1].click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok((await canvasPixel(30, 256))[0] > 200, 'Fit keeps the left artwork');
  assert.ok((await canvasPixel(480, 256))[2] > 200, 'Fit keeps the right artwork');
  assert.deepEqual((await canvasPixel(256, 20)).slice(0, 3), [0, 0, 0], 'Fit adds padding without cutting the artwork');
  await evaluate(`document.querySelectorAll('.artwork-cropper input[type="radio"]')[0].click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`(() => { const input = document.querySelector('[aria-label="Crop horizontal position"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '100'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok((await canvasPixel(256, 256))[2] > 200, 'Crop can move to the right edge');
  await evaluate(`document.querySelector('.artwork-cropper').scrollIntoView({ block: 'center' })`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync(path.join(root, 'crop-editor.png'), (await captureRenderedWindow(window)).toPNG());
  await click('Use square artwork');
  assert.ok(await evaluate(`!document.querySelector('.artwork-cropper')`));
  await click('Save overrides');
  const croppedPath = (await queueManager.loadMetadataCache())[album.id].backCoverPath;
  assert.ok(croppedPath.includes('back-cover-square-'));
  const croppedPixel = run(['-i', croppedPath, '-vf', 'format=rgb24,crop=1:1:150:150', '-frames:v', '1', '-f', 'rawvideo', '-']);
  assert.ok(croppedPixel[2] > 200, 'Saved crop matches the selected blue area');
  await click('Settings');
  await evaluate(`document.querySelector('input[name="artwork-theme"][value="jewel"]').click()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const preview = await evaluate(`(() => {
    const flip = document.querySelector('.jewel-flip');
    if (!flip) return null;
    const animation = flip.getAnimations()[0];
    if (!animation) return { error: 'No animation', style: flip.getAttribute('style'), display: getComputedStyle(flip).display,
      animationName: getComputedStyle(flip).animationName, rules: [...document.querySelectorAll('style')].map(style => style.textContent),
      parentRects: [...document.querySelectorAll('.preview-pane, .preview-pane-body, .preview-cover-art-container')].map(node => [node.className, node.getBoundingClientRect().width]) };
    animation.pause(); animation.currentTime = 1000;
    return { duration: animation.effect.getTiming().duration, faces: document.querySelectorAll('.jewel-face').length,
      backHidden: getComputedStyle(document.querySelector('.jewel-back')).backfaceVisibility };
  })()`);
  assert.equal(preview.duration, 7000, JSON.stringify(preview));
  assert.equal(preview.faces, 2);
  assert.equal(preview.backHidden, 'hidden');
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const sample = await evaluate(`(() => {
    const box = document.querySelector('.jewel-back img').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: innerWidth,
      transform: getComputedStyle(document.querySelector('.jewel-flip')).transform };
  })()`);
  const screenshot = await captureRenderedWindow(window);
  const scale = screenshot.getSize().width / sample.width;
  const previewFile = path.join(root, 'preview-back.png');
  fs.writeFileSync(previewFile, screenshot.toPNG());
  const pixel = run(['-i', previewFile, '-vf', `format=rgb24,crop=1:1:${Math.round(sample.x * scale)}:${Math.round(sample.y * scale)}`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  assert.ok(pixel[2] > pixel[0] * 1.5, `Preview must visibly show blue back art: ${[...pixel]}, ${JSON.stringify(sample)}`);
  window.destroy();
  console.log(JSON.stringify({ ok: true, root, video: video?.videoPath, checks: ['optional-artwork', 'metadata-round-trip', 'five-second-hold', 'short-song', 'each-song-flip', 'front-return', 'audio-sample-alignment', 'same-name-replacement', 'source-preserved', 'square-crop', 'whole-image-fit', 'crop-position', 'React-preview'] }));
  app.quit();
}).catch(error => { console.error(error); console.error('Fixture:', root); app.exit(1); });
