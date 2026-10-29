export interface ArtworkCropOptions {
  mode: 'crop' | 'fit';
  zoom: number;
  x: number;
  y: number;
}

export function getSquareArtworkLayout(width: number, height: number, options: ArtworkCropOptions, size: number) {
  if (width <= 0 || height <= 0 || size <= 0) throw new Error('Artwork dimensions must be positive.');
  if (options.mode === 'fit') {
    const scale = size / Math.max(width, height);
    return { sx: 0, sy: 0, sw: width, sh: height,
      dx: (size - width * scale) / 2, dy: (size - height * scale) / 2, dw: width * scale, dh: height * scale };
  }
  const side = Math.min(width, height) / Math.max(1, Math.min(4, options.zoom));
  return { sx: (width - side) * Math.max(0, Math.min(100, options.x)) / 100,
    sy: (height - side) * Math.max(0, Math.min(100, options.y)) / 100,
    sw: side, sh: side, dx: 0, dy: 0, dw: size, dh: size };
}
