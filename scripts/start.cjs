const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const packageManagerCli = process.env.npm_execpath;
const usesPnpm = packageManagerCli ? path.basename(packageManagerCli).includes('pnpm') : false;

function installedExecutable(packageName) {
  try {
    const executable = require(require.resolve(packageName, { paths: [projectRoot] }));
    if (typeof executable !== 'string') return null;
    fs.accessSync(executable, fs.constants.X_OK);
    return executable;
  } catch {
    return null;
  }
}

function runPackageManager(args) {
  const cli = packageManagerCli;
  if (!cli || !fs.existsSync(cli)) {
    throw new Error('npm is required. Install Node.js, then run npm start again.');
  }

  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const needsInstall = !installedExecutable('ffmpeg-static') || !installedExecutable('electron');

if (needsInstall) {
  console.log('Installing app dependencies and the bundled FFmpeg for this computer...');
  runPackageManager(usesPnpm ? ['install'] : ['ci']);
}

const ffmpeg = installedExecutable('ffmpeg-static');
if (!ffmpeg) {
  throw new Error('Bundled FFmpeg is missing. Allow dependency install scripts, then run npm ci.');
}

if (process.argv.includes('--check')) {
  console.log(`FFmpeg ready: ${ffmpeg}`);
  process.exit(0);
}

runPackageManager(['run', 'build']);

const electron = installedExecutable('electron');
if (!electron) throw new Error('Electron was not installed correctly. Run npm ci and try again.');

const app = spawn(electron, ['.'], { cwd: projectRoot, stdio: 'inherit' });
app.on('error', error => {
  console.error(error);
  process.exitCode = 1;
});
app.on('exit', code => {
  process.exitCode = code || 0;
});
