# Bulk Album Video Generator 💿⚡

An automated, ultra-premium Windows desktop application built with **Electron + React + TypeScript + Vite + FFmpeg** designed to batch compile gorgeous, high-fidelity YouTube-ready music album videos (`.mp4`) directly from folders.

---

## Key Capabilities

- **Automatic Folder Scanner**: Detects folders containing supported formats (`.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`) recursively or strictly at the root level.
- **Embedded Tag & Filename Parsing**: Automatically extracts track number, title, artist/singer, album, release year, and duration using `music-metadata`. If metadata tags are absent, the engine employs a regex parser to clean filename indicators (like leading tracks `01 -`, track lists `Song - Artist`, etc.) to generate clean fallbacks.
- **Realistic CD Jewel Case Render**: Renders a visually striking glassmorphic jewel case displaying the booklet and a peaking vinyl CD sticking out of the sleeve on the left side of the screen.
- **Smart Adaptive Tracklist Viewport**: 
  - Generates a highlighted vertical listing of song names and singers (in italic) on the right side.
  - Dynamically calculates font sizing based on song count to prevent screen overflow.
  - If an album contains more than 12 tracks, the layout automatically shifts to a moving viewport that scrolls to center around the active playing track.
- **Zero-Loss Ultra-Fast FFmpeg Assembly**:
  1. For each track, compiles a highly-optimized intermediate H.264 still-image MP4 segment matching the exact duration of the track.
  2. Normalizes all audio formats to standard AAC 44,100 Hz stereo, which allows FFmpeg's concat copy demuxer to instantly stitch the final album video together in **seconds** with zero audio/video quality degradation and zero re-encoding!
- **YouTube Metadata Exporters**:
  - Automatically exports a `Description.txt` containing cumulative timings (`00:00 Track 1 - Singer`, `04:32 Track 2 - Singer`).
  - Automatically exports the first slide layout as a high-quality `Thumbnail.jpg`.
- **Local Metadata Edit Overrides**: Enables editing detected titles, years, track numbers, and singers in the UI, saving edits securely inside a local AppData `metadata_cache.json` rather than editing the user's source media.

---

## Project Structure

```
Album Video Generator/
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

### Prerequisites
1. **Node.js** (v18 or higher recommended).
2. **FFmpeg** installed on your system (added to global PATH) OR you can specify the exact path to your local `ffmpeg.exe` binary in the application settings panel.

### Get Started
1. Clone or navigate into the project workspace:
   ```powershell
   cd "C:\Users\User\Downloads\App\Album Video Generator"
   ```
2. Install npm dependencies:
   ```powershell
   npm install
   ```

---

## Running the Application

### Development Mode
Runs the React frontend inside Vite's hot-reload server and launches the Electron container:
```powershell
# Starts the Vite dev server and opens the Electron desktop app
npm run dev
```
*(In a separate shell or automatically, you can run `npm run electron:dev` to reload Electron if you make changes to main process files).*

Wait, a unified single-command shortcut:
```powershell
# Compiles code and launches the complete desktop application
npm start
```

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

- **Offscreen Capture Repaint Timing**: The slide generator utilizes `webContents.capturePage()` inside a hidden BrowserWindow. A custom `350ms` timeout is integrated to allow large image buffers (cover arts) to fully paint to Chromium before the capture, avoiding blank slides on slower machines.
- **FFmpeg Concat Stream Alignment**: The intermediate segment encoder forces standard audio metrics (`-ar 44100 -ac 2 -b:a 192k`). This avoids FFmpeg throwing channel mismatches or sample-rate differences during concatenation, allowing the copy demuxer to run instantly.
- **Garbage Cleanup**: All intermediate PNG slides and segment `.mp4` chunks generated during render processes are completely deleted upon compile completion or cancellation, keeping disk footprint clean.
