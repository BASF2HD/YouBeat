import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2] ?? '.design-qa/albumforge-studio.png';
const enableJewelCase = process.argv.includes('--enable-jewel-case');
const openSettings = process.argv.includes('--settings');
const openLogs = process.argv.includes('--logs');
const openMix = process.argv.includes('--mix');
const domOnly = process.argv.includes('--dom-only');
const verifyMixControls = process.argv.includes('--verify-mix-controls');
const verifyShuffle = process.argv.includes('--verify-shuffle');
const verifySelectionCards = process.argv.includes('--verify-selection-cards');
const verifyCoverflowMotion = process.argv.includes('--verify-coverflow-motion');
const verifyCoverflowSettings = process.argv.includes('--verify-coverflow-settings');
const verifyTrackSettings = process.argv.includes('--verify-track-settings');
const verifyTrackAlignment = process.argv.includes('--verify-track-alignment');
const verifyRowGap = process.argv.includes('--verify-row-gap');
const losslessAudio = process.argv.includes('--lossless-audio');
const verifyCoverflowCaption = process.argv.includes('--verify-coverflow-caption');
const scrollFontSettings = process.argv.includes('--scroll-font-settings');
const coverflowTheme = process.argv.includes('--coverflow-theme');
const classicTheme = process.argv.includes('--classic-theme');
const mixSelectCountArg = process.argv.find(argument => argument.startsWith('--mix-select-count='));
const mixSelectCount = mixSelectCountArg ? Number(mixSelectCountArg.split('=')[1]) : 0;
const verifyFfmpeg = process.argv.includes('--verify-ffmpeg');
const selectCountArg = process.argv.find(argument => argument.startsWith('--select-count='));
const selectCount = selectCountArg ? Number(selectCountArg.split('=')[1]) : 0;
const scanLibrary = process.argv.includes('--scan');
const selectFirst = process.argv.includes('--select-first');
const selectAlbumArg = process.argv.find(argument => argument.startsWith('--select-album='));
const selectAlbum = selectAlbumArg?.slice('--select-album='.length);
const previewWidthArg = process.argv.find(argument => argument.startsWith('--preview-width='));
const targets = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(10000) }).then(response => response.json());
const target = targets.find(item => item.title === 'AlbumForge Studio');

if (!target) {
  throw new Error('AlbumForge Studio renderer target was not found.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out connecting to the app debugger')), 10000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}`)); }, 10000);
  pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

if (previewWidthArg) {
  const width = Number(previewWidthArg.split('=')[1]);
  if (!Number.isFinite(width) || width < 320 || width > 720) {
    throw new Error('--preview-width must be between 320 and 720');
  }
  await send('Runtime.evaluate', { expression: `localStorage.setItem('preview_pane_width', ${JSON.stringify(String(width))})` });
  await send('Page.reload');
  await new Promise(resolve => setTimeout(resolve, 500));
}

if (enableJewelCase) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Settings'))?.click();
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('input[name="artwork-theme"][value="jewel"]');
      if (input && !input.checked) input.click();
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  if (!openSettings) {
    await send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Library'))?.click()`,
    });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

if (openSettings) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Settings'))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (scanLibrary) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Library'))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Scan Library'))?.click()`,
  });
  const result = await send('Runtime.evaluate', {
    expression: `new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        const rows = document.querySelectorAll('.library-table tbody tr');
        if (rows.length) { clearInterval(timer); resolve(rows.length); }
        else if (++attempts >= 100) { clearInterval(timer); reject(new Error('Library scan timed out')); }
      }, 100);
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(`Scanned ${result.result.value} album(s)`);
}

if (coverflowTheme) {
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Settings'))?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', { expression: `document.querySelector('input[name="artwork-theme"][value="coverflow"]')?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
}

if (classicTheme) {
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Settings'))?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', { expression: `document.querySelector('input[name="artwork-theme"][value="plain"]')?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
}

if (openMix || mixSelectCount > 0) {
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Mix Builder'))?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
  if (mixSelectCount > 0) {
    await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('.mix-song-row input[type="checkbox"]')).slice(0, ${mixSelectCount}).forEach(input => { if (!input.checked) input.click(); })` });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

if (openLogs) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Logs'))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (scrollFontSettings) {
  await send('Runtime.evaluate', { expression: `document.querySelector('.coverflow-size-settings')?.scrollIntoView({ block: 'center' })` });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (verifyCoverflowSettings) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => { const settings = document.querySelector('.coverflow-size-settings'); return { text: settings?.textContent, values: Array.from(settings?.querySelectorAll('input') || []).map(input => input.value) }; })()`,
    returnByValue: true,
  });
  const coverflowSettings = result.result.value;
  if (coverflowSettings.values?.[0] !== '72' || coverflowSettings.values?.[1] !== '48') throw new Error(`Cover Flow settings check failed: ${JSON.stringify(coverflowSettings)}`);
  console.log(`Cover Flow settings check passed: ${JSON.stringify(coverflowSettings)}`);
}

if (losslessAudio) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      [...document.querySelectorAll('button')].find(button => button.textContent.includes('Settings'))?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const input = document.querySelector('select[aria-label="Audio encoding"]');
      const previous = input?.value;
      if (!input) return { error: 'Audio encoding selector missing' };
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, 'alac');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      return { previous, current: input.value, saved: JSON.parse(localStorage.getItem('render_settings')).audioCodec };
    })()`, awaitPromise: true, returnByValue: true,
  });
  if (result.result.value?.saved !== 'alac') throw new Error(`Lossless settings check failed: ${JSON.stringify(result.result.value)}`);
  console.log(`Lossless audio selected: ${JSON.stringify(result.result.value)}`);
}

