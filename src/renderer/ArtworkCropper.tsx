import { useEffect, useRef, useState } from 'react';
import { ArtworkCropOptions, getSquareArtworkLayout } from '../shared/artworkCrop';

export function ArtworkCropper({ file, onApply, onCancel }: {
  file: string; onApply: (file: string) => void; onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [options, setOptions] = useState<ArtworkCropOptions>({ mode: 'crop', zoom: 1, x: 50, y: 50 });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { sectionRef.current?.scrollIntoView({ block: 'center' }); }, []);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const data = await window.api.readArtwork(file);
        const image = new Image();
        image.src = data;
        await image.decode();
        if (!disposed) setSource(image);
      } catch (error: any) {
        if (!disposed) setError(`Could not load artwork: ${error.message}`);
      }
    };
    void load();
    return () => { disposed = true; };
  }, [file]);

  const draw = (canvas: HTMLCanvasElement, image: HTMLImageElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not open artwork canvas.');
    const rect = getSquareArtworkLayout(image.naturalWidth, image.naturalHeight, options, canvas.width);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  };
  useEffect(() => {
    if (source && canvasRef.current) draw(canvasRef.current, source);
  }, [source, options]);

  const apply = async () => {
    if (!source) return;
    setSaving(true);
    setError('');
    try {
      const output = document.createElement('canvas');
      const edge = options.mode === 'fit' ? Math.max(source.naturalWidth, source.naturalHeight)
        : Math.min(source.naturalWidth, source.naturalHeight) / options.zoom;
      output.width = output.height = Math.max(1, Math.min(2048, Math.round(edge)));
      draw(output, source);
      onApply(await window.api.saveCroppedArtwork(output.toDataURL('image/png')));
    } catch (error: any) {
      setError(`Could not save square artwork: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return <section ref={sectionRef} className="artwork-cropper" aria-label="Square back cover editor">
    <strong>Fit back cover to a square</strong>
    <p>Crop to fill the case, or keep the full image with black padding. Choose Use square artwork, then Save overrides.</p>
    <div className="artwork-crop-layout">
      <div className="artwork-crop-preview"><canvas ref={canvasRef} width={512} height={512} aria-label="Square artwork preview" />{!source && <span>{error ? 'Image unavailable' : 'Loading artwork…'}</span>}</div>
      <div className="artwork-crop-controls">
        <label className="checkbox-row"><input type="radio" name="square-artwork-mode" checked={options.mode === 'crop'} disabled={saving} onChange={() => setOptions(current => ({ ...current, mode: 'crop' }))} />Crop to fill square</label>
        <label className="checkbox-row"><input type="radio" name="square-artwork-mode" checked={options.mode === 'fit'} disabled={saving} onChange={() => setOptions(current => ({ ...current, mode: 'fit' }))} />Fit whole image</label>
        {options.mode === 'crop' && <>
          <label>Zoom · {options.zoom.toFixed(2)}×<input aria-label="Crop zoom" type="range" min="1" max="4" step="0.05" value={options.zoom} disabled={saving} onChange={event => setOptions(current => ({ ...current, zoom: Number(event.target.value) }))} /></label>
          <label>Horizontal position<input aria-label="Crop horizontal position" type="range" min="0" max="100" value={options.x} disabled={saving} onChange={event => setOptions(current => ({ ...current, x: Number(event.target.value) }))} /></label>
          <label>Vertical position<input aria-label="Crop vertical position" type="range" min="0" max="100" value={options.y} disabled={saving} onChange={event => setOptions(current => ({ ...current, y: Number(event.target.value) }))} /></label>
          <button className="btn btn-secondary" disabled={saving} onClick={() => setOptions({ mode: 'crop', zoom: 1, x: 50, y: 50 })}>Reset crop</button>
        </>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="artwork-crop-actions"><button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel crop</button><button className="btn btn-primary" onClick={apply} disabled={!source || saving}>{saving ? 'Saving…' : 'Use square artwork'}</button></div>
  </section>;
}
