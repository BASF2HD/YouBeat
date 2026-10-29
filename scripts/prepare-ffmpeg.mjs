// Download binaries at build time, never at app launch. Fail closed on provenance.
import { mkdir, mkdtemp, cp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { download, macBase } from './ffmpeg-download.mjs';
const destination = path.resolve('.vendor/ffmpeg');
await mkdir(destination, { recursive: true });
if (process.platform === 'darwin') {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null;
  if (!arch) throw new Error('Unsupported Mac architecture');
  const hash = arch === 'arm64' ? 'f49c7462a1a180fba7a80ded248972718de5f0d756c183ca66eb9a31c0b22fac' : '47b290c7b71c20b64bec4de65822b3a5d0cae4467f01e090ab68973484100f91';
  const name = 'ffmpeg-9.0.1-1-gpl-macos-' + arch;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'youbeat-ffmpeg-'));
  const archive = path.join(temporary, name + '.tar.xz');
  await download(macBase + name + '.tar.xz', archive, hash);
  const result = spawnSync('tar', ['-xf', archive, '-C', temporary], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('FFmpeg extraction failed');
  // Preserve relative library links instead of rewriting them to temporary paths.
  await rm(destination, { recursive: true, force: true });
  await cp(path.join(temporary, name), destination, { recursive: true, verbatimSymlinks: true });
  await writeFile(path.join(destination, 'PROVENANCE.txt'), macBase + name + '.tar.xz\nSHA256: ' + hash + '\nSources and build scripts: https://github.com/dfloresc/ffmpeg-macos-builds/tree/v9.0.1-1\nCorresponding source archives accompany the YouBeat GitHub Release.\n');
} else if (process.platform === 'win32' && process.arch === 'x64') {
  const source = createRequire(import.meta.url)('ffmpeg-static');
  const bytes = await readFile(source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00') throw new Error('Unexpected Windows FFmpeg binary; review provenance before release');
  await mkdir(path.join(destination, 'bin'), { recursive: true });
  await cp(source, path.join(destination, 'bin/ffmpeg.exe'));
  for (const suffix of ['LICENSE', 'README']) await cp(source + '.' + suffix, path.join(destination, suffix + '.txt'));
  await writeFile(path.join(destination, 'PROVENANCE.txt'), 'Windows Gyan GPLv3 build 6.1.1 from ffmpeg-static 5.3.0 / b6.1.1\nSHA256: ' + hash + '\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93\nExternal library versions and configuration: README.txt\nBuild provider: https://www.gyan.dev/ffmpeg/builds/\n');
} else throw new Error('Release packaging supports native Mac and Windows x64 only');
const binary = path.join(destination, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
await chmod(binary, 0o755);
const check = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10000 });
if (check.status !== 0 || !check.stdout.includes('ffmpeg version') || /--enable-nonfree|nonfree and unredistributable/i.test(check.stdout + check.stderr)) throw new Error('FFmpeg is not executable or is not redistributable: ' + check.stderr);
await writeFile(path.join(destination, 'VERSION.txt'), check.stdout);
console.log(check.stdout.split('\n')[0] + ': license and execution checks passed');
