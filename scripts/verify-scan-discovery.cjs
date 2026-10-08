const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanForAlbums } = require('../dist/main/scanner.js');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youbeat-scan-'));
  try {
    const first = path.join(root, 'first');
    await fs.mkdir(first);
    await fs.writeFile(path.join(first, 'song.wav'), 'fixture');
    assert.deepEqual(await scanForAlbums(root, false), [first]);
    const added = path.join(root, 'new-album');
    await fs.mkdir(added);
    await fs.writeFile(path.join(added, 'song.WAV'), 'fixture');
    assert.equal((await scanForAlbums(root, false)).length, 2, 'New albums must appear on rescan');
    const nested = path.join(root, 'artist', 'nested-album');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'song.flac'), 'fixture');
    assert.equal((await scanForAlbums(root, false)).length, 2);
    assert.equal((await scanForAlbums(root, true)).length, 3);
    await fs.unlink(path.join(first, 'song.wav'));
    assert.equal((await scanForAlbums(root, true)).length, 2, 'Removed albums must disappear');
    console.log('PASS: rescans discover additions, removals, uppercase extensions and nested albums.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
