# YouBeat

[Download releases](https://github.com/BASF2HD/YouBeat/releases) · [Website](https://BASF2HD.github.io/YouBeat/)

Standalone downloads need no development tools. Builds are unsigned and not Apple-notarized; verify release SHA256SUMS before opening. Public release workflows require native packaged Mac and Windows tests to pass.

Formerly AlbumForge Studio. Existing settings, scan cache and metadata edits are
copied into the YouBeat profile on first launch; the original profile is retained.
Each library scan rediscovers folders, then reuses unchanged cached metadata, so
new albums appear without clearing the cache.

An Electron desktop application for Windows and macOS, built with React, TypeScript, Vite, and a bundled FFmpeg executable. It creates album videos (`.mp4`) from music folders.

---

## Key Capabilities

- **Automatic Folder Scanner**: Detects folders containing supported formats (`.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`) recursively or strictly at the root level.
- **Embedded Tag & Filename Parsing**: Automatically extracts track number, title, artist/singer, album, release year, and duration using `music-metadata`. If metadata tags are absent, the engine employs a regex parser to clean filename indicators (like leading tracks `01 -`, track lists `Song - Artist`, etc.) to generate clean fallbacks.
- **Artwork themes**: Choose a clean cover, CD jewel case, or Cover Flow presentation in Settings. Exported videos use only `Album Name (Year).mp4`, without theme, typography, mix IDs, or audio settings in the filename. Disable Fast Resume to replace an existing export after changing settings, or use a different output folder to keep both versions.
- **Mix Builder**: Select and reorder songs across scanned albums. Their individual album covers appear in the Cover Flow video and live preview.
- **Smart Adaptive Tracklist Viewport**: 
  - Generates a highlighted vertical listing of song names and singers (in italic) on the right side.
  - Classic/CD Jewel offer independent song-title and artist font controls (40/30 px defaults at 1080p), plus a saved Song row gap slider (0–40 px, default 8 px). Song numbers and play markers scale with the title size. Larger gaps show fewer rows; longer lists follow the current song instead of shrinking text or hiding artists.
  - Cover Flow defaults to its maximum sizes: 72 px song titles and 48 px album/year captions. Captions stay inside the centre cover width, with ellipsis for long names. All typography scales consistently for 720p and the preview. Reflections fade over opaque floor planes so farther sleeves cannot bleed through, including during slide transitions.
  - Classic/CD Jewel omit the album-summary header and use slim frame margins, fitting 12 rows at the default 40/30 px settings. When a list exceeds the available space, its visible window follows the active track.
  - Cover size is adjustable from 50–100% of the available frame height, saved separately for Classic (100% default) and CD Jewel (75% default). Artwork stays proportional; increasing its size moves the song list right. Preview and export use the same dimensions.
- **Efficient FFmpeg Assembly**:
  1. Encodes each track's still slide at about one frame per second to H.264, using Apple VideoToolbox on macOS when available. Inter-frame compression keeps long album files compact.
  2. Defaults to YouTube's recommended upload profile: AAC-LC at 48 kHz and 384 kb/s stereo (128 kb/s mono / 512 kb/s surround). This is a local lossy encode, not YouTube's server encoder. Lossless ALAC remains available for archival exports. YouTube re-encodes uploads regardless of the local profile.
  3. Joins the finished track segments without another video encode.
- **YouTube Metadata Exporters**:
  - Automatically exports a `Description.txt` containing cumulative timings (`00:00 Track 1 - Singer`, `04:32 Track 2 - Singer`).
  - Automatically exports the first slide layout as a high-quality `Thumbnail.jpg`.
  - Videos are saved locally for manual upload to YouTube Studio.
- **Local Metadata Edit Overrides**: Enables editing detected titles, years, track numbers, and singers in the UI, saving edits securely inside a local AppData `metadata_cache.json` rather than editing the user's source media.

---

## Project Structure

```
YouBeat/
├── package.json
├── vite.config.ts
├── vite.main.config.ts           # Bundles desktop runtime dependencies
├── tsconfig.json
├── index.html
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron Main process (IPC handlers & app boot)
│   │   ├── preload.ts            # Safe Electron IPC context bridge 
│   │   ├── scanner.ts            # Local catalog scanner (recursive & direct)
│   │   ├── metadata.ts           # music-metadata parser & fallback parser
│   │   ├── rendererService.ts    # Offscreen hidden window capturing PNG slides
│   │   ├── ffmpegService.ts      # Spawns FFmpeg, normalizes segments, and merges tracks
│   │   └── queueManager.ts       # Serial background queue with pause/cancel controls
│   ├── renderer/
│   │   ├── main.tsx              # React entry bootstrapper
│   │   ├── App.tsx               # Sleek Hero Dashboard UI (State and Events)
│   │   ├── theme.css             # Color systems & design tokens
│   │   └── index.css             # Layout styling, terminals, and CD previewer
│   └── shared/
│       └── types.ts              # Global TypeScript models
```

---

## Installation & Setup

### Prerequisite
Install Node.js with npm. FFmpeg does not need a separate installation.

### Get Started
1. Clone the repository and enter it:
   ```sh
   git clone https://github.com/BASF2HD/YouBeat.git
   cd YouBeat
   ```
2. Run `npm start`.

The first start installs dependencies, including the FFmpeg binary for that computer's operating system and CPU, then builds and opens the app. On an existing checkout, run `git pull` followed by `npm start`. The project keeps dependency versions in `package-lock.json`; the FFmpeg executable is downloaded during installation because each operating system and CPU needs its own binary. An installed desktop package already contains FFmpeg and does not require Node.js.

---

## Running the Application

Run `npm start` to install missing dependencies, build the code, and launch the desktop app. For frontend development, `npm run dev` starts the Vite server; Electron must be launched separately with `VITE_DEV_SERVER=true` in its environment.

---

## Standalone Windows and Mac applications

The installed app includes Electron and FFmpeg: users do not need Node.js, npm or a separate FFmpeg installation. Outputs are saved in `dist-package/`.

On a Windows x64 computer, install dependencies and build an installer **and** a portable executable:
```sh
npm install
npm run dist:win
```

On Apple Silicon macOS (12 or later), build a `.dmg` installer and `.zip` containing the `.app`:
```sh
npm install
npm run dist:mac
```

For an unpacked `.app` / application directory on the current computer:
```sh
npm run pack
```

Build on the same OS and CPU architecture as the intended package, using a fresh dependency installation. FFmpeg is a platform-specific executable; the build hook rejects mismatched cross-platform/architecture packages rather than shipping an unusable binary. Apple Silicon and Intel Mac builds are separate. Signing/notarization for public distribution requires the corresponding developer certificates; local builds can be unsigned.

This repository is a desktop application, not a browser-only web application. Its UI uses web technologies, but scanning local folders, launching FFmpeg and capturing export frames depend on Electron/Node. A web version would need a server rendering backend or a separate browser-compatible media pipeline.

### Packaged render regression test

Run `node scripts/test-packaged.mjs "path/to/packaged/executable"`. It launches an isolated temporary app profile, tests the real IPC metadata parser/output checks/jewel overlay/queue, and decodes a short synthetic H.264/AAC 48 kHz MP4. It never touches your library or saved settings.

Packaging provisions a checksum-pinned GPL FFmpeg build under `.vendor/ffmpeg`; licenses and provenance ship beside the executable. Mac packages use dfloresc/ffmpeg-macos-builds v9.0.1-1, including shared libraries and corresponding source archives in the release. Windows retains the checksum-verified Gyan GPLv3 build from ffmpeg-static 5.3.0. The build hook refuses nonfree or cross-platform binaries.

Before distributing a build, launch the packaged app with `--remote-debugging-port=9222`, then run `node scripts/verify-packaged-render.mjs --ffmpeg="/absolute/path/to/the/packaged/ffmpeg"`. Optionally pass `--output-folder="/your/existing/output"` to test that folder with a removable write probe. The test creates temporary synthetic audio, exercises the real IPC output check, metadata parser and render queue, then decodes the finished MP4. It does not render your music library or change your saved output setting.

---

## Technical Performance Optimization Notes

- **Offscreen Capture Repaint Timing**: The slide generator waits for images to load before capturing the hidden BrowserWindow, then allows a short paint delay.
- **FFmpeg Concat Stream Alignment**: The intermediate segments share a sample rate and channel layout. AAC uploads use 48 kHz; ALAC uses the highest source sample rate. This lets the final MP4 concatenate without re-encoding its finished streams. When sources differ, audio is converted to that common format; ALAC remains lossless after conversion, but cannot restore information absent from the originals.
- **Garbage Cleanup**: All intermediate PNG slides and segment `.mp4` chunks generated during render processes are completely deleted upon compile completion or cancellation, keeping disk footprint clean.