if (verifyFfmpeg) {
  const result = await send('Runtime.evaluate', {
    expression: `window.api.getFfmpegVersion('ffmpeg')`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(result.result.value);
}

if (selectFirst) {
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Library'))?.click()` });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.library-table tbody tr')?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (selectAlbum) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('.library-table tbody tr')).find(row => row.textContent?.includes(${JSON.stringify(selectAlbum)}))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (selectCount > 0) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Library'))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const checkboxes = Array.from(document.querySelectorAll('.library-table tbody .table-select-checkbox'));
      checkboxes.slice(0, ${selectCount}).forEach((checkbox) => {
        if (!checkbox.checked) checkbox.click();
      });
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
}

if (verifyTrackSettings) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 120));
      [...document.querySelectorAll('button')].find(button => button.textContent.includes('Settings'))?.click(); await wait();
      const inputs = [...document.querySelectorAll('.track-size-settings input')].slice(0, 2);
      if (inputs.length !== 2) return { error: 'Track font controls missing' };
      const original = inputs.map(input => input.value);
      const measure = () => {
        const row = document.querySelector('.preview-track-item');
        return { row: row?.getBoundingClientRect().height,
          title: parseFloat(getComputedStyle(document.querySelector('.preview-track-title')).fontSize),
          artist: parseFloat(getComputedStyle(document.querySelector('.preview-track-artist')).fontSize),
          rows: document.querySelectorAll('.preview-track-item').length };
      };
      const before = measure();
      const set = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(inputs[0], '64'); set(inputs[1], '36'); await wait();
      const after = measure(), saved = JSON.parse(localStorage.getItem('render_settings'));
      const next = document.querySelector('button[aria-label="Next song"]');
      for (let index = 0; index < 15; index++) { next?.click(); await wait(); }
      const activeVisible = Boolean(document.querySelector('.preview-track-active'));
      const list = document.querySelector('.preview-tracklist').getBoundingClientRect();
      const rowsFit = [...document.querySelectorAll('.preview-track-item')].every(row => row.getBoundingClientRect().bottom <= list.bottom + 1);
      const currentInputs = [...document.querySelectorAll('.track-size-settings input')].slice(0, 2);
      currentInputs.forEach((input, index) => set(input, original[index])); await wait();
      return { original, before, after, activeVisible, rowsFit, persisted: saved.trackTitleFontSize === 64 && saved.trackArtistFontSize === 36,
        expanded: after.row > before.row && after.title > before.title && after.artist > before.artist && after.rows < before.rows };
    })()`, awaitPromise: true, returnByValue: true,
  });
  const checks = result.result.value;
  if (checks.error || !checks.persisted || !checks.expanded || !checks.activeVisible || !checks.rowsFit) throw new Error(`Track typography UI check failed: ${JSON.stringify(checks)}`);
  console.log(`Track typography UI checks passed: ${JSON.stringify(checks)}`);
}

if (verifyRowGap) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 120));
      [...document.querySelectorAll('button')].find(button => button.textContent.includes('Settings'))?.click(); await wait();
      const input = document.querySelector('input[aria-label="Song row gap"]');
      if (!input) return { error: 'Song row gap slider missing' };
      const original = input.value;
      const set = value => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const measure = () => {
        const list = document.querySelector('.preview-tracklist'), rows = [...list.querySelectorAll('.preview-track-item')];
        const gap = parseFloat(getComputedStyle(list).rowGap), box = list.getBoundingClientRect();
        return { gap, rows: rows.length, title: parseFloat(getComputedStyle(rows[0].querySelector('.preview-track-title')).fontSize),
          fits: rows.every(row => row.getBoundingClientRect().bottom <= box.bottom + 1),
          measured: rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom : 0,
          active: Boolean(list.querySelector('.preview-track-active')) };
      };
      set('0'); await wait(); const compact = measure();
      set('40'); await wait(); const spacious = measure();
      const persisted = JSON.parse(localStorage.getItem('render_settings')).trackRowGap === 40;
      set(original); await wait();
      return { original, compact, spacious, persisted, restored: JSON.parse(localStorage.getItem('render_settings')).trackRowGap === Number(original) };
    })()`, awaitPromise: true, returnByValue: true,
  });
  const check = result.result.value;
  if (check.error || !check.persisted || !check.restored || check.compact.gap !== 0 || check.spacious.gap <= 0 || Math.abs(check.spacious.measured - check.spacious.gap) >= 1 || check.spacious.rows >= check.compact.rows || Math.abs(check.spacious.title - check.compact.title) > .01 || !check.compact.fits || !check.spacious.fits || !check.spacious.active) throw new Error(`Row gap UI check failed: ${JSON.stringify(check)}`);
  console.log(`Song row gap controls passed: ${JSON.stringify(check)}`);
}

