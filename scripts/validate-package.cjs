// ffmpeg-static installs a native OS/CPU binary. Do not create a cross-platform
// package that launches successfully but cannot render any videos.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Arch } = require('electron-builder');

module.exports = async context => {
  const targetArch = Arch[context.arch];
  if (context.electronPlatformName !== process.platform || targetArch !== process.arch) {
    throw new Error(`Build on the target OS/CPU with a fresh npm install: this checkout contains ${process.platform}/${process.arch} FFmpeg, but the requested package is ${context.electronPlatformName}/${targetArch}. Cross-platform/universal packaging needs separately provisioned FFmpeg binaries.`);
  }
  const path = require('node:path');
  const binary = path.join(context.packager.projectDir, '.vendor', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (!binary || !fs.existsSync(binary)) throw new Error('Bundled FFmpeg is missing. Run npm install on the target computer before packaging.');
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10000 });
  if (result.error || result.status !== 0 || !result.stdout.includes('ffmpeg version')) {
    throw new Error(`Bundled FFmpeg could not execute: ${result.error?.message || result.stderr}`);
  }
  if (/--enable-nonfree|nonfree and unredistributable/i.test(result.stdout + result.stderr)) {
    throw new Error('Refusing to package a non-redistributable FFmpeg build.');
  }
};
