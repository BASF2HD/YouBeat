import { Album, Track } from '../shared/types';
import { getJewelFlipTiming, jewelFlipCSS, jewelFlipKeyframes } from '../shared/jewelFlip';

const imageURL = (file: string) => `file:///${file.replace(/\\/g, '/')}`;

export function PreviewArtwork({ album, track, jewel, overlay, height }: {
  album: Album; track: Track | undefined; jewel: boolean; overlay: string; height: string;
}) {
  const frontPath = track?.coverPath || album.coverPath;
  const backPath = track?.backCoverPath === undefined ? album.backCoverPath : track.backCoverPath;
  const hasBack = jewel && Boolean(backPath);
  const front = <>
    {frontPath ? <img className="preview-cover-art" src={imageURL(frontPath)} alt="Front cover" /> :
      <div className="preview-cover-placeholder"><span>AF</span>{album.albumName.slice(0, 20)}</div>}
    {jewel && overlay && <img className="preview-jewel-case-overlay" src={overlay} alt="" />}
  </>;
  return <div className={`preview-cover-art-container ${jewel ? 'jewel-case-enabled' : ''} ${hasBack ? 'jewel-flip-stage' : ''}`} style={{ height }}>
    {hasBack ? <>
      <style>{jewelFlipCSS + jewelFlipKeyframes(track?.duration || 5) + `
        .app-container .jewel-flip { animation: jewel-turn ${getJewelFlipTiming(track?.duration || 5).total}s ease-in-out both !important; }
      `}</style>
      <div key={`${album.id}-${track?.id}-${backPath}`} className="jewel-flip">
        <div className="jewel-face jewel-front">{front}</div>
        <div className="jewel-face jewel-back">
          <img className="preview-cover-art" src={imageURL(backPath!)} alt="Back cover" />
          {overlay && <img className="preview-jewel-case-overlay" src={overlay} alt="" />}
        </div>
      </div>
    </> : front}
  </div>;
}
