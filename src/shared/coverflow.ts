import { RenderSettings } from './types';

const clampFontSize = (value: number | undefined, fallback: number, min: number, max: number) => {
  const size = Number(value);
  return Number.isFinite(size) && size >= min && size <= max ? Math.round(size) : fallback;
};

export function getCoverflowFontSizes(settings: RenderSettings) {
  return {
    song: clampFontSize(settings.coverflowSongFontSize, 40, 24, 72),
    album: clampFontSize(settings.coverflowAlbumFontSize, 34, 18, 48),
  };
}

export function getCoverflowSideCount(trackCount: number) {
  return Math.min(4, Math.floor((trackCount - 1) / 2));
}
