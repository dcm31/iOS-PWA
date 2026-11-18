# iOS PWA push notifications

The original Val Town Web Push demo is preserved unchanged in [index.ts](./index.ts).

## Run the original on Val Town

1. Open the [original Val](https://www.val.town/x/dcm31/iosPushNotify/code/index.ts) and remix it into your own account, or copy `index.ts` into an HTTP val.
2. Open your deployed HTTPS endpoint in Safari on iOS/iPadOS 16.4 or later.
3. Use **Share → Add to Home Screen**, then launch it from the Home Screen.
4. Tap **Enable Notifications** and allow notification permission.
5. Enter a message and tap **Send Test Notification**. Check Notification Center and your Focus settings.

This version uses Hono, `npm:web-push@3.6.7`, and Val Town blob storage. It generates a VAPID keypair at runtime and stores subscriptions in blobs. No runtime keys, subscriptions, or environment secrets are included here.

## Demo limitations

The original source is a learning demo, not production-ready: it has no authentication or rate limiting, accepts unvalidated push endpoints, and serves placeholder icons. Do not expose it as a general notification service without hardening it.

The source has been checked for equality with the original Val. No end-to-end iOS notification delivery test has been performed for this publication.

A separate Cloudflare Workers adaptation, live demo, and Deploy to Cloudflare button are being prepared for this repository.

[iOS Web Push requirements](https://webkit.org/blog/13878/) · [Original source](https://www.val.town/x/dcm31/iosPushNotify/code/index.ts)
