// Independently decrypt the library output and verify its VAPID signature.
// This is a local synthetic subscription, never a real browser endpoint.
import { strict as assert } from 'node:assert';
import { createECDH, randomBytes, createPublicKey, verify } from 'node:crypto';
import ece from 'http_ece';
import { buildPushPayload } from '@block65/webcrypto-web-push';

const browser = createECDH('prime256v1'); browser.generateKeys();
const server = createECDH('prime256v1'); server.generateKeys();
const auth = randomBytes(16);
const endpoint = 'https://web.push.apple.com/synthetic-test';
const message = JSON.stringify({ title: 'Test', body: 'Encrypted hello 🔔' });
const payload = await buildPushPayload({ data: message, options: { ttl: 60 } }, {
  endpoint, expirationTime: null,
  keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
}, { subject: 'https://example.com', publicKey: server.getPublicKey().toString('base64url'), privateKey: server.getPrivateKey().toString('base64url') });
const plaintext = ece.decrypt(Buffer.from(payload.body), {
  version: 'aes128gcm', privateKey: browser, authSecret: auth,
});
assert.equal(plaintext.toString(), message);
const header = new Headers(payload.headers).get('authorization');
const jwt = header.match(/^vapid t=([^,]+), k=/)[1];
const [head, body, signature] = jwt.split('.');
const pub = server.getPublicKey();
const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1,33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
assert(verify('sha256', Buffer.from(head+'.'+body), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature,'base64url')));
assert.equal(JSON.parse(Buffer.from(body,'base64url')).aud, new URL(endpoint).origin);
console.log('Independent payload decryption and VAPID signature verification passed.');
