// Narrow Val Town adapter used by dcm31/personal-site. No DNS changes needed.
const SITE_ORIGIN = 'https://charliemolthrop.com';
const VAL_ORIGIN = 'https://dcm31--622d318cce4c11f0862b42dde27851f2.web.val.run';
const WORKER_ORIGIN = 'https://ios-pwa.charliemolthrop.workers.dev';
const PREFIX = '/ios-push-pwa-example';

export default async function proxyPushDemo(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const localError = (message: string, status: number) => Response.json({ error: message }, {
    status, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': SITE_ORIGIN },
  });
  if (incoming.pathname !== PREFIX && !incoming.pathname.startsWith(PREFIX + '/')) return localError('Not found', 404);
  // Validate the browser's original Origin before adapting it for the upstream.
  // Never trust client-supplied forwarding headers to establish identity/origin.
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (origin !== SITE_ORIGIN && origin !== VAL_ORIGIN) return localError('Same-origin requests required', 403);
  }
  const target = new URL(WORKER_ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers({ 'Accept-Encoding': 'identity' });
  for (const name of ['Accept', 'Authorization', 'Content-Type']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!['GET', 'HEAD'].includes(request.method)) headers.set('Origin', WORKER_ORIGIN);
  // No cookies or spoofable IP headers cross this boundary. Worker IP limits
  // consequently apply to the Val proxy's egress address, shared by visitors.
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return localError('The demo is temporarily unavailable. Please try again.', 502);
  }
  const responseHeaders = new Headers(upstream.headers);
  // Setting a CORS header suppresses Val Town's default wildcard CORS headers.
  responseHeaders.set('Access-Control-Allow-Origin', SITE_ORIGIN);
  responseHeaders.set('Cache-Control', 'no-store');
  const location = responseHeaders.get('Location');
  if (location) {
    const redirect = new URL(location, target);
    if (redirect.origin !== WORKER_ORIGIN || (redirect.pathname !== PREFIX && !redirect.pathname.startsWith(PREFIX + '/'))) {
      await upstream.body?.cancel();
      return localError('Unexpected upstream redirect blocked', 502);
    }
    responseHeaders.set('Location', SITE_ORIGIN + redirect.pathname + redirect.search + redirect.hash);
  }
  if (request.method !== 'HEAD' && responseHeaders.get('Content-Type')?.includes('text/html')) {
    const html = (await upstream.text()).replaceAll(WORKER_ORIGIN, SITE_ORIGIN);
    responseHeaders.delete('Content-Length');
    responseHeaders.delete('Content-Encoding');
    return new Response(html, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
