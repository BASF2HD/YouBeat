import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Album, RenderSettings, LogItem } from '../shared/types';
import { formatDuration } from './rendererService';

/**
 * Resolves the actual path to the ffmpeg executable.
 * If the configured path is 'ffmpeg' (the default) but a local bin/ffmpeg.exe exists, use the local one.
 */
function resolveFfmpegPath(configuredPath: string): string {
  const base = configuredPath || 'ffmpeg';
  if (base === 'ffmpeg') {
    try {
      const localPath = path.join(app.getAppPath(), 'bin', 'ffmpeg.exe');
      if (fs.existsSync(localPath)) {
        return localPath;
      }
    } catch (e) {}

    try {
      const localCwdPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      if (fs.existsSync(localCwdPath)) {
        return localCwdPath;
      }
    } catch (e) {}
  }
  return base;
}

/**
 * Validates if the given ffmpeg command/path works.
 */
export function testFfmpegPath(ffmpegPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const resolved = resolveFfmpegPath(ffmpegPath);
    const proc = spawn(resolved, ['-version']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const firstLine = output.split('\n')[0] || 'ffmpeg version unknown';
        resolve(firstLine);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

let activeProc: any = null;

/**
 * Forcefully terminates any currently active FFmpeg child process.
 */
export function killActiveFfmpegProcess(): void {
  if (activeProc) {
    try {
      activeProc.kill('SIGKILL');
      activeProc = null;
    } catch (err) {
      console.error('Failed to kill active FFmpeg process:', err);
    }
  }
}

/**
 * Spawns an FFmpeg command and monitors progress, piping logs.
 */
function runFfmpegCmd(
  ffmpegPath: string,
  args: string[],
  onLog: (text: string) => void,
  onProgress?: (progressSeconds: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const resolved = resolveFfmpegPath(ffmpegPath);
    onLog(`Executing: ${resolved} ${args.join(' ')}`);

    const proc = spawn(resolved, args);
    activeProc = proc;

    let recentStderr = '';

    proc.stdout.on('data', (data) => {
      onLog(data.toString().trim());
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      recentStderr += line;
      if (recentStderr.length > 4000) {
        recentStderr = recentStderr.slice(-4000);
      }
      onLog(line.trim());

      // Parse FFmpeg progress: time=00:01:23.45
      if (onProgress) {
        const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hrs = parseInt(timeMatch[1], 10);
          const mins = parseInt(timeMatch[2], 10);
          const secs = parseInt(timeMatch[3], 10);
          const totalSecs = hrs * 3600 + mins * 60 + secs;
          onProgress(totalSecs);
        }
      }
    });

    proc.on('close', (code) => {
      activeProc = null;
      if (code === 0) {
        resolve();
      } else {
        const lastLines = recentStderr.trim().split('\n').filter(Boolean).slice(-4).join(' | ');
        reject(new Error(`FFmpeg failed with exit code ${code}${lastLines ? `: ${lastLines}` : ''}`));
      }
    });

    proc.on('error', (err) => {
      activeProc = null;
      reject(err);
    });
  });
}

/**
 * Assembles video segments and outputs a finished YouTube-ready MP4.
 */
