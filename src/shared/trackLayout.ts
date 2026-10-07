import { RenderSettings } from './types';

type TrackTypography = Pick<RenderSettings, 'trackTitleFontSize' | 'trackArtistFontSize'>;

export function getTrackFontSizes(settings: TrackTypography = {}) {
  const validSize = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
  return {
    title: validSize(settings.trackTitleFontSize, 40, 24, 64),
    artist: validSize(settings.trackArtistFontSize, 30, 12, 36),
  };
}

/** Preserve readable font sizes; advance the visible window with the active song. */
export function getTrackLayout(trackCount: number, activeTrackIndex: number, resolution: '1920x1080' | '1280x720', settings: TrackTypography = {}) {
  const frameHeight = resolution === '1920x1080' ? 1080 : 720;
  const frameWidth = resolution === '1920x1080' ? 1920 : 1280;
  const scale = frameHeight / 1080;
  const fonts = getTrackFontSizes(settings);
  const titleSize = fonts.title * scale;
  const artistSize = fonts.artist * scale;
  const numberSize = titleSize * .75;
  const playSize = titleSize * .8;
  const markerGap = titleSize * .15;
  // Reserve enough space for three-digit track numbers as well as the icon.
  const markerWidth = playSize + markerGap + numberSize * 1.8;
  // Each row retains both lines plus only six reference pixels of breathing room.
  const availableHeight = 900 * scale;
  const rowHeight = titleSize * 1.15 + artistSize * 1.1 + 6 * scale;
  const capacity = Math.max(1, Math.floor(availableHeight / rowHeight));
  const visibleCount = Math.min(trackCount, capacity);
  const rows = Math.max(1, visibleCount);
  const start = trackCount > capacity
    ? Math.min(Math.max(0, activeTrackIndex - Math.floor(capacity / 2)), trackCount - capacity)
    : 0;
  const end = start + visibleCount;

  return {
    start,
    end,
    rows,
    compact: false,
    rowHeight,
    frameWidth,
    scale,
    titleSize,
    artistSize,
    metaSize: 20 * scale,
    numberSize,
    playSize,
    markerGap,
    markerWidth,
  };
}
