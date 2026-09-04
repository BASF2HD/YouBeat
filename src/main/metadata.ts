import * as fs from 'fs';
import * as path from 'path';
import * as mm from 'music-metadata';
import { Track, Album } from '../shared/types';

// Supported image extensions for covers
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Extracts a leading number from a filename for track sorting.
 */
function parseLeadingNumber(filename: string): number | null {
  const match = filename.match(/^\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parses and cleans a filename to extract title and artist fallbacks.
 */
export function parseFilename(filename: string): { title: string; artist: string; trackNo: number | null } {
  // Remove extension
  const ext = path.extname(filename);
  let name = filename.slice(0, -ext.length).trim();

  // Extract leading track number
  const numMatch = name.match(/^\s*(\d+)(?:\s*[-._ ]\s*|\s+)?(.*)$/);
  let trackNo: number | null = null;
  if (numMatch) {
    trackNo = parseInt(numMatch[1], 10);
    name = numMatch[2].trim();
  }

  // Check for "Song - Artist" or "Artist - Song" split
  // Note: We search for " - " as a clean delimiter
  let title = name;
  let artist = '';
  if (name.includes(' - ')) {
    const parts = name.split(' - ');
    if (parts.length >= 2) {
      title = parts[0].trim();
      artist = parts.slice(1).join(' - ').trim();
    }
  }

  return {
    title: title || 'Unknown Title',
    artist: artist || 'Unknown Artist',
    trackNo
  };
}

/**
 * Scans an album folder and compiles complete Album details.
 */
export async function parseAlbumFolder(folderPath: string, tempCoversDir: string): Promise<Album> {
  const folderName = path.basename(folderPath);
  
  // Extract year from folder name parenthesis if any, e.g. "Aalappiranthavan (1987)"
  let folderYear = '';
  const yearMatch = folderName.match(/\((\d{4})\)/);
  if (yearMatch) {
    folderYear = yearMatch[1];
  }

  const files = await fs.promises.readdir(folderPath);
  const audioFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp3', '.flac', '.wav', '.m4a', '.aac'].includes(ext);
  });

  const tracks: Track[] = [];
  let embeddedCoverBuffer: Buffer | null = null;
  let embeddedCoverMime = 'image/jpeg';
  
  let albumTitleMetadata = '';
  let albumYearMetadata = '';

  for (const file of audioFiles) {
    const filePath = path.join(folderPath, file);
    try {
      const metadata = await mm.parseFile(filePath);
      const duration = metadata.format.duration || 0;
      
      // Try to capture embedded cover art from the first track that has it
      if (!embeddedCoverBuffer && metadata.common.picture && metadata.common.picture.length > 0) {
        embeddedCoverBuffer = Buffer.from(metadata.common.picture[0].data);
        embeddedCoverMime = metadata.common.picture[0].format || 'image/jpeg';
      }

      // Track details
      const trackNo = metadata.common.track.no || parseLeadingNumber(file) || 0;
      const metaTitle = metadata.common.title?.trim();
      const metaArtist = metadata.common.artist?.trim();
      
      // Fallback name parsing
      const parsedFn = parseFilename(file);

      const title = metaTitle || parsedFn.title;
      const artist = metaArtist || parsedFn.artist;
      
      if (!albumTitleMetadata && metadata.common.album) {
        albumTitleMetadata = metadata.common.album.trim();
      }
      if (!albumYearMetadata && metadata.common.year) {
        albumYearMetadata = String(metadata.common.year).trim();
      }

      tracks.push({
        id: `${folderName}-${file}-${tracks.length}`,
        filePath,
        fileName: file,
        trackNumber: trackNo || parsedFn.trackNo || 0,
        title,
        artist,
        album: metadata.common.album?.trim() || albumTitleMetadata || folderName,
        year: metadata.common.year ? String(metadata.common.year).trim() : folderYear || 'Unknown',
        duration
      });
    } catch (err) {
      console.error(`Error parsing file metadata for: ${filePath}`, err);
      // Absolute fallback if parsing fails completely (e.g. corrupt header)
      const parsedFn = parseFilename(file);
      tracks.push({
        id: `${folderName}-${file}-${tracks.length}`,
        filePath,
        fileName: file,
        trackNumber: parsedFn.trackNo || 0,
        title: parsedFn.title,
        artist: parsedFn.artist,
        album: folderName,
        year: folderYear || 'Unknown',
        duration: 0
      });
    }
  }

  // Sort tracks
  tracks.sort((a, b) => {
    if (a.trackNumber !== b.trackNumber) {
      return a.trackNumber - b.trackNumber;
    }
    // If track numbers are identical, sort by leading number in filename
    const aLead = parseLeadingNumber(a.fileName) ?? 999;
    const bLead = parseLeadingNumber(b.fileName) ?? 999;
    if (aLead !== bLead) {
      return aLead - bLead;
    }
    // Final fallback alphabetical
    return a.fileName.localeCompare(b.fileName);
  });

  // Calculate album info
  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);
  const albumName = albumTitleMetadata || folderName.replace(/\s*\(\d{4}\)/, '').trim();
  const year = albumYearMetadata || folderYear || 'Unknown';

  // Find cover art
  let coverPath: string | null = null;
  let coverFound = false;

  // Priority 1: Embedded Cover Art
  if (embeddedCoverBuffer) {
    try {
      const ext = embeddedCoverMime.includes('png') ? '.png' : '.jpg';
      const safeFolderName = folderName.replace(/[^a-zA-Z0-9]/g, '_');
      const tempPath = path.join(tempCoversDir, `embedded_${safeFolderName}${ext}`);
      
      // Make sure temp directory exists
      await fs.promises.mkdir(tempCoversDir, { recursive: true });
      await fs.promises.writeFile(tempPath, embeddedCoverBuffer);
      coverPath = tempPath;
      coverFound = true;
    } catch (err) {
      console.error('Failed to write embedded cover art:', err);
    }
  }

  // Priority 2 - 5: Loose image files in directory
  if (!coverFound) {
    const priorityNames = [
      'cover.jpg', 'cover.png', 'cover.jpeg',
      'folder.jpg', 'folder.png', 'folder.jpeg',
      'front.jpg', 'front.png', 'front.jpeg'
    ];

    // Priority 2-4: Check exact match case-insensitively
    for (const priority of priorityNames) {
      const found = files.find(f => f.toLowerCase() === priority);
      if (found) {
        coverPath = path.join(folderPath, found);
        coverFound = true;
        break;
      }
    }

    // Priority 5: First image file in directory
    if (!coverFound) {
      const firstImage = files.find(f => {
        const ext = path.extname(f).toLowerCase();
        return IMAGE_EXTENSIONS.has(ext);
      });
      if (firstImage) {
        coverPath = path.join(folderPath, firstImage);
        coverFound = true;
      }
    }
  }

  return {
    id: folderPath, // Path is inherently unique
    folderPath,
    albumName,
    year,
    tracksCount: tracks.length,
    coverPath,
    coverFound,
    totalDuration,
    tracks,
    status: 'idle',
    progress: 0
  };
}
