import { app, safeStorage, shell } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

type Credentials = { clientId: string; refreshToken: string };
type Page<T> = { items: T[]; nextPageToken?: string };
export type YouTubeChannel = { id: string; title: string; thumbnail?: string; uploadsPlaylistId: string };
export type YouTubePlaylist = { id: string; title: string; itemCount: number };
export type YouTubeVideo = { id: string; title: string; thumbnail?: string; publishedAt?: string };

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];
const API_ROOT = 'https://www.googleapis.com/youtube/v3';
let accessToken: { value: string; expiresAt: number } | null = null;
let uploadAbort: AbortController | null = null;

function credentialsPath(): string { return path.join(app.getPath('userData'), 'youtube-oauth.json'); }
export function hasYouTubeCredentials(): boolean { return fs.existsSync(credentialsPath()); }

function loadCredentials(): Credentials | null {
  if (!fs.existsSync(credentialsPath())) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS credential storage is unavailable on this computer. YouTube sign-in is disabled.');
  const saved = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  return { clientId: saved.clientId, refreshToken: safeStorage.decryptString(Buffer.from(saved.refreshToken, 'base64')) };
}

async function saveCredentials(credentials: Credentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS credential storage is unavailable on this computer.');
  await fs.promises.mkdir(path.dirname(credentialsPath()), { recursive: true });
  const payload = JSON.stringify({
    clientId: credentials.clientId,
    refreshToken: safeStorage.encryptString(credentials.refreshToken).toString('base64'),
  });
  await fs.promises.writeFile(credentialsPath(), payload, { mode: 0o600 });
}

async function tokenRequest(body: URLSearchParams): Promise<any> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.error_description || data.error || `Google sign-in failed (${response.status})`);
  return data;
}

