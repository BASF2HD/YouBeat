import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { resolveFfmpegPath } from './ffmpegService';

// Opt-in only. All writes target a fresh temporary fixture, never a user library.
export async function runPackagedSelfTest(window: BrowserWindow): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youbeat-release-media-'));
  const ffmpeg = resolveFfmpegPath('ffmpeg');
  const input = path.join(root, '01 - Synthetic.wav');
  const generated = spawnSync(ffmpeg, ['-y','-v','error','-f','lavfi','-i','sine=duration=2.4','-ar','96000','-ac','2',input], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error('Synthetic audio generation failed: ' + generated.stderr);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const root = ${JSON.stringify(root)};
    const preflight = await window.api.testOutputWritable(root);
    if (!preflight.ok) throw new Error(preflight.message);
    const invalid = await window.api.testOutputWritable(${JSON.stringify(input)});
    if (invalid.ok) throw new Error('Output preflight accepted a file');
    const overlay = await window.api.getJewelCaseOverlay();
    if (!overlay.startsWith('data:image/png;base64,')) throw new Error('Bundled overlay missing');
    const albums = await window.api.scanAlbums(root, false);
    if (albums.length !== 1 || albums[0].tracks.length !== 1 || Math.abs(albums[0].tracks[0].duration - 2.4) > .01) throw new Error('Packaged metadata failed');
    const album = albums[0];
    const settings = { resolution:'1280x720',artworkTheme:'jewel',backgroundColor:'#000',fontFamily:'Arial',activeColor:'#fff',inactiveColor:'#888',artistItalic:true,audioCodec:'aac',exportQuality:'medium',videoCodec:'libx264',ffmpegPath:'ffmpeg',outputFolder:root,skipExisting:false,introDuration:0,fadeDuration:0,scanRecursive:false };
    return new Promise((resolve,reject) => {
      let last;
      const unsub = window.api.onAlbumUpdated(update => { if (update.id === album.id) last = update; });
      const finished = window.api.onQueueFinished(() => {
        unsub(); finished();
        if (last?.status === 'completed') resolve(last); else reject(new Error(last?.error || 'Queue failed'));
      });
      window.api.renderAll([album],settings).catch(reject);
    });
  })()`);
  if (!result.outputVideoPath || fs.statSync(result.outputVideoPath).size === 0) throw new Error('Packaged render produced no output');
  const decoded = spawnSync(ffmpeg, ['-hide_banner','-i',result.outputVideoPath,'-f','null','-'], { encoding:'utf8',timeout:30000 });
  if (decoded.status !== 0 || !/Audio: aac .*48000 Hz/.test(decoded.stderr) || !/Video: h264/.test(decoded.stderr)) throw new Error('Packaged MP4 decode failed: ' + decoded.stderr);
  const expected = (result.albumName + (result.year && result.year !== 'Unknown' && result.year !== 'Mix' ? ' (' + result.year + ')' : '')).replace(/[\\/:*?"<>|]/g,'_').trim() + '.mp4';
  if (path.basename(result.outputVideoPath) !== expected) throw new Error('Output filename contains unexpected suffixes');
  console.log(JSON.stringify({ok:true,ffmpeg,video:result.outputVideoPath,tests:['output-preflight','embedded-overlay','metadata','queue','H264','AAC-48k','simple-filenames']}));
  app.exit(0);
}
