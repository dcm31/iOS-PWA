# iOS PWA push notifications

**[Try the live demo](https://ios-pwa.charliemolthrop.workers.dev)** · **[Original Val Town source](./index.ts)**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dcm31/iOS-PWA)

A small installable web app that sends an encrypted Web Push notification to your own device. The live demo links back here; the button creates a copy in your own GitHub/Cloudflare account.

## Try it on your iPhone or iPad

1. Use **iOS/iPadOS 16.4 or later** and open the live demo in Safari.
2. Tap **Share → Add to Home Screen**.
3. Launch the app from its Home Screen icon.
4. Tap **Enable notifications**, then allow the permission prompt.
5. Enter a message and tap **Send test notification**. Check Notification Center and Focus settings if it is silent.

Compatible desktop browsers can also try the page directly. The demo supports Apple, Google/Chrome, and Mozilla/Firefox push endpoints. A successful send means the push service accepted it, not that the device displayed it.

## Deploy your own

Click **Deploy to Cloudflare** above, choose your repository and Worker name, and complete Cloudflare's deployment flow. Use the detected **`npm run deploy`** command. The root `cloudflare.config.ts` declares the Worker and SQLite-backed Durable Objects; `cf deploy` provisions them. No keys or storage IDs need to be copied from this demo.

For local development, use Node **24.22.1** (or a supported newer LTS release):

```sh
npm ci
npm run dev
```

For a command-line deployment:

```sh
npx cf auth login
npm run deploy
```

Choose your own Cloudflare account. The repository contains no account ID or credentials. Change `name` in `cloudflare.config.ts` if you want a different local deployment name; Workers Builds can override it when deploying a remix. Cloudflare's normal usage limits and charges apply.

## How the Workers version works

`src/worker.ts` serves the page, manifest, icons, service worker, and API. Each installation gets a random bearer token and its own Durable Object. The object generates a new VAPID keypair using Web Crypto and keeps the private key and subscription in its own storage. `@block65/webcrypto-web-push` 2.0.0 builds the encrypted `aes128gcm` payload and VAPID authentication accepted by Apple. The service worker displays the notification.

The token stays in that browser's local storage and authorizes only its own subscription. Session tokens are never placed in URLs, and the app does not log private keys, subscription details, or message contents. Data expires after 30 days; **Reset this device** removes the server-side session and browser subscription. Messages are encrypted for the device and are not persisted by the app. Cloudflare request logs and sampled traces are enabled; automatic telemetry can include request URLs, including push-provider endpoints.

Basic abuse controls include HTTPS push-provider allowlisting, blocked redirects, subscription key validation, same-origin POSTs, bounded request/message sizes, 30 API requests/minute and 5 new sessions/hour per IP, and a 10-second send cooldown per installation. Expired subscriptions are removed when a push service returns 404/410.

This remains a **public demo, not a production notification system**. The token is a capability, not a user account; anyone who obtains it can act on that installation. There is no identity verification, endpoint-ownership challenge, distributed bot defense, or delivery guarantee. Shared-IP limits can affect unrelated visitors. Do not use it for sensitive messages or expose a broadcast feature without additional controls.

## Original Val Town version

Root [`index.ts`](./index.ts) is the unchanged original from [`dcm31/iosPushNotify`](https://www.val.town/x/dcm31/iosPushNotify/code/index.ts). It is a reference file; the Workers build starts at `src/worker.ts`.

To run the original, remix that Val or copy `index.ts` into an HTTP val, then follow the Home Screen/permission steps above using its HTTPS endpoint. It uses Hono, `npm:web-push@3.6.7`, and Val Town blob storage. Its keys are generated at runtime. No original runtime blobs, subscriptions, or environment secrets were copied.

The original is less hardened: it has **no authentication or rate limiting, accepts unvalidated push endpoints, and serves placeholder icons**. It is retained as-is, not presented as production-ready.

## Verification

```sh
npm run check
```

Runs the build, TypeScript check, Workers-runtime tests, and independent payload-decryption/VAPID-signature checks. Runtime tests cover routes, origin/auth checks, oversized bodies, endpoint/key validation, separate sessions, durable state after eviction, expiry cleanup, send cooldowns, and mocked push-service responses.

No end-to-end notification delivery test on a physical iPhone has been performed. Local mocked delivery and HTTP smoke checks do not establish iOS delivery. The Deploy button and its build configuration are provided; the full new-account remix/sign-in flow has not been exercised.

References: [iOS Web Push](https://webkit.org/blog/13878/) · [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Cloudflare configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/) · [Web Push library](https://github.com/block65/webcrypto-web-push)
