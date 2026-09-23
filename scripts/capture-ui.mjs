import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2] ?? '.design-qa/albumforge-studio.png';
const enableJewelCase = process.argv.includes('--enable-jewel-case');
const openSettings = process.argv.includes('--settings');
const openLogs = process.argv.includes('--logs');
const verifyFfmpeg = process.argv.includes('--verify-ffmpeg');
const selectCountArg = process.argv.find(argument => argument.startsWith('--select-count='));
const selectCount = selectCountArg ? Number(selectCountArg.split('=')[1]) : 0;
const scanLibrary = process.argv.includes('--scan');
const selectFirst = process.argv.includes('--select-first');
const selectAlbumArg = process.argv.find(argument => argument.startsWith('--select-album='));
const selectAlbum = selectAlbumArg?.slice('--select-album='.length);
const targets = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json());
const target = targets.find(item => item.title === 'AlbumForge Studio');

if (!target) {
  throw new Error('AlbumForge Studio renderer target was not found.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
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
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

if (enableJewelCase) {
  await send('Runtime.evaluate', {
    expression: `(() => {
      Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Settings'))?.click();
    })()`,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('.jewel-case-setting input');
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

if (openLogs) {
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Logs'))?.click()`,
  });
  await new Promise(resolve => setTimeout(resolve, 150));
}

if (verifyFfmpeg) {
  const result = await send('Runtime.evaluate', {
    expression: `window.api.getFfmpegVersion('ffmpeg')`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(result.result.value);
}

if (scanLibrary) {
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

if (selectFirst) {
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

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false,
});

await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
socket.close();
console.log(outputPath);
