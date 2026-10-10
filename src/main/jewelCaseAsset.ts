import * as fs from 'fs';
import * as path from 'path';

// Read at use-time: preview and export must never use different Vite-bundled copies.
export async function readJewelCaseOverlay(): Promise<string> {
  const filename = path.join(__dirname, '../../resources/cd-jewel-case-overlay.png');
  const bytes = await fs.promises.readFile(filename);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('CD jewel case overlay must be a valid PNG');
  }
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
