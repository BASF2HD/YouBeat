// Launch the packaged app with --remote-debugging-port=9222 first. This tests
// the real IPC preflight, metadata parser, queue and render pipeline, not a
// development-only service import. All media is synthetic and temporary.
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const ffmpeg = process.argv.find(arg => arg.startsWith('--ffmpeg='))?.slice(9);
const existingOutput = process.argv.find(arg => arg.startsWith('--output-folder='))?.slice(16);
if (!ffmpeg) throw new Error('Pass --ffmpeg=<packaged FFmpeg binary path>');
const root = await mkdtemp(join(tmpdir(), 'youbeat-packaged-render-'));
const input = join(root, '01 - Synthetic.wav');
assert.equal(spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2.4', '-ar', '96000', '-ac', '2', input]).status, 0);
const targets = await fetch('http://127.0.0.1:9222/json/list').then(response => response.json());
const target = targets.find(item => item.title === 'YouBeat');
assert.ok(target, 'Packaged app window must be running');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data), operation = pending.get(response.id);
  if (!operation) return;
  pending.delete(response.id);
  if (response.error) operation.reject(new Error(response.error.message));
  else operation.resolve(response.result);
});
const send = (expression) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Packaged render timed out')); }, 60000);
  pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
try {
  for (const folder of [root, ...(existingOutput ? [existingOutput] : [])]) {
    const result = await send(`window.api.testOutputWritable(${JSON.stringify(folder)})`);
    assert.equal(result.result?.value?.ok, true, JSON.stringify(result));
    console.log(result.result.value.message);
  }
  const invalid = await send(`window.api.testOutputWritable(${JSON.stringify(input)})`);
  assert.equal(invalid.result.value.ok, false, 'A file is not a writable output directory');
  const result = await send(`(async () => {
    const albums = await window.api.scanAlbums(${JSON.stringify(root)}, false);
    if (albums.length !== 1 || albums[0].tracks.length !== 1 || Math.abs(albums[0].tracks[0].duration - 2.4) > .01) throw new Error('Packaged metadata parsing failed');
    const album = albums[0];
    const settings = { resolution: '1280x720', artworkTheme: 'jewel', backgroundColor: '#000', fontFamily: 'Arial', activeColor: '#fff', inactiveColor: '#888', artistItalic: true, audioCodec: 'aac', exportQuality: 'medium', videoCodec: 'auto', ffmpegPath: 'ffmpeg', outputFolder: ${JSON.stringify(root)}, skipExisting: false, introDuration: 0, fadeDuration: 0, scanRecursive: false };
    return new Promise((resolve, reject) => {
      let last, unsubscribe, finish;
      const cleanup = () => { unsubscribe(); finish(); };
      unsubscribe = window.api.onAlbumUpdated(updated => { if (updated.id === album.id) last = updated; });
      finish = window.api.onQueueFinished(() => { cleanup(); if (last?.status === 'completed') resolve(last); else reject(new Error(last?.error || 'Packaged queue did not complete')); });
      window.api.renderAll([album], settings).catch(error => { cleanup(); reject(error); });
    });
  })()`);
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  const album = result.result.value;
  assert.equal(album.status, 'completed');
  const expectedStem = `${album.albumName}${album.year && album.year !== 'Unknown' && album.year !== 'Mix' ? ` (${album.year})` : ''}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  assert.equal(basename(album.outputVideoPath), `${expectedStem}.mp4`);
  assert.ok((await stat(album.outputVideoPath)).size > 0);
  const decode = spawnSync(ffmpeg, ['-hide_banner', '-i', album.outputVideoPath, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(decode.status, 0, decode.stderr);
  assert.match(decode.stderr, /Audio: aac .*48000 Hz/);
  assert.match(decode.stderr, /Video: h264/);
  console.log(`PASS: packaged preflight, metadata, queue, rendering and MP4 decode: ${album.outputVideoPath}`);
} finally {
  socket.close();
}