export async function connectYouTube(clientId: string): Promise<YouTubeChannel> {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Enter a Google Desktop OAuth client ID ending in .apps.googleusercontent.com.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure OS credential storage is unavailable.');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  let settle!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => { settle = resolve; rejectCode = reject; });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in response.');
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    response.writeHead(code ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(code ? '<h2>AlbumForge Studio is connected to YouTube.</h2><p>You may close this tab and return to the app.</p>' : '<h2>YouTube sign-in was not completed.</h2>');
    if (code) settle(code);
    else rejectCode(new Error(error || 'YouTube sign-in was cancelled.'));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not open local Google sign-in callback.'); }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state }).forEach(([key, value]) => authUrl.searchParams.set(key, value));
  const timeout = setTimeout(() => rejectCode(new Error('YouTube sign-in timed out. Try again.')), 5 * 60 * 1000);
  try {
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;
    const tokens = await tokenRequest(new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
    if (!tokens.refresh_token) throw new Error('Google did not return an offline refresh token. Reconnect and grant consent.');
    await saveCredentials({ clientId, refreshToken: tokens.refresh_token });
    accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
    return getYouTubeChannel();
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}

export async function disconnectYouTube(): Promise<void> {
  const credentials = loadCredentials();
  accessToken = null;
  if (credentials) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(credentials.refreshToken)}`, { method: 'POST' }); }
    catch { /* Delete local credentials even when offline. */ }
  }
  if (fs.existsSync(credentialsPath())) await fs.promises.unlink(credentialsPath());
}

async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const credentials = loadCredentials();
  if (!credentials) throw new Error('Connect a YouTube channel in the app first.');
  const tokens = await tokenRequest(new URLSearchParams({ client_id: credentials.clientId, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }));
  accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return accessToken.value;
}

async function apiGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${API_ROOT}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); });
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.error?.message || `YouTube request failed (${response.status})`);
  return data;
}

export async function getYouTubeChannel(): Promise<YouTubeChannel> {
  const data = await apiGet('channels', { part: 'snippet,contentDetails', mine: 'true' });
  const channel = data.items?.[0];
  if (!channel) throw new Error('No YouTube channel is associated with this Google account.');
  return {
    id: channel.id, title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.default?.url,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

export async function listYouTubePlaylists(pageToken = ''): Promise<Page<YouTubePlaylist>> {
  const data = await apiGet('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50', pageToken });
  return { items: (data.items || []).map((item: any) => ({ id: item.id, title: item.snippet.title, itemCount: item.contentDetails.itemCount || 0 })), nextPageToken: data.nextPageToken };
}

export async function listYouTubeVideos(pageToken = ''): Promise<Page<YouTubeVideo>> {
  const channel = await getYouTubeChannel();
  return listYouTubePlaylistVideos(channel.uploadsPlaylistId, pageToken);
}

export async function listYouTubePlaylistVideos(playlistId: string, pageToken = ''): Promise<Page<YouTubeVideo>> {
  if (!playlistId) throw new Error('Choose a playlist first.');
  const data = await apiGet('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: '50', pageToken });
  return { items: (data.items || []).map((item: any) => ({ id: item.contentDetails.videoId, title: item.snippet.title, thumbnail: item.snippet.thumbnails?.default?.url, publishedAt: item.contentDetails.videoPublishedAt })), nextPageToken: data.nextPageToken };
}

export function cancelYouTubeUpload(): void { uploadAbort?.abort(); }

export async function uploadYouTubeVideo(
  filePath: string, title: string, description: string, privacy: 'private' | 'unlisted' | 'public',
  onProgress: (percent: number) => void
): Promise<string> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || path.extname(filePath).toLowerCase() !== '.mp4') throw new Error('Choose a rendered MP4 file.');
  if (!title.trim() || title.length > 100) throw new Error('A video title of 1–100 characters is required.');
  if (description.length > 5000) throw new Error('YouTube descriptions cannot exceed 5,000 characters.');
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new Error('Invalid privacy setting.');
  const token = await getAccessToken();
  const initiate = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(stat.size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify({ snippet: { title: title.trim(), description, categoryId: '10' }, status: { privacyStatus: privacy } }),
  });
  if (!initiate.ok) {
    const error = await initiate.json().catch(() => ({})) as any;
    throw new Error(error.error?.message || `Could not start YouTube upload (${initiate.status})`);
  }
  const location = initiate.headers.get('location');
  if (!location || !location.startsWith('https://www.googleapis.com/')) throw new Error('YouTube did not return a valid resumable-upload URL.');
  uploadAbort = new AbortController();
  const handle = await fs.promises.open(filePath, 'r');
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  let failures = 0;
  try {
    while (offset < stat.size) {
      const length = Math.min(chunkSize, stat.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error('The local MP4 ended unexpectedly during upload.');
      try {
        const response = await fetch(location, {
          method: 'PUT', signal: uploadAbort.signal,
          headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'video/mp4', 'Content-Length': String(bytesRead), 'Content-Range': `bytes ${offset}-${offset + bytesRead - 1}/${stat.size}` },
          body: buffer.subarray(0, bytesRead),
        });
        if (response.ok) {
          const data = await response.json() as any;
          if (!data.id) throw new Error('YouTube returned no video ID after upload.');
          onProgress(100);
          return `https://www.youtube.com/watch?v=${encodeURIComponent(data.id)}`;
        }
        if (response.status !== 308) {
          const error = await response.json().catch(() => ({})) as any;
          throw new Error(error.error?.message || `YouTube upload failed (${response.status})`);
        }
        const range = response.headers.get('range')?.match(/bytes=0-(\d+)/);
        offset = range ? Number(range[1]) + 1 : 0;
        failures = 0;
        onProgress(Math.floor(offset / stat.size * 100));
      } catch (error) {
        if (uploadAbort.signal.aborted) throw new Error('YouTube upload cancelled.');
        if (++failures > 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 800 * 2 ** failures));
        const status = await fetch(location, { method: 'PUT', headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Length': '0', 'Content-Range': `bytes */${stat.size}` } });
        if (status.status === 308) {
          const range = status.headers.get('range')?.match(/bytes=0-(\d+)/);
          offset = range ? Number(range[1]) + 1 : 0;
        } else if (status.ok) {
          const data = await status.json() as any;
          if (data.id) { onProgress(100); return `https://www.youtube.com/watch?v=${encodeURIComponent(data.id)}`; }
        }
      }
    }
    throw new Error('YouTube upload ended without a completion response.');
  } finally {
    await handle.close();
    uploadAbort = null;
  }
}
