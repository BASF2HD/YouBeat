# YouBeat 1.0.1

Create album videos locally for manual upload to YouTube.

- Classic artwork, CD jewel case and Cover Flow themes.
- Per-song artwork, mixed-album playback ordering, shuffle and configurable fonts/layout.
- Updated jewel-case overlay read consistently by preview and exported frames.
- Fresh scans discover new albums while reusing unchanged cached metadata.
- Bundled, license-checked FFmpeg; no separate installation required.
- Hardware H.264 when supported, with software fallback; AAC-LC stereo 384 kb/s at 48 kHz by default and optional ALAC.
- MP4, thumbnail and chapter-description exports with simple album/year filenames.

Apple Silicon: DMG or standalone .app ZIP. Windows x64: Setup or Portable EXE.
**Unsigned builds:** not Apple-notarized or Windows-signed. Verify provenance and SHA256SUMS before opening; operating-system warnings may appear.

Packaged synthetic audio-to-MP4 tests must pass on native Mac and Windows before publication. YouTube always re-encodes uploads; AAC is a lossy upload format, not bit-perfect preservation. ALAC is available for a lossless local export.

FFmpeg is a separate executable under its own GPL license. License notices, build configuration, source links and the Mac build's corresponding source archives accompany this release. The app is not affiliated with YouTube or Google.
