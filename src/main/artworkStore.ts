import { app, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

function decodeArtwork(bytes: Buffer) {
  // Decode the bytes again instead of reusing Chromium's cached file URL.
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('This image could not be read. Choose a valid JPG, PNG or WebP image.');
  return image;
}

async function storePNG(bytes: Buffer, name: string) {
  const folder = path.join(app.getPath('userData'), 'artwork');
  await fs.promises.mkdir(folder, { recursive: true });
  const stem = name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 70) || 'artwork';
  const filename = path.join(folder, `${stem}-${randomUUID()}.png`);
  await fs.promises.writeFile(filename, bytes, { flag: 'wx' });
  return filename;
}

export async function importArtworkFile(file: string) {
  const image = decodeArtwork(await fs.promises.readFile(file));
  // Every selection has a distinct URL, including edits saved over the same name.
  // Originals are never changed and saved artwork survives source moves/deletions.
  return storePNG(image.toPNG(), path.parse(file).name);
}

export async function readArtwork(file: string) {
  return decodeArtwork(await fs.promises.readFile(file)).toDataURL();
}

export async function saveCroppedArtwork(dataURL: string) {
  if (typeof dataURL !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL) || dataURL.length > 64 * 1024 * 1024) {
    throw new Error('Invalid cropped artwork image.');
  }
  const image = decodeArtwork(Buffer.from(dataURL.split(',')[1], 'base64'));
  const { width, height } = image.getSize();
  if (width !== height || width < 1 || width > 4096) throw new Error('Cropped artwork must be square and at most 4096 pixels.');
  return storePNG(image.toPNG(), 'back-cover-square');
}
