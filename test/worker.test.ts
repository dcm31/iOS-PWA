import { env, exports } from 'cloudflare:workers';
import { reset, runDurableObjectAlarm, evictDurableObject } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { base64url } from '../src/security';

const origin = 'https://demo.example';
const post = (path: string, body: unknown = {}, token?: string, ip = '192.0.2.1') => exports.default.fetch(origin + '/api/' + path, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
    ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body),
});
const create = async () => {
  const res = await post('session');
  expect(res.status).toBe(201);
  return await res.json() as { token: string; publicKey: string; expires: number };
};
const subscription = async (endpoint = 'https://web.push.apple.com/test') => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { endpoint, expirationTime: null, keys: {
    p256dh: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  } };
};
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

it('serves the app, source/remix links, manifest and service worker', async () => {
  const response = await exports.default.fetch(origin);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
  const html = await response.text();
  expect(html).toContain('https://github.com/dcm31/iOS-PWA');
  expect(html).toContain('https://deploy.workers.cloudflare.com/?url=https://github.com/dcm31/iOS-PWA');
  expect((await (await exports.default.fetch(origin + '/manifest.json')).json()).display).toBe('standalone');
  expect(await (await exports.default.fetch(origin + '/service-worker.js')).text()).toContain('showNotification');
  expect((await exports.default.fetch(origin + '/missing')).status).toBe(404);
});

it('requires same-origin POST, JSON, bounded bodies and session authorization', async () => {
  expect((await exports.default.fetch(origin + '/api/session')).status).toBe(405);
  expect((await exports.default.fetch(origin + '/api/session', { method: 'POST' })).status).toBe(403);
  expect((await exports.default.fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin } })).status).toBe(415);
  expect((await exports.default.fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
  expect((await post('session', { padding: 'a'.repeat(5000) })).status).toBe(413);
  expect((await post('send', { message: 'hello' })).status).toBe(401);
});

it('isolates sessions, persists keys across eviction, and removes expired data', async () => {
  const a = await create(), b = await create();
  expect(a.token).not.toBe(b.token);
  expect(a.publicKey).not.toBe(b.publicKey);
  expect(JSON.stringify(a)).not.toContain('privateKey');
  await post('subscribe', { subscription: await subscription() }, a.token);
  const stub = env.PUSH_SESSION.getByName(a.token);
  await evictDurableObject(stub);
  const info = await (await post('session', {}, a.token)).json();
  expect(info.publicKey).toBe(a.publicKey);
  expect(info.subscribed).toBe(true);
  expect((await post('send', { message: 'hello' }, b.token)).status).toBe(409);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect((await post('session', {}, a.token)).status).toBe(410);
});

it.each(['https://example.com/push', 'http://web.push.apple.com/test', 'https://web.push.apple.com.evil.test/push',
  'https://user:password@web.push.apple.com/test', 'https://web.push.apple.com:444/test', 'https://127.0.0.1/push', 'https://fcm.googleapis.com/anything'])('rejects arbitrary endpoint %s', async endpoint => {
  const { token } = await create();
  expect((await post('subscribe', { subscription: await subscription(endpoint) }, token)).status).toBe(400);
});

it('validates keys and messages', async () => {
  const { token } = await create();
  expect((await post('subscribe', { subscription: { endpoint: 'https://web.push.apple.com/test', keys: { auth: 'bad', p256dh: 'bad' } } }, token)).status).toBe(400);
  expect((await post('send', { message: 'a'.repeat(141) }, token)).status).toBe(400);
});

it('sends an encrypted VAPID request and rejects concurrent duplicate sends', async () => {
  const { token } = await create();
  expect((await post('subscribe', { subscription: await subscription() }, token)).status).toBe(200);
  const outgoing = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const nativeRequest = new Request(input, init);
    expect(nativeRequest.url).toBe('https://web.push.apple.com/test');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toMatch(/^vapid t=.+, k=/);
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(new Uint8Array(init!.body as ArrayBuffer).byteLength).toBe(4096);
    expect(nativeRequest.redirect).toBe('manual');
    return new Response(null, { status: 201 });
  });
  const responses = await Promise.all([post('send', { message: 'hello' }, token), post('send', { message: 'hello' }, token)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 429]);
  expect(outgoing).toHaveBeenCalledTimes(1);
});

it('prunes expired push subscriptions and can reset a device', async () => {
  const { token } = await create();
  await post('subscribe', { subscription: await subscription() }, token);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));
  expect((await post('send', { message: 'hello' }, token)).status).toBe(410);
  expect((await (await post('session', {}, token)).json()).subscribed).toBe(false);
  expect((await post('reset', {}, token)).status).toBe(200);
  expect((await post('session', {}, token)).status).toBe(410);
});

it('limits session creation per IP', async () => {
  for (let n = 0; n < 5; n++) expect((await post('session')).status).toBe(201);
  expect((await post('session')).status).toBe(429);
  expect((await post('session', {}, undefined, '192.0.2.2')).status).toBe(201);
});


it('keeps the subpath PWA, assets, API, and SEO inside its own scope', async () => {
  const base = '/ios-push-pwa-example/';
  const redirect = await exports.default.fetch(origin + base.slice(0, -1), { redirect: 'manual' });
  expect(redirect.status).toBe(308);
  expect(redirect.headers.get('location')).toBe(origin + base);
  const html = await (await exports.default.fetch(origin + base)).text();
  expect(html).toContain('data-base="' + base + '"');
  expect(html).toContain('href="' + base + 'manifest.json"');
  expect(html).toContain('src="' + base + 'app.js"');
  expect(html).toContain('rel="canonical" href="' + origin + base + '"');
  expect(html).toContain('name="description"');
  expect(html).toContain('property="og:image" content="' + origin + base + 'icon-512.png"');
  expect(html).not.toContain('__APP_BASE__');
  const manifest = await (await exports.default.fetch(origin + base + 'manifest.json')).json();
  expect(manifest.scope).toBe(base);
  expect(manifest.start_url).toBe(base);
  expect(manifest.id).toBe(base);
  expect(manifest.icons[0].src).toBe(base + 'icon-192.png');
  const sw = await exports.default.fetch(origin + base + 'service-worker.js');
  expect(sw.headers.get('service-worker-allowed')).toBe(base);
  expect(await sw.text()).toContain('self.registration.scope');
  for (const asset of ['app.js', 'icon-192.png', 'icon-512.png', 'icon.svg', 'health']) {
    expect((await exports.default.fetch(origin + base + asset)).status).toBe(200);
  }
  expect((await exports.default.fetch(origin + '/ios-push-pwa-example-other/')).status).toBe(404);
  const response = await exports.default.fetch(origin + base + 'api/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(201);
  const info = await response.json();
  expect(info.publicKey).toBeTruthy();
  expect(info.privateKey).toBeUndefined();
});


it('blocks push redirects without following them or forwarding credentials', async () => {
  const { token } = await create();
  await post('subscribe', { subscription: await subscription() }, token);
  const outgoing = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(new Request(input, init).redirect).toBe('manual');
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/collect' } });
  });
  const response = await post('send', { message: 'hello' }, token);
  expect(response.status).toBe(502);
  expect((await response.json()).code).toBe('push_redirect_blocked');
  expect(outgoing).toHaveBeenCalledTimes(1);
});
