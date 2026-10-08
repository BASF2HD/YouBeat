import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import ffmpegStaticPath from 'ffmpeg-static';
import * as mm from 'music-metadata';
import { Album, RenderSettings, LogItem } from '../shared/types';
import { formatDuration } from './rendererService';
import { getArtworkTheme } from '../shared/artworkTheme';

/**
 * Resolves the actual path to the ffmpeg executable.
 * The default uses the platform binary installed by ffmpeg-static. A custom
 * path in settings remains available as an override.
 */
export function resolveFfmpegPath(configuredPath: string): string {
  const base = configuredPath || 'ffmpeg';
  if (base === 'ffmpeg') {
    const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const bundledPath = ffmpegStaticPath?.replace('app.asar', 'app.asar.unpacked');
    const candidates = [
      bundledPath,
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', executableName),
      path.join(app.getAppPath(), 'bin', executableName),
      path.join(process.cwd(), 'bin', executableName),
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg'
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue to the next bundled or well-known system location.
      }
    }
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

/**
 * Tests if a specific video encoder is functional on the host machine.
 */
export function testEncoderSupport(ffmpegPath: string, encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const resolved = resolveFfmpegPath(ffmpegPath);
    const proc = spawn(resolved, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=3:size=640x360:rate=1',
      '-vf', 'format=yuv420p',
      '-c:v', encoder,
      ...(encoder === 'h264_videotoolbox' ? ['-allow_sw', '0'] : []),
      '-frames:v', '3',
      '-f', 'null',
      '-'
    ]);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Returns available hardware acceleration engines.
 */
export async function getAvailableHwEncoders(ffmpegPath: string): Promise<Array<{ id: string; name: string; available: boolean }>> {
  const encoders = [
    ...(process.platform === 'darwin'
      ? [{ id: 'h264_videotoolbox', name: 'Apple VideoToolbox (hardware H.264)' }]
      : [
          { id: 'h264_qsv', name: 'Intel Quick Sync (h264_qsv)' },
          { id: 'h264_nvenc', name: 'NVIDIA NVENC (h264_nvenc)' },
          { id: 'h264_amf', name: 'AMD AMF (h264_amf)' }
        ]),
    { id: 'libx264', name: 'CPU Software (libx264)' }
  ];

  const results: Array<{ id: string; name: string; available: boolean }> = [];
  for (const enc of encoders) {
    if (enc.id === 'libx264') {
      results.push({ ...enc, available: true });
    } else {
      const avail = await testEncoderSupport(ffmpegPath, enc.id);
      results.push({ ...enc, available: avail });
    }
  }
  return results;
}

/**
 * Resolves the video encoding flags based on settings and available hardware.
 */
export async function resolveVideoCodecArgs(
  ffmpegPath: string,
  preferredCodec: RenderSettings['videoCodec'] = 'auto',
  exportQuality: RenderSettings['exportQuality'] = 'medium'
): Promise<{ codecName: string; codecArgs: string[] }> {
  let chosenCodec = preferredCodec || 'auto';

  // An encoder choice saved on another computer should not force a Mac into
  // software mode simply because that hardware family does not exist here.
  if (process.platform === 'darwin' && !['auto', 'h264_videotoolbox', 'libx264'].includes(chosenCodec)) {
    chosenCodec = 'auto';
  }

  if (chosenCodec === 'auto') {
    // Apple Silicon uses VideoToolbox's dedicated media engine. Other platforms
    // keep their existing hardware probes, with software encoding as a fallback.
    if (process.platform === 'darwin') {
      chosenCodec = await testEncoderSupport(ffmpegPath, 'h264_videotoolbox')
        ? 'h264_videotoolbox'
        : 'libx264';
    } else if (await testEncoderSupport(ffmpegPath, 'h264_qsv')) {
      chosenCodec = 'h264_qsv';
    } else if (await testEncoderSupport(ffmpegPath, 'h264_nvenc')) {
      chosenCodec = 'h264_nvenc';
    } else if (await testEncoderSupport(ffmpegPath, 'h264_amf')) {
      chosenCodec = 'h264_amf';
    } else {
      chosenCodec = 'libx264';
    }
  } else if (chosenCodec !== 'libx264') {
    // Check if preferred HW encoder actually works, fallback to libx264 if not
    const works = await testEncoderSupport(ffmpegPath, chosenCodec);
    if (!works) {
      chosenCodec = 'libx264';
    }
  }

  // Configure quality parameters based on selected codec
  if (chosenCodec === 'h264_videotoolbox') {
    const bitrate = exportQuality === 'high' ? '10M' : exportQuality === 'small' ? '3M' : '6M';
    return {
      codecName: 'Apple VideoToolbox (hardware H.264)',
      codecArgs: ['-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-b:v', bitrate]
    };
  } else if (chosenCodec === 'h264_qsv') {
    // Intel QuickSync uses global_quality (1-51, lower is better)
    const q = exportQuality === 'high' ? '20' : exportQuality === 'small' ? '28' : '23';
    return {
      codecName: 'Intel Quick Sync (h264_qsv)',
      codecArgs: ['-c:v', 'h264_qsv', '-global_quality', q, '-preset', 'veryfast']
    };
  } else if (chosenCodec === 'h264_nvenc') {
    // NVIDIA NVENC uses -cq (1-51)
    const q = exportQuality === 'high' ? '19' : exportQuality === 'small' ? '28' : '23';
    return {
      codecName: 'NVIDIA NVENC (h264_nvenc)',
      codecArgs: ['-c:v', 'h264_nvenc', '-cq', q, '-preset', 'p4']
    };
  } else if (chosenCodec === 'h264_amf') {
    // AMD AMF uses -qp_i and -qp_p
    const q = exportQuality === 'high' ? '19' : exportQuality === 'small' ? '28' : '23';
    return {
      codecName: 'AMD AMF (h264_amf)',
      codecArgs: ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', q, '-qp_p', q]
    };
  } else {
    // CPU libx264 fallback
    const crf = exportQuality === 'high' ? '18' : exportQuality === 'small' ? '28' : '23';
    return {
      codecName: 'CPU Software (libx264)',
      codecArgs: ['-c:v', 'libx264', '-crf', crf, '-preset', 'veryfast', '-tune', 'stillimage']
    };
  }
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
 * Fail-fast preflight for the user's chosen output folder. Verifies that the
 * directory (1) can be created, (2) is writable via an actual file
 * create+write+unlink, and (3) sub-folders can be created inside it. This
 * catches EPERM / sandbox issues before the user wastes time generating
 * per-slide PNG frames. Throws a user-friendly error on failure.
 */
export async function ensureOutputWritable(outDir: string): Promise<void> {
  const sysRootHint = process.platform === 'win32'
    ? 'Try a local folder such as C:\\Videos, D:\\Renders, or your Desktop.'
    : 'Try a local folder such as ~/Videos or your home directory.';

  const makeError = (action: string, err: Error): Error => {
    const code = (err as NodeJS.ErrnoException).code;
    const hint =
      (code === 'EPERM' || code === 'EACCES' || code === 'EROFS' || /permission|not permitted|access denied/i.test(err.message))
        ? ` This is almost always caused by a sandbox/antivirus/network-share permission blocking the app's writes to "${outDir}". ${sysRootHint}`
        : '';
    return new Error(`Cannot ${action} in output folder "${outDir}": ${err.message}${hint}`);
  };

  try {
    await fs.promises.mkdir(outDir, { recursive: true });
  } catch (err) {
    throw makeError('create the output folder', err as Error);
  }

  try {
    const probe = path.join(outDir, `.youbeat-write-test-${process.pid}-${Date.now()}.tmp`);
    await fs.promises.writeFile(probe, 'ok', { encoding: 'utf-8', flag: 'w' });
    await fs.promises.unlink(probe);
  } catch (err) {
    throw makeError('write a test file', err as Error);
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

  // Fail fast BEFORE encoding a single frame. Also wraps any EPERM/EACCES with
  // a helpful sandbox/network share message and suggests a local alternative.
  await ensureOutputWritable(outDir);

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

  // Build final clean safe video and folder name: "Album Name (Year)"
  const safeAlbumName = `${album.albumName}${album.year && album.year !== 'Unknown' && album.year !== 'Mix' ? ` (${album.year})` : ''}`.replace(/[\\/:*?"<>|]/g, '_').trim();
  const outputStem = safeAlbumName;
  
  // Dedicated folder for each album inside the output directory
  const albumOutputDir = path.join(outDir, safeAlbumName);
  if (!fs.existsSync(albumOutputDir)) {
    await fs.promises.mkdir(albumOutputDir, { recursive: true });
  }

  const finalVideoPath = path.join(albumOutputDir, `${outputStem}.mp4`);
  const descriptionPath = path.join(albumOutputDir, `${outputStem} - Description.txt`);
  const thumbnailPath = path.join(albumOutputDir, `${outputStem} - Thumbnail.jpg`);

  // Fast Skip/Resume check: If video already rendered and valid (>1MB), skip immediately!
  if (settings.skipExisting && fs.existsSync(finalVideoPath)) {
    try {
      const stat = await fs.promises.stat(finalVideoPath);
      if (stat.size > 1024 * 1024) {
        log(`[Fast Resume] Album already rendered (${(stat.size / (1024 * 1024)).toFixed(1)} MB). Skipping: "${album.albumName}"`, 'success');
        onAlbumProgress(100);
        return {
          videoPath: finalVideoPath,
          descriptionPath,
          thumbnailPath,
          albumOutputDir
        };
      }
    } catch (e) {}
  }

  // Resolve the encoder once for all still-image tracks in this album.
  const { codecName, codecArgs } = await resolveVideoCodecArgs(
    ffmpeg,
    settings.videoCodec,
    settings.exportQuality
  );
  log(`Video Encoding Engine: ${codecName}`, 'info');

  // All segments are stream-copied into one MP4, so their audio codec settings
  // must agree. Probe the sources once before rendering any segment.
  const audioSources: Array<{ sampleRate: number; channels: number; bitsPerSample: number }> = [];
  for (const track of album.tracks) {
    const metadata = await mm.parseFile(track.filePath, { skipCovers: true, duration: false });
    const sampleRate = metadata.format.sampleRate;
    const channels = metadata.format.numberOfChannels;
    if (!sampleRate || !channels) {
      throw new Error(`Could not read the audio format of "${track.fileName}". Rendering stopped to avoid an incorrect audio export.`);
    }
    audioSources.push({ sampleRate, channels, bitsPerSample: metadata.format.bitsPerSample || 16 });
  }

  const audioCodec = settings.audioCodec || 'aac';
  const audioSampleRate = audioCodec === 'aac' ? 48000 : Math.max(...audioSources.map(source => source.sampleRate));
  const audioChannels = Math.max(...audioSources.map(source => source.channels));
  const needsAudioNormalization = audioSources.some(source =>
    source.sampleRate !== audioSampleRate || source.channels !== audioChannels
  );
  const audioArgs = audioCodec === 'alac'
    ? ['-c:a', 'alac', '-sample_fmt', audioSources.some(source => source.bitsPerSample > 16) ? 's32p' : 's16p', '-ar', String(audioSampleRate), '-ac', String(audioChannels)]
    : ['-c:a', 'aac', '-profile:a', 'aac_low', '-ar', String(audioSampleRate), '-ac', String(audioChannels), '-b:a', audioChannels === 1 ? '128k' : audioChannels <= 2 ? '384k' : '512k'];
  log(audioCodec === 'alac'
    ? `Audio Encoding: ALAC, ${audioSampleRate} Hz, ${audioChannels} channel(s); ${needsAudioNormalization ? 'mixed source formats are resampled/upmixed to a common format before lossless encoding' : 'source PCM is not downsampled'}.`
    : `Audio Encoding: YouTube upload profile, AAC-LC ${audioArgs[audioArgs.length - 1]}, ${audioSampleRate} Hz, ${audioChannels} channel(s); local lossy encoding, not YouTube's server encoder.`, 'info');

  // A slide does not change during a track. Encode it at about one frame per second
  // for the track's full duration so inter-frame compression can work across
  // the song. Repeating a one-second H.264 clip instead repeats its keyframe
  // every second and makes hour-long albums unnecessarily large.
  const segmentPaths: string[] = [];

  for (let i = 0; i < numTracks; i++) {
    const track = album.tracks[i];
    const slide = slidePaths[i];
    const segmentPath = path.join(tempDir, `track_${i}.mp4`);
    
    log(`Rendering Track segment ${i + 1}/${numTracks}: "${track.title}"`, 'info');

    // Handle duration edge case (e.g. metadata corrupt, zero length)
    // If zero, we assign a default fallback duration (e.g. 5 seconds) to prevent FFmpeg failing
    const duration = track.duration > 0 ? track.duration : 5;
    // Give fractional-length tracks an integral number of frames whose packet
    // durations add up to the track duration. A fixed 1 fps would round each
    // segment up to the next second and shift later slides out of sync.
    const transitionPattern = path.join(tempDir, `transition_${i}_%02d.png`);
    const hasCoverflowTransition = getArtworkTheme(settings) === 'coverflow' && i > 0 && duration > 0.4 &&
      fs.existsSync(path.join(tempDir, `transition_${i}_00.png`));
    const stillDuration = duration - (hasCoverflowTransition ? 0.4 : 0);
    const frameCount = Math.max(1, Math.ceil(stillDuration));
    const durationMs = Math.max(1, Math.round(stillDuration * 1000));
    const stillFrameRate = `${frameCount * 1000}/${durationMs}`;

    const args = hasCoverflowTransition ? [
      '-y',
      '-framerate', '30', '-start_number', '0', '-i', transitionPattern,
      '-loop', '1', '-framerate', stillFrameRate, '-i', slide,
      '-i', track.filePath,
      '-filter_complex', '[0:v]format=yuv420p,setsar=1[move];[1:v]format=yuv420p,setsar=1[still];[move][still]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a:0',
      '-pix_fmt', 'yuv420p',
      ...codecArgs,
      ...audioArgs,
      '-fps_mode', 'vfr',
      '-shortest',
      '-video_track_timescale', '90000',
      segmentPath
    ] : [
      '-y',
      '-loop', '1',
      '-framerate', stillFrameRate,
      '-i', slide,
      '-i', track.filePath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-pix_fmt', 'yuv420p',
      ...codecArgs,
      ...audioArgs,
      '-shortest',
      '-video_track_timescale', '90000',
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
    onAlbumProgress(Math.floor(((i + 1) / numTracks) * 85));
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
