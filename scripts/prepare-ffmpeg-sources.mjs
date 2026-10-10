import { mkdir, writeFile } from 'node:fs/promises';
import { download, macBase, sources } from './ffmpeg-download.mjs';
await mkdir('ffmpeg-sources', { recursive: true });
await Promise.all(sources.map(([name, sha]) => download(macBase + name, 'ffmpeg-sources/' + name, sha)));
await writeFile('ffmpeg-sources/FFmpeg-SOURCES.txt', 'Mac: complete component source archives distributed by dfloresc/ffmpeg-macos-builds v9.0.1-1.\nBuild scripts: https://github.com/dfloresc/ffmpeg-macos-builds/tree/v9.0.1-1\nWindows: Gyan GPLv3 essentials 6.1.1; FFmpeg commit e38092ef93.\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/e38092ef93\nVersions/configuration of external Windows libraries are in the bundled FFmpeg README.txt.\nLicenses remain with each component; FFmpeg is a separate executable, not linked into YouBeat.\n');
console.log('Downloaded and verified all ' + sources.length + ' Mac component source archives');
