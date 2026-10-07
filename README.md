# AlbumForge Studio

An Electron desktop application for Windows and macOS, built with React, TypeScript, Vite, and a bundled FFmpeg executable. It creates album videos (`.mp4`) from music folders.

---

## Key Capabilities

- **Automatic Folder Scanner**: Detects folders containing supported formats (`.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`) recursively or strictly at the root level.
- **Embedded Tag & Filename Parsing**: Automatically extracts track number, title, artist/singer, album, release year, and duration using `music-metadata`. If metadata tags are absent, the engine employs a regex parser to clean filename indicators (like leading tracks `01 -`, track lists `Song - Artist`, etc.) to generate clean fallbacks.
- **Artwork themes**: Choose a clean cover, CD jewel case, or Cover Flow presentation in Settings. Each theme renders to a distinct output filename, so switching themes creates a new video.
- **Mix Builder**: Select and reorder songs across scanned albums. Their individual album covers appear in the Cover Flow video and live preview.
- **Smart Adaptive Tracklist Viewport**: 
  - Generates a highlighted vertical listing of song names and singers (in italic) on the right side.
  - Classic/CD Jewel offer independent song-title and artist font controls (40/20 px defaults at 1080p). Rows grow with the chosen sizes; longer lists follow the current song instead of shrinking text or hiding artists.
  - Cover Flow defaults to 52 px song titles and 38 px album/year captions. Captions stay inside the centre cover width, with ellipsis for long names. All typography scales consistently for 720p and the preview.
  - If an album contains more than 12 tracks, the layout automatically shifts to a moving viewport that scrolls to center around the active playing track.
- **Efficient FFmpeg Assembly**:
  1. Encodes each track's still slide at about one frame per second to H.264, using Apple VideoToolbox on macOS when available. Inter-frame compression keeps long album files compact.
  2. Encodes the matching audio to ALAC by default, or AAC when selected, without duplicating 30 identical video frames each second. Mixed source formats use a common sample rate and channel layout before encoding.
  3. Joins the finished track segments without another video encode.
- **YouTube Metadata Exporters**:
  - Automatically exports a `Description.txt` containing cumulative timings (`00:00 Track 1 - Singer`, `04:32 Track 2 - Singer`).
  - Automatically exports the first slide layout as a high-quality `Thumbnail.jpg`.
  - Videos are saved locally for manual upload to YouTube Studio.
- **Local Metadata Edit Overrides**: Enables editing detected titles, years, track numbers, and singers in the UI, saving edits securely inside a local AppData `metadata_cache.json` rather than editing the user's source media.

---

## Project Structure

```
AlbumForge Studio/
├── package.json
├── vite.config.ts
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
   git clone https://github.com/BASF2HD/bulk-album-video-generator.git
   cd bulk-album-video-generator
   ```
2. Run `npm start`.

The first start installs dependencies, including the FFmpeg binary for that computer's operating system and CPU, then builds and opens the app. On an existing checkout, run `git pull` followed by `npm start`. The project keeps dependency versions in `package-lock.json`; the FFmpeg executable is downloaded during installation because each operating system and CPU needs its own binary. An installed desktop package already contains FFmpeg and does not require Node.js.

---

## Running the Application

Run `npm start` to install missing dependencies, build the code, and launch the desktop app. For frontend development, `npm run dev` starts the Vite server; Electron must be launched separately with `VITE_DEV_SERVER=true` in its environment.

---

## Building & Packaging (Windows 10/11)

To compile the application into a standalone `.exe` installable package:
```powershell
# Standard package compilation (creates dist-package/ installer)
npm run dist
```
Or compile a fast, unpacked local folder to test compilation outputs:
```powershell
# Fast unpacked build check
npm run pack
```

---

## Technical Performance Optimization Notes

- **Offscreen Capture Repaint Timing**: The slide generator waits for images to load before capturing the hidden BrowserWindow, then allows a short paint delay.
- **FFmpeg Concat Stream Alignment**: The intermediate segments share a sample rate and channel layout, chosen from the highest-rate source in the selection. This lets the final MP4 concatenate without re-encoding its finished streams. When sources differ, the lower-rate/channel audio is converted to that common format; ALAC remains lossless after this conversion, but cannot restore information absent from the originals.
- **Garbage Cleanup**: All intermediate PNG slides and segment `.mp4` chunks generated during render processes are completely deleted upon compile completion or cancellation, keeping disk footprint clean.
