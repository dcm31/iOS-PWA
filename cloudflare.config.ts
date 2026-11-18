import { bindings, defineConfig, defineWorker, exports } from 'cf/config';
import process from 'node:process';
import * as entrypoint from './src/worker.ts' with { type: 'cf-worker' };

// Workers Builds supplies this when a remix chooses a different Worker name.
const name = process.env.WRANGLER_CI_OVERRIDE_NAME || 'ios-pwa';

const worker = defineWorker({
    name,
    entrypoint,
    compatibilityDate: '2026-11-18',
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: true,
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
    exports: {
      PushSession: exports.durableObject({ storage: 'sqlite' }),
      RequestLimit: exports.durableObject({ storage: 'sqlite' }),
    },
});

export default defineConfig({
  worker: {
    ...worker,
    env: {
      PUSH_SESSION: bindings.durableObject<typeof worker, 'PushSession'>({ worker, exportName: 'PushSession' }),
      REQUEST_LIMIT: bindings.durableObject<typeof worker, 'RequestLimit'>({ worker, exportName: 'RequestLimit' }),
    },
  },
});
