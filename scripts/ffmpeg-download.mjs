import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
export const macBase = 'https://github.com/dfloresc/ffmpeg-macos-builds/releases/download/v9.0.1-1/';
export async function download(url, destination, sha256) {
  try {
    const cached = await readFile(destination);
    if (createHash('sha256').update(cached).digest('hex') === sha256) return;
  } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('Download failed: ' + response.status + ' ' + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Checksum mismatch: ' + url);
  await writeFile(destination, bytes);
}
export const sources = [
  [
    "ffmpeg-9.0.1.tar.xz",
    "cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635"
  ],
  [
    "dav1d-1.5.4.tar.xz",
    "686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5"
  ],
  [
    "lame-4.0.tar.gz",
    "3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb"
  ],
  [
    "libaom-3.15.0.tar.gz",
    "ea08c38ecc078bc85bb1b691020e52b06250f1a81fe7ca5b624629225081af96"
  ],
  [
    "libvpx-1.17.0.tar.gz",
    "1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a"
  ],
  [
    "opus-1.6.1.tar.gz",
    "6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1"
  ],
  [
    "x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.bz2",
    "6eeb82934e69fd51e043bd8c5b0d152839638d1ce7aa4eea65a3fedcf83ff224"
  ],
  [
    "x265_4.3.tar.gz",
    "83c53e4c8bbb8f1e33ed59e10a7d621d1d7801ca853910c3eb41f038b8ffb121"
  ]
];
