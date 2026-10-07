/** Keep the exported frame and the live preview on the same track window. */
export function getTrackLayout(trackCount: number, activeTrackIndex: number, resolution: '1920x1080' | '1280x720') {
  const frameHeight = resolution === '1920x1080' ? 1080 : 720;
  const frameWidth = resolution === '1920x1080' ? 1920 : 1280;
  const scale = frameHeight / 1080;
  // Keep song titles in one readable column. Dense lists omit the secondary
  // artist line rather than shrinking every title or clipping the final rows.
  const detailedLimit = frameHeight === 1080 ? 24 : 18;
  const capacity = frameHeight === 1080 ? 36 : 24;
  const visibleCount = Math.min(trackCount, capacity);
  const rows = Math.max(1, visibleCount);
  const compact = visibleCount > detailedLimit;
  const start = trackCount > capacity
    ? Math.min(Math.max(0, activeTrackIndex - Math.floor(capacity / 2)), trackCount - capacity)
    : 0;
  const end = start + visibleCount;
  const availableHeight = frameHeight === 1080 ? 900 : 600;
  // Do not spread a short playlist over the whole frame. Longer playlists
  // compress to the available height while retaining the same preview/export sizing.
  const rowHeight = Math.min(60 * scale, availableHeight / rows);

  return {
    start,
    end,
    rows,
    compact,
    rowHeight,
    frameWidth,
    scale,
    titleSize: compact ? Math.min(18 * scale, Math.max(13 * scale, rowHeight * 0.7))
      : Math.min(26 * scale, Math.max(14 * scale, rowHeight * 0.48)),
    artistSize: Math.min(16 * scale, Math.max(9 * scale, rowHeight * 0.26)),
  };
}
