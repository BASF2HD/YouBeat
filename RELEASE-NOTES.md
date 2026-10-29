# YouBeat 1.1.2

Optional back-cover artwork and square fitting for the CD jewel case theme, with native packages for Windows x64, Apple Silicon Macs and Intel Macs.

- Add or replace front and optional back artwork from each album's Edit dialog. Artwork is saved as a separate copy; replacing an edited image with the same filename refreshes the preview.
- Crop back artwork to a square with zoom and position controls, or fit the whole image with black padding. Originals stay unchanged.
- Each song turns the jewel case from right to left over one second, holds the back for five seconds, then turns back to the front. Preview and exported video use the same timing. Short songs shorten the animation to fit; albums without back artwork keep the front visible.
- Artwork choices persist across scans and restarts and follow the album into mixed-song videos.
- Fix Mac FFmpeg library links so bundled libraries remain portable after installation. Source development uses the installed native FFmpeg binary.
- Use an offscreen compositor for Windows video frames so rendering also works without an active desktop capture surface.
- Normalize Windows slide file URLs and run hosted Windows rendering tests with software compositing; normal app graphics settings are unchanged.
- Retain Classic, jewel case and Cover Flow themes; album and mixed-song rendering; AAC-LC or ALAC audio; MP4, thumbnail and chapter-description exports.

## Downloads

- **Apple Silicon Mac:** `YouBeat-1.1.2-mac-arm64.dmg` or `.zip`.
- **Intel Mac:** `YouBeat-1.1.2-mac-x64.dmg` or `.zip`.
- **Windows x64:** `YouBeat-1.1.2-win-x64-Setup.exe` or `YouBeat-1.1.2-win-x64-Portable.exe`.

Standalone packages include Electron and FFmpeg. No Node.js, npm or separate FFmpeg installation is needed. Turn off Fast Resume / skip existing when replacing an already exported video with new artwork.

Builds are unsigned and not Apple-notarized. Verify the trusted repository and `SHA256SUMS` before opening; operating-system warnings may appear.

Publication requires native builds, artwork/crop/animation checks and packaged synthetic audio-to-MP4 tests on all three targets. YouTube re-encodes uploads; AAC is lossy, while ALAC supports a lossless local export.

FFmpeg runs as a separate executable under its own GPL license. License notices, build configuration, source links and corresponding Mac component source archives accompany this release. YouBeat is not affiliated with YouTube or Google.
