// The back is held for five full seconds, in addition to the two turns.
export const JEWEL_FLIP_SECONDS = 1;
export const JEWEL_BACK_SECONDS = 5;
export const JEWEL_FLIP_FRAMES = 30;

export function getJewelFlipTiming(trackDuration: number) {
  const duration = trackDuration > 0 ? trackDuration : 5;
  const turn = Math.min(JEWEL_FLIP_SECONDS, duration / 3);
  const hold = Math.min(JEWEL_BACK_SECONDS, duration - turn * 2);
  return { turn, hold, total: turn * 2 + hold, duration };
}

export function jewelFlipAngle(progress: number) {
  return -180 * (0.5 - Math.cos(Math.PI * progress) / 2);
}

// Shared by the live preview and the deterministic video-frame renderer.
export const jewelFlipCSS = `
  .jewel-flip-stage { perspective: 1600px; overflow: visible !important; }
  .jewel-flip { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
  .jewel-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .jewel-back { transform: rotateY(180deg); }
`;

export function jewelFlipKeyframes(trackDuration: number) {
  const { turn, hold, total } = getJewelFlipTiming(trackDuration);
  return `@keyframes jewel-turn {
    0% { transform: rotateY(0deg); }
    ${turn / total * 100}% { transform: rotateY(-180deg); }
    ${(turn + hold) / total * 100}% { transform: rotateY(-180deg); }
    100% { transform: rotateY(0deg); }
  }`;
}
