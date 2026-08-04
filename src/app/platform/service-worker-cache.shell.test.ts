import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceWorkerSource = readFileSync(resolve(import.meta.dirname, '../../../public/sw.js'), 'utf8');
const mainSource = readFileSync(resolve(import.meta.dirname, '../../main.tsx'), 'utf8');
const vercelConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../vercel.json'), 'utf8'),
) as { headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }> };

describe('service worker cache policy', () => {
  it('does not cache hashed Vite assets ahead of the network', () => {
    expect(serviceWorkerSource).not.toContain("'/assets/'");
    expect(serviceWorkerSource).toContain("const CACHEABLE_PREFIXES = ['/brand/'];");
  });

  it('retires legacy asset caches and bypasses HTTP cache for worker updates', () => {
    expect(serviceWorkerSource).toContain("const CACHE_NAME = 'myscube-shell-v3';");
    expect(mainSource).toContain("navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })");
  });

  it('serves the worker without CDN or browser caching', () => {
    const workerHeaders = vercelConfig.headers?.find(({ source }) => source === '/sw.js')?.headers;

    expect(workerHeaders).toContainEqual({
      key: 'Cache-Control',
      value: 'no-store, max-age=0, must-revalidate',
    });
  });
});