export async function renderAlbumVideo(
  album: Album,
  settings: RenderSettings,
  slidePaths: string[],
  tempDir: string,
  onAlbumProgress: (progress: number) => void,
  onLogAdded: (log: LogItem) => void
): Promise<{ videoPath: string; descriptionPath: string; thumbnailPath: string; albumOutputDir: string }> {
  
  const ffmpeg = settings.ffmpegPath || 'ffmpeg';
  const outDir = settings.outputFolder;
  const numTracks = album.tracks.length;

  if (!fs.existsSync(outDir)) {
    await fs.promises.mkdir(outDir, { recursive: true });
  }

  // Create local logging wrapper
  const log = (text: string, type: LogItem['type'] = 'ffmpeg') => {
    onLogAdded({
      id: `${Date.now()}-${Math.random()}`,
      type,
      timestamp: new Date().toLocaleTimeString(),
      text
    });
  };

  log(`Starting render process for: ${album.albumName}`, 'info');

  // Verify FFmpeg binary is accessible
  try {
    const version = await testFfmpegPath(ffmpeg);
    log(`FFmpeg Verified: ${version}`, 'info');
  } catch (err: any) {
    log(`FFmpeg validation failed: ${err.message}`, 'error');
    throw new Error(`FFmpeg not found or invalid! Please check setup instructions. Error: ${err.message}`);
  }

  // Map quality setting to Constant Rate Factor (CRF)
  // CRF range: 0 (lossless) - 51 (worst). 18 is visually lossless, 23 is default, 28 is mobile-friendly.
  const crf = settings.exportQuality === 'high' ? '18' : settings.exportQuality === 'small' ? '28' : '23';
  const [width, height] = settings.resolution.split('x').map(Number);
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;

  // Step 1: Render intermediate MP4 segment for each track
  const segmentPaths: string[] = [];

  for (let i = 0; i < numTracks; i++) {
    const track = album.tracks[i];
    const slide = slidePaths[i];
    const segmentPath = path.join(tempDir, `track_${i}.mp4`);
    
    log(`Rendering Track segment ${i + 1}/${numTracks}: "${track.title}"`, 'info');

    // Handle duration edge case (e.g. metadata corrupt, zero length)
    // If zero, we assign a default fallback duration (e.g. 5 seconds) to prevent FFmpeg failing
    const duration = track.duration > 0 ? track.duration : 5;

    // FFmpeg arguments for encoding an image slide + audio file:
    // -loop 1: Loop the single input image
    // -r: set video frame rate (FPS)
    // -t: Limit output video duration to match exactly the audio length
    // -map 0:v:0: Explicitly use slide image as video (ignores embedded cover art in audio file)
    // -map 1:a:0: Explicitly use track audio as audio stream
    // -vf: Force even video dimensions & yuv420p to prevent libx264 external library errors (3752568763)
    // -c:v libx264: H.264 video codec
    // -crf: H.264 quality level
    // -c:a aac: AAC audio codec
    // -ar 44100 -ac 2: Force sample rate and channels to match identically (vital for concat copy!)
    // -shortest: Ends the segment as soon as the shortest stream ends
    const args = [
      '-y',
      '-loop', '1',
      '-r', String(settings.fps),
      '-i', slide,
      '-i', track.filePath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-crf', crf,
      '-preset', 'veryfast', // Balance rendering speed vs file size
      '-tune', 'stillimage',  // Highly optimizes H.264 for static slides
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-t', String(duration),
      '-shortest',
      segmentPath
    ];

    // Spawns and tracks progress for this specific track segment
    await runFfmpegCmd(ffmpeg, args, (text) => log(text, 'ffmpeg'), (secs) => {
      // Calculate overall progress: past tracks + current track progress
      const currentTrackCompletedRatio = Math.min(1, secs / duration);
      const totalTracksProcessedRatio = (i + currentTrackCompletedRatio) / numTracks;
      
      // Reserve 85% of total progress bar for segment rendering, 15% for concatenation/cleanup
      const computedProgress = Math.floor(totalTracksProcessedRatio * 85);
      onAlbumProgress(computedProgress);
    });

    segmentPaths.push(segmentPath);
  }

  // Step 2: Concatenate segments using the concat demuxer (extremely fast, zero copy)
  log('Concatenating all track segments into the final video file...', 'info');
  const concatListPath = path.join(tempDir, 'concat_list.txt');
  
  // Write the file list for FFmpeg concat demuxer
  // Must escape single quotes for FFmpeg's custom file syntax
  const concatFileContent = segmentPaths
    .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n');
    
  await fs.promises.writeFile(concatListPath, concatFileContent, 'utf-8');

  // Build final clean safe video and folder name: "Album Name (Year)"
  const safeAlbumName = `${album.albumName}${album.year && album.year !== 'Unknown' ? ` (${album.year})` : ''}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  
  // Create dedicated folder for each album inside the output directory
  const albumOutputDir = path.join(outDir, safeAlbumName);
  if (!fs.existsSync(albumOutputDir)) {
    await fs.promises.mkdir(albumOutputDir, { recursive: true });
  }

  const finalVideoPath = path.join(albumOutputDir, `${safeAlbumName}.mp4`);

  // Concatenate command: -c copy duplicates both streams instantly
  const concatArgs = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    finalVideoPath
  ];

  await runFfmpegCmd(ffmpeg, concatArgs, (text) => log(text, 'ffmpeg'));
  onAlbumProgress(95);

  // Step 3: Write YouTube description text and timestamps
  log('Generating YouTube-ready timestamps description file...', 'info');
  const descriptionPath = path.join(albumOutputDir, `${safeAlbumName} - Description.txt`);
  
  let descriptionContent = `Album: ${album.albumName}\nYear: ${album.year}\nTracks: ${album.tracksCount}\nTotal Duration: ${formatDuration(album.totalDuration)}\n\n`;
  descriptionContent += '--- TRACKLIST TIMESTAMPS ---\n';

  let currentTotalTime = 0;
  for (let i = 0; i < numTracks; i++) {
    const track = album.tracks[i];
    const timestamp = formatDuration(currentTotalTime);
    descriptionContent += `${timestamp} ${track.title} - ${track.artist}\n`;
    
    // Accumulate duration (force minimum 5s if track is corrupt)
    currentTotalTime += track.duration > 0 ? track.duration : 5;
  }

  await fs.promises.writeFile(descriptionPath, descriptionContent, 'utf-8');

  // Step 4: Generate YouTube Thumbnail from first slide PNG
  log('Generating YouTube high-quality cover thumbnail...', 'info');
  const thumbnailPath = path.join(albumOutputDir, `${safeAlbumName} - Thumbnail.jpg`);
  
  // Use FFmpeg to convert the first slide PNG to high quality JPG
  const thumbArgs = [
    '-y',
    '-i', slidePaths[0],
    '-q:v', '2', // High quality scale
    thumbnailPath
  ];
  await runFfmpegCmd(ffmpeg, thumbArgs, (text) => log(text, 'ffmpeg'));

  // Copy cover art into the dedicated album folder if available
  if (album.coverPath && fs.existsSync(album.coverPath)) {
    try {
      const coverExt = path.extname(album.coverPath) || '.jpg';
      const destCover = path.join(albumOutputDir, `Cover${coverExt}`);
      if (!fs.existsSync(destCover)) {
        await fs.promises.copyFile(album.coverPath, destCover);
      }
    } catch (copyErr) {
      console.warn('Failed to copy cover art to album folder:', copyErr);
    }
  }

  log(`Album Rendering Completed successfully: ${finalVideoPath}`, 'success');
  onAlbumProgress(100);

  return {
    videoPath: finalVideoPath,
    descriptionPath,
    thumbnailPath,
    albumOutputDir
  };
}
