import type { PushSubscription } from '@block65/webcrypto-web-push';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeKey(value: unknown, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new HttpError(400, 'Invalid subscription key');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  catch { throw new HttpError(400, 'Invalid subscription key'); }
  if (bytes.length !== length) throw new HttpError(400, 'Invalid subscription key length');
  return bytes;
}

export function validateEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, 'Invalid push endpoint');
  let u: URL;
  try { u = new URL(value); } catch { throw new HttpError(400, 'Invalid push endpoint'); }
  const apple = /^(?:[a-z0-9-]+\.)*push\.apple\.com$/.test(u.hostname) && u.pathname.startsWith('/');
  const google = u.hostname === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\//.test(u.pathname);
  const mozilla = u.hostname === 'updates.push.services.mozilla.com' && u.pathname.startsWith('/wpush/v2/');
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || !(apple || google || mozilla)) {
    throw new HttpError(400, 'Only Apple, Google, and Mozilla HTTPS push endpoints are supported');
  }
  return u.href;
}

export async function validateSubscription(value: unknown): Promise<PushSubscription> {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'Invalid subscription');
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = validateEndpoint(v.endpoint);
  const point = decodeKey(v.keys?.p256dh, 65);
  decodeKey(v.keys?.auth, 16);
  if (point[0] !== 4) throw new HttpError(400, 'Invalid subscription public key');
  try { await crypto.subtle.importKey('raw', point, { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
  catch { throw new HttpError(400, 'Invalid subscription public key'); }
  return { endpoint, expirationTime: null, keys: { p256dh: v.keys!.p256dh as string, auth: v.keys!.auth as string } };
}

export async function readJSON(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  if (Number(request.headers.get('content-length')) > 4096) throw new HttpError(413, 'Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'JSON body required');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4096) { await reader.cancel(); throw new HttpError(413, 'Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Invalid JSON object'); }
}
