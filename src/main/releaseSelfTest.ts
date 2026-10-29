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
  const generated = spawnSync(ffmpeg, ['-y','-v','error','-f','lavfi','-i','sine=duration=8.4','-ar','96000','-ac','2',input], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error('Synthetic audio generation failed: ' + generated.stderr);
  for (const [name, color] of [['cover.png', 'red'], ['test-back.png', 'blue']]) {
    const image = spawnSync(ffmpeg, ['-y','-v','error','-f','lavfi','-i',`color=c=${color}:s=400x400`,'-frames:v','1',path.join(root, name)], { encoding: 'utf8' });
    if (image.status !== 0) throw new Error('Synthetic artwork generation failed: ' + image.stderr);
  }
  const result = await window.webContents.executeJavaScript(`(async () => {
    const root = ${JSON.stringify(root)};
    const preflight = await window.api.testOutputWritable(root);
    if (!preflight.ok) throw new Error(preflight.message);
    const invalid = await window.api.testOutputWritable(${JSON.stringify(input)});
    if (invalid.ok) throw new Error('Output preflight accepted a file');
    const overlay = await window.api.getJewelCaseOverlay();
    if (!overlay.startsWith('data:image/png;base64,')) throw new Error('Bundled overlay missing');
    const albums = await window.api.scanAlbums(root, false);
    if (albums.length !== 1 || albums[0].tracks.length !== 1 || Math.abs(albums[0].tracks[0].duration - 8.4) > .01) throw new Error('Packaged metadata failed');
    const album = albums[0];
    const back = await window.api.readArtwork(${JSON.stringify(path.join(root, 'test-back.png'))});
    album.backCoverPath = await window.api.saveCroppedArtwork(back);
    if (!await window.api.saveAlbumMetadata(album.id, album)) throw new Error('Packaged artwork save failed');
    const rescanned = await window.api.scanAlbums(root, false);
    if (rescanned[0].backCoverPath !== album.backCoverPath) throw new Error('Packaged artwork rescan failed');
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
  for (const [time, channel] of [[2, 2], [7.5, 0]]) {
    const frame = spawnSync(ffmpeg, ['-v','error','-i',result.outputVideoPath,'-vf',`tpad=stop_mode=clone:stop_duration=1,fps=30,select=eq(n\\,${Math.round(time * 30)}),format=rgb24,crop=1:1:320:360`,'-frames:v','1','-f','rawvideo','-']);
    const pixel = frame.stdout;
    if (frame.status !== 0 || pixel.length !== 3 || pixel[channel] < 150 || pixel[channel] < pixel[2 - channel] * 1.5) throw new Error(`Packaged artwork incorrect at ${time}s`);
  }
  console.log(JSON.stringify({ok:true,ffmpeg,video:result.outputVideoPath,tests:['output-preflight','embedded-overlay','metadata','artwork-save-rescan','back-cover-flip','front-return','queue','H264','AAC-48k','simple-filenames']}));
  app.exit(0);
}