if (verifyCoverflowCaption) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const cover = document.querySelector('.preview-flow-center').getBoundingClientRect();
      const caption = document.querySelector('.preview-coverflow-caption');
      const bounds = caption.getBoundingClientRect();
      const lines = [...caption.children].map(text => {
        const original = text.textContent; text.textContent = 'A long song or album name that exceeds the centre cover width '.repeat(10);
        const style = getComputedStyle(text), box = text.getBoundingClientRect();
        const check = { ellipsis: style.textOverflow === 'ellipsis', overflows: text.scrollWidth > text.clientWidth,
          inside: box.left >= cover.left - 1 && box.right <= cover.right + 1 };
        text.textContent = original; return check;
      });
      return { bounded: bounds.left >= cover.left - 1 && bounds.right <= cover.right + 1, lines };
    })()`, returnByValue: true,
  });
  const checks = result.result.value;
  if (!checks.bounded || !checks.lines.every(line => line.ellipsis && line.overflows && line.inside)) throw new Error(`Cover Flow caption check failed: ${JSON.stringify(checks)}`);
  console.log(`Cover Flow caption checks passed: ${JSON.stringify(checks)}`);
}

if (verifyMixControls) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 80));
      const rows = () => Array.from(document.querySelectorAll('section[aria-label="Mix order"] .mix-song-row'));
      const header = document.querySelector('.mix-select-all input');
      const matching = Number(document.querySelector('.mix-song-panel-heading small')?.textContent.match(/\\d+/)?.[0] || 0);
      if (!header) return { error: 'Select-all checkbox missing' };
      if (header.checked) { header.click(); await wait(); }
      header.click(); await wait();
      const selectedAll = rows().length === matching && matching > 0;
      const beforeOrder = rows().slice(0, 3).map(row => row.querySelector('strong')?.textContent);
      const transfer = new DataTransfer();
      const dragHandle = rows()[0].querySelector('.mix-drag-handle');
      dragHandle?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      await wait();
      rows()[2]?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      rows()[2]?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      dragHandle?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      await wait();
      const afterOrder = rows().slice(0, 3).map(row => row.querySelector('strong')?.textContent);
      const dragMoved = beforeOrder[0] === afterOrder[2] && beforeOrder[1] === afterOrder[0];
      const beforePreview = document.querySelector('.preview-transport span')?.textContent;
      document.querySelector('button[aria-label="Next song"]')?.click();
      await wait();
      const afterPreview = document.querySelector('.preview-transport span')?.textContent;
      return { matching, selectedAll, dragMoved, beforePreview, afterPreview, previewAdvanced: beforePreview !== afterPreview };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const checks = result.result.value;
  if (checks.error || !checks.selectedAll || !checks.dragMoved || !checks.previewAdvanced) throw new Error(`Mix UI check failed: ${JSON.stringify(checks)}`);
  console.log(`Mix UI checks passed: ${JSON.stringify(checks)}`);
}

if (verifyShuffle) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 100));
      const rows = () => [...document.querySelectorAll('section[aria-label="Mix order"] .mix-song-row')];
      const key = row => row.querySelector('.mix-drag-handle')?.getAttribute('aria-label');
      const order = () => rows().map(key);
      rows()[Math.min(3, rows().length - 1)]?.querySelector('.mix-preview-choice')?.click();
      await wait();
      const before = order(), active = key(rows().find(row => row.classList.contains('is-previewing')));
      const button = document.querySelector('button[aria-label="Shuffle playback order"]');
      button?.click(); await wait();
      const after = order();
      return { count: after.length, enabled: button && !button.disabled,
        changed: JSON.stringify(before) !== JSON.stringify(after),
        sameSongs: JSON.stringify([...before].sort()) === JSON.stringify([...after].sort()),
        activePreserved: key(rows().find(row => row.classList.contains('is-previewing'))) === active,
        numbersSequential: rows().every((row, index) => Number(row.querySelector('.mix-preview-choice').textContent) === index + 1) };
    })()`, awaitPromise: true, returnByValue: true,
  });
  const checks = result.result.value;
  if (!checks.enabled || !checks.changed || !checks.sameSongs || !checks.activePreserved || !checks.numbersSequential) throw new Error(`Shuffle UI check failed: ${JSON.stringify(checks)}`);
  console.log(`Shuffle UI checks passed: ${JSON.stringify(checks)}`);
}

