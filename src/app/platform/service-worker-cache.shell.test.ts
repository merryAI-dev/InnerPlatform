import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceWorkerSource = readFileSync(resolve(import.meta.dirname, '../../../public/sw.js'), 'utf8');

describe('service worker cache policy', () => {
  it('does not cache hashed Vite assets ahead of the network', () => {
    expect(serviceWorkerSource).not.toContain("'/assets/'");
    expect(serviceWorkerSource).toContain("const CACHEABLE_PREFIXES = ['/brand/'];");
  });
});
