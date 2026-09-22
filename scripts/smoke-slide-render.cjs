const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { generateSlidesForAlbum } = require('../dist/main/rendererService.js');

const outputDir = path.join(__dirname, '..', '.design-qa', 'slide-render-smoke');

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
    duration: 30,
  }],
  tracksCount: 1,
  totalDuration: 30,
  coverFound: false,
  coverPath: null,
  status: 'idle',
  progress: 0,
};

const settings = {
  resolution: '1280x720',
  fps: 30,
  backgroundColor: '#000000',
  fontFamily: 'Arial',
  activeColor: '#ffffff',
  inactiveColor: '#888888',
  artistItalic: true,
  useJewelCase: true,
  exportQuality: 'medium',
  introDuration: 0,
  fadeDuration: 0,
  scanRecursive: false,
  ffmpegPath: 'ffmpeg',
  outputFolder: outputDir,
  videoCodec: 'auto',
  skipExisting: true,
};

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const slides = await generateSlidesForAlbum(album, settings, outputDir);
  const slide = slides[0];
  if (!slide || !fs.existsSync(slide) || fs.statSync(slide).size === 0) {
    throw new Error('Slide rendering did not produce a PNG.');
  }
  console.log(`${slide} (${fs.statSync(slide).size} bytes)`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
