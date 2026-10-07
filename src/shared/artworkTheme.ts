import { RenderSettings } from './types';

export function getArtworkTheme(settings: RenderSettings): 'plain' | 'jewel' | 'coverflow' {
  return settings.artworkTheme || (settings.useJewelCase ? 'jewel' : 'plain');
}
