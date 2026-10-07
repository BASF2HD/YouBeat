const { app } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { generateSlidesForAlbum } = require('../dist/main/rendererService.js');
const { testFfmpegPath, resolveFfmpegPath, renderAlbumVideo, resolveVideoCodecArgs } = require('../dist/main/ffmpegService.js');

const outputDir = path.join(__dirname, '..', '.design-qa', 'slide-render-smoke');
const longVideo = process.argv.includes('--long-video');
const renderVideo = process.argv.includes('--video') || longVideo;
const forceCpu = process.argv.includes('--cpu');
const useAac = process.argv.includes('--aac');
const hiResAudio = process.argv.includes('--hires-audio');
const mixedFormats = process.argv.includes('--mixed-formats');
const coverflow = process.argv.includes('--coverflow');
const mix = process.argv.includes('--mix');
const trackCountArg = process.argv.find(arg => arg.startsWith('--track-count='));
const resolutionArg = process.argv.find(arg => arg.startsWith('--resolution='));
const trackCount = trackCountArg ? Number(trackCountArg.split('=')[1]) : 1;
if (!Number.isInteger(trackCount) || trackCount < 1 || trackCount > 40) {
  throw new Error('--track-count must be an integer from 1 to 40');
}

// Keep Electron alive after the offscreen slide window closes so the video
// renderer can finish its separate FFmpeg process checks.
app.on('window-all-closed', () => {});

const album = {
  id: 'smoke-test',
  folderPath: outputDir,
  albumName: 'Jewel Case Smoke Test',
  year: '2026',
  tracks: [{
    id: 'smoke-track',
    fileName: 'smoke.wav',
    filePath: path.join(outputDir, 'smoke.wav'),
    trackNumber: 1,
    title: 'Frame Decode Test',
    artist: 'AlbumForge Studio',
    duration: 2.4,
  }],
  tracksCount: 1,
  totalDuration: 2.4,
  coverFound: false,
  coverPath: null,
  status: 'idle',
  progress: 0,
};