if (verifySelectionCards) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 100));
      const original = document.querySelector('.theme-card.active');
      const results = [];
      for (const card of [...document.querySelectorAll('.theme-card')]) {
        card.click(); await wait();
        const inactive = [...document.querySelectorAll('.theme-card:not(.active), .artwork-theme-choice:not(.active)')];
        results.push({ theme: card.textContent.trim(), cards: inactive.map(item => {
          const style = getComputedStyle(item); return { border: style.borderTopColor, width: style.borderTopWidth, style: style.borderTopStyle };
        }) });
      }
      original?.click(); await wait();
      return results;
    })()`, awaitPromise: true, returnByValue: true,
  });
  const checks = result.result.value;
  if (checks.length !== 2 || checks.some(check => check.cards.length !== 3 || check.cards.some(card => card.width !== '1px' || card.style !== 'solid' || !['rgb(75, 80, 96)', 'rgb(166, 175, 189)'].includes(card.border)))) throw new Error(`Selection borders check failed: ${JSON.stringify(checks)}`);
  console.log(`Selection borders checks passed: ${JSON.stringify(checks)}`);
}

if (verifyCoverflowMotion) {
  await send('Page.bringToFront');
  const started = await send('Runtime.evaluate', {
    expression: `(() => { const cover = document.querySelector('.preview-flow-center'); if (!cover) return null; window.__motionCover = cover; const before = cover.getBoundingClientRect().left; document.querySelector('button[aria-label="Next song"]')?.click(); return before; })()`,
    returnByValue: true,
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  const middle = await send('Runtime.evaluate', {
    expression: `(() => { const animations = window.__motionCover?.getAnimations() || []; animations.forEach(animation => { animation.currentTime = 210; }); return { left: window.__motionCover?.getBoundingClientRect().left, animations: animations.length }; })()`,
    returnByValue: true,
  });
  await new Promise(resolve => setTimeout(resolve, 450));
  const finished = await send('Runtime.evaluate', {
    expression: `window.__motionCover?.getBoundingClientRect().left`,
    returnByValue: true,
  });
  const motion = { before: started.result.value, midway: middle.result.value?.left, after: finished.result.value, animations: middle.result.value?.animations };
  motion.movedContinuously = motion.animations > 0 && Math.abs(motion.midway - motion.before) > 0.5 && Math.abs(motion.after - motion.midway) > 0.5;
  if (motion.error || !motion.movedContinuously) throw new Error(`Cover Flow motion check failed: ${JSON.stringify(motion)}`);
  console.log(`Cover Flow motion check passed: ${JSON.stringify(motion)}`);
}

if (domOnly) {
  const result = await send('Runtime.evaluate', { expression: `({ text: document.body.innerText.slice(0, 1000), width: document.body.scrollWidth, height: document.body.scrollHeight })`, returnByValue: true });
  console.log(result.result.value);
  socket.close();
  process.exit(0);
}

if (verifyTrackAlignment) {
  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const centre = element => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; };
      return [...document.querySelectorAll('.preview-track-item')].map(row => {
        const title = centre(row.querySelector('.preview-track-title'));
        return [...row.querySelectorAll('.preview-track-num-col span')].map(marker => Math.abs(centre(marker) - title));
      });
    })()`, returnByValue: true,
  });
  const errors = result.result.value;
  if (!errors?.length || errors.flat().some(error => error >= 1)) throw new Error(`Preview marker alignment failed: ${JSON.stringify(errors)}`);
  const header = await send('Runtime.evaluate', { expression: `Boolean(document.querySelector('.preview-album-header'))`, returnByValue: true });
  if (header.result.value) throw new Error('Classic/CD Jewel preview must not have an album-summary header');
  console.log(`Title-line marker alignment passed for ${errors.length} rows`);
}

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false,
});

await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
socket.close();
console.log(outputPath);
