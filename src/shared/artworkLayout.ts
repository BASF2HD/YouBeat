import { RenderSettings } from './types';
import { getArtworkTheme } from './artworkTheme';

export function getCoverSizePercent(settings: RenderSettings): number {
  const jewel = getArtworkTheme(settings) === 'jewel';
  const value = jewel ? settings.jewelCoverSizePercent : settings.classicCoverSizePercent;
  return typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 100
    ? Math.round(value) : jewel ? 75 : 100;
}

/** Height-based sizing keeps artwork proportional and moves the list beside it. */
export function getArtworkLayout(settings: RenderSettings, jewelCaseEnabled = getArtworkTheme(settings) === 'jewel') {
  const frameHeight = settings.resolution === '1280x720' ? 720 : 1080;
  const frameWidth = frameHeight * 16 / 9;
  const scale = frameHeight / 1080;
  const coverHeight = (frameHeight - 40 * scale) * getCoverSizePercent(settings) / 100;
  const coverWidth = coverHeight * (jewelCaseEnabled ? 3295 / 3008 : 1);
  return { frameWidth, coverWidth, coverHeight };
}