const settings = {
  resolution: resolutionArg ? resolutionArg.split('=')[1] : '1280x720',
  backgroundColor: '#000000',
  fontFamily: 'Arial',
  activeColor: '#ffffff',
  inactiveColor: '#888888',
  artistItalic: true,
  useJewelCase: true,
  artworkTheme: coverflow ? 'coverflow' : 'jewel',
  exportQuality: 'medium',
  audioCodec: useAac ? 'aac' : 'alac',
  introDuration: 0,
  fadeDuration: 0,
  scanRecursive: false,
  ffmpegPath: 'ffmpeg',
  outputFolder: outputDir,
  videoCodec: forceCpu ? 'libx264' : 'auto',
  skipExisting: true,
};

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  if (mix) { album.id = 'mix-smoke-test'; album.year = 'Mix'; album.albumName = 'Smoke Mix'; }
  if (!renderVideo) {
    album.tracks = Array.from({ length: trackCount }, (_, index) => ({
      ...album.tracks[0],
      id: `smoke-track-${index}`,
      trackNumber: index + 1,
      title: `Song ${String(index + 1).padStart(2, '0')} — Layout Test`,
      duration: 180,
    }));
    album.tracksCount = trackCount;
    album.totalDuration = trackCount * 180;
  }
  const ffmpegVersion = await testFfmpegPath('ffmpeg');
  console.log(`FFmpeg: ${ffmpegVersion}`);
  if (renderVideo) {
    const ffmpeg = resolveFfmpegPath('ffmpeg');
    const trackDurations = longVideo ? [120] : Array.from({ length: Math.max(2, trackCount) }, (_, index) => index % 2 === 0 ? 2.4 : 2.8);
    album.tracks = trackDurations.map((duration, index) => {
      const filePath = path.join(outputDir, `smoke_${index}.wav`);
      const result = spawnSync(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 220}:duration=${duration}`,
        '-ar', hiResAudio ? '96000' : mixedFormats && index === 1 ? '48000' : '44100', '-ac', mixedFormats && index === 1 ? '1' : '2',
        '-c:a', hiResAudio ? 'pcm_s24le' : 'pcm_s16le', filePath
      ], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`Failed to create test audio ${index}`);
      return {
        ...album.tracks[0],
        id: `smoke-track-${index}`,
        fileName: path.basename(filePath),
        filePath,
        trackNumber: index + 1,
        title: `Frame Decode Test ${index + 1}`,
        duration,
      };
    });
    album.tracksCount = album.tracks.length;
    album.totalDuration = trackDurations.reduce((sum, duration) => sum + duration, 0);
    const encoder = await resolveVideoCodecArgs('ffmpeg', settings.videoCodec, settings.exportQuality);
    console.log(`Encoder: ${encoder.codecName}`);
  }
  if (coverflow) {
    const colors = ['#a62639', '#206c91', '#88612a'];
    for (let index = 0; index < album.tracks.length; index++) {
      const coverPath = path.join(outputDir, `cover_${index}.png`);
      const result = spawnSync(resolveFfmpegPath('ffmpeg'), [
        '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `color=c=${colors[index % colors.length]}:s=600x600`, '-frames:v', '1', coverPath,
      ], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('Could not create Cover Flow test cover');
      album.tracks[index].coverPath = coverPath;
    }
    album.coverPath = album.tracks[0].coverPath;
    album.coverFound = true;
  }
  const slides = await generateSlidesForAlbum(album, settings, outputDir);
  const slide = slides[0];
  if (!slide || !fs.existsSync(slide) || fs.statSync(slide).size === 0) {
    throw new Error('Slide rendering did not produce a PNG.');
  }
  console.log(`${slide} (${fs.statSync(slide).size} bytes)`);
  if (renderVideo) {
    const result = await renderAlbumVideo(album, { ...settings, skipExisting: false }, slides, outputDir, () => {}, log => {
      if (log.type === 'error') console.error(log.text);
    });
    if (!fs.existsSync(result.videoPath) || fs.statSync(result.videoPath).size === 0) {
      throw new Error('The video renderer did not produce an MP4.');
    }
    const inspect = spawnSync(resolveFfmpegPath('ffmpeg'), ['-hide_banner', '-i', result.videoPath, '-f', 'null', '-'], { encoding: 'utf8' });
    if (inspect.status !== 0 || !inspect.stderr.includes('h264') || !inspect.stderr.includes(useAac ? 'aac' : 'alac')) {
      throw new Error(`The rendered MP4 did not decode correctly: ${inspect.stderr}`);
    }
    const durationMatch = inspect.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const actualDuration = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : NaN;
    if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - album.totalDuration) > 0.1) {
      throw new Error(`Unexpected output duration: ${actualDuration}s instead of ${album.totalDuration}s`);
    }
    const outputSize = fs.statSync(result.videoPath).size;
    if (!useAac && !mixedFormats) {
      const decodePcm = (filePath) => {
        const decoded = spawnSync(resolveFfmpegPath('ffmpeg'), [
          '-v', 'error', '-i', filePath, '-map', '0:a:0',
          '-c:a', hiResAudio ? 'pcm_s32le' : 'pcm_s16le',
          '-f', hiResAudio ? 's32le' : 's16le', '-'
        ], { maxBuffer: 64 * 1024 * 1024 });
        if (decoded.status !== 0) throw new Error(`Could not decode PCM from ${filePath}: ${decoded.stderr}`);
        return decoded.stdout;
      };
      const sourcePcm = Buffer.concat(album.tracks.map(track => decodePcm(track.filePath)));
      const renderedPcm = decodePcm(result.videoPath);
      if (!sourcePcm.equals(renderedPcm)) {
        let mismatch = 0;
        while (mismatch < Math.min(sourcePcm.length, renderedPcm.length) && sourcePcm[mismatch] === renderedPcm[mismatch]) mismatch++;
        throw new Error(`Lossless PCM mismatch at byte ${mismatch}: source=${sourcePcm.length}, rendered=${renderedPcm.length}`);
      }
      console.log(`Lossless PCM verified: ${renderedPcm.length} decoded bytes match sources`);
    }
    if (longVideo && (outputSize > 20 * 1024 * 1024 || !inspect.stderr.includes('1 fps'))) {
      throw new Error(`Still-image video was not compact: ${outputSize} bytes`);
    }
    console.log(`${result.videoPath} (${outputSize} bytes, ${actualDuration}s)`);
  }
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
