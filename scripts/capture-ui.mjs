import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2] ?? '.design-qa/albumforge-studio.png';
const enableJewelCase = process.argv.includes('--enable-jewel-case');
const openSettings = process.argv.includes('--settings');
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

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  fromSurface: true,
  captureBeyondViewport: false,
});

await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
socket.close();
console.log(outputPath);
