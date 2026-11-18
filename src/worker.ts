import { DurableObject } from 'cloudflare:workers';
import { buildPushPayload, type PushSubscription, type VapidKeys } from '@block65/webcrypto-web-push';
import { base64url, HttpError, readJSON, validateEndpoint, validateSubscription } from './security';
import html from './index.html?raw';
import browserScript from './app.js?raw';
import serviceWorker from './service-worker.js?raw';
import { icons } from './icons';

const TTL = 30 * 24 * 60 * 60 * 1000;
type Session = { keys: Omit<VapidKeys, 'subject'>; expires: number; subscription?: PushSubscription; lastSend?: number };

// One object per browser installation. Keys never leave this object.
export class PushSession extends DurableObject<Env> {
  async initialize() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const session: Session = { keys: { publicKey, privateKey: jwk.d! }, expires: Date.now() + TTL };
    await this.ctx.storage.put('session', session);
    await this.ctx.storage.setAlarm(session.expires);
    return { publicKey, expires: session.expires };
  }

  private async session(): Promise<Session | undefined> {
    const value = await this.ctx.storage.get<Session>('session');
    return value && value.expires > Date.now() ? value : undefined;
  }

  async info() {
    const value = await this.session();
    return value ? { publicKey: value.keys.publicKey, expires: value.expires, subscribed: !!value.subscription } : null;
  }

  async subscribe(subscription: PushSubscription) {
    return this.ctx.storage.transaction(async txn => {
      const value = await txn.get<Session>('session');
      if (!value || value.expires <= Date.now()) return false;
      // Preserve keys and the send cooldown when re-subscribing.
      await txn.put('session', { ...value, subscription });
      return true;
    });
  }

  async send(message: string, subject: string) {
    // Storage transaction reserves the send slot before asynchronous crypto/network I/O.
    const reserved = await this.ctx.storage.transaction(async txn => {
      const session = await txn.get<Session>('session');
      if (!session || session.expires <= Date.now()) return { status: 410, error: 'Session expired. Enable notifications again.' };
      if (!session.subscription) return { status: 409, error: 'Enable notifications first.' };
      if (Date.now() - (session.lastSend || 0) < 10_000) return { status: 429, error: 'Wait 10 seconds between notifications.' };
      await txn.put('session', { ...session, lastSend: Date.now() });
      return { status: 200, session };
    });
    if (!reserved.session) return reserved;
    const { keys, subscription } = reserved.session;
    const endpoint = validateEndpoint(subscription!.endpoint);
    const payload = await buildPushPayload({
      data: JSON.stringify({ title: 'Hello from your PWA', body: message }),
      options: { ttl: 60, urgency: 'normal' },
    }, subscription!, { ...keys, subject });
    let response: Response;
    try {
      response = await fetch(endpoint, { ...payload, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Unknown transport error');
      // Do not log URLs, tokens, request headers, keys, or message contents.
      const detail = failure.message.replace(/https?:\/\/[^\s]+/g, '[URL]').replace(/[A-Za-z0-9_+\/=-]{32,}/g, '[redacted]').slice(0,240);
      console.error(JSON.stringify({ event: 'push_transport_failed', provider: new URL(endpoint).hostname, name: failure.name, detail }));
      return { status: 502, error: 'Could not reach the push service. Please try again.', code: failure.name === 'TimeoutError' ? 'push_timeout' : 'push_transport_failed' };
    }
    // Never return/log the provider body: it can contain endpoint identifiers.
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) return { status: 502, error: 'Push service returned a redirect, which was blocked.', code: 'push_redirect_blocked' };
    if (response.status === 404 || response.status === 410) {
      await this.ctx.storage.transaction(async txn => {
        const current = await txn.get<Session>('session');
        if (current?.subscription?.endpoint === endpoint) {
          delete current.subscription;
          await txn.put('session', current);
        }
      });
      return { status: 410, error: 'Push subscription expired. Enable notifications again.' };
    }
    if (!response.ok) return { status: 502, error: 'Push service rejected the notification.', pushStatus: response.status };
    return { status: 200, success: true, pushStatus: response.status };
  }

  async reset() { await this.ctx.storage.deleteAll(); }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

// Per-IP fixed-window counters; kept separate from private subscription state.
export class RequestLimit extends DurableObject<Env> {
  async allow(createSession: boolean) {
    const now = Date.now();
    const allowed = await this.ctx.storage.transaction(async txn => {
      const minuteKey = Math.floor(now / 60_000);
      const hourKey = Math.floor(now / 3_600_000);
      const saved = await txn.get<{ minute: number; requests: number; hour: number; sessions: number }>('limit');
      const next = { minute: minuteKey, requests: saved?.minute === minuteKey ? saved.requests : 0,
        hour: hourKey, sessions: saved?.hour === hourKey ? saved.sessions : 0 };
      if (next.requests >= 30 || (createSession && next.sessions >= 5)) return false;
      next.requests++;
      if (createSession) next.sessions++;
      await txn.put('limit', next);
      return true;
    });
    await this.ctx.storage.setAlarm(now + 3_600_000);
    return allowed;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

const manifest = (base: string) => ({
  id: base, name: 'iOS Push Demo', short_name: 'Push Demo', start_url: base, scope: base,
  display: 'standalone', background_color: '#faf9f6', theme_color: '#e56638',
  icons: [192, 512].map(size => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
});
const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#e56638"/><path d="M145 332h222l-26-38v-79a85 85 0 0 0-170 0v79z" fill="white"/><circle cx="256" cy="366" r="26" fill="white"/></svg>';

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  const prefix = '/ios-push-pwa-example';
  if (url.pathname === prefix && (request.method === 'GET' || request.method === 'HEAD')) {
    url.pathname += '/';
    return Response.redirect(url.href, 308);
  }
  const base = url.pathname.startsWith(prefix + '/') ? prefix + '/' : '/';
  const path = '/' + url.pathname.slice(base.length);
  const canonical = new URL(base, url.origin).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (request.method === 'GET') {
    if (Object.hasOwn(icons, path)) return new Response(Uint8Array.from(atob(icons[path]), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
    if (path === '/') return new Response(html.replaceAll('__APP_BASE__', base).replaceAll('__CANONICAL_URL__', canonical), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (path === '/app.js') return new Response(browserScript, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    if (path === '/service-worker.js') return new Response(serviceWorker, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': base } });
    if (path === '/manifest.json') return Response.json(manifest(base), { headers: { 'Content-Type': 'application/manifest+json' } });
    if (path === '/icon.svg') return new Response(icon, { headers: { 'Content-Type': 'image/svg+xml' } });
    if (path === '/health') return Response.json({ ok: true });
  }
  if (!['/api/session', '/api/subscribe', '/api/send', '/api/reset'].includes(path)) throw new HttpError(404, 'Not found');
  if (request.method !== 'POST') throw new HttpError(405, 'Use POST');
  if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'Same-origin requests required');
  const body = await readJSON(request);
  const create = path === '/api/session' && !request.headers.has('authorization');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const ipHash = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))));
  if (!await env.REQUEST_LIMIT.getByName(ipHash).allow(create)) throw new HttpError(429, 'Too many requests. Please try later.');
  if (create) {
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const info = await env.PUSH_SESSION.getByName(token).initialize();
    return Response.json({ token, ...info, subscribed: false }, { status: 201 });
  }
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new HttpError(401, 'Session token required');
  const session = env.PUSH_SESSION.getByName(token);
  if (path === '/api/session') {
    const info = await session.info();
    if (!info) throw new HttpError(410, 'Session expired. Enable notifications again.');
    return Response.json(info);
  }
  if (path === '/api/subscribe') {
    const subscription = await validateSubscription(body.subscription);
    if (!await session.subscribe(subscription)) throw new HttpError(410, 'Session expired. Enable notifications again.');
    return Response.json({ success: true });
  }
  if (path === '/api/reset') { await session.reset(); return Response.json({ success: true }); }
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 140) throw new HttpError(400, 'Enter a message of 1–140 characters');
  const result = await session.send(body.message.trim(), url.origin);
  return Response.json(result, { status: result.status });
}

export default {
  async fetch(request, env) {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error(JSON.stringify({ event: 'request_failed' }));
      response = Response.json({ error: known ? error.message : 'Something went wrong. Please try again.' }, { status: known ? error.status : 500 });
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
