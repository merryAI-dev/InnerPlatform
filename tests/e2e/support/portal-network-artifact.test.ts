import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolvePortalNetworkArtifactPath,
  summarizePortalNetworkArtifact,
  writePortalNetworkArtifact,
} from './portal-network-artifact';

describe('summarizePortalNetworkArtifact', () => {
  it('counts firestore listen, write, 400, and console error events', () => {
    const summary = summarizePortalNetworkArtifact({
      requests: [
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', status: 200 },
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel', status: 200 },
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', status: 400 },
        { url: 'https://example.com/api', status: 500 },
      ],
      consoleErrors: [
        { type: 'error', text: 'boom' },
        { type: 'error', text: 'kaboom' },
      ],
    });

    expect(summary).toMatchObject({
      firestoreListenRequests: 2,
      firestoreWriteRequests: 1,
      firestoreListen400s: 1,
      consoleErrors: 2,
    });
  });
});

describe('portal network artifact file output', () => {
  it('keeps the Playwright harness on localhost origin and preserves artifact dir support', () => {
    const configSource = readFileSync(new URL('../../../playwright.harness.config.mjs', import.meta.url), 'utf8');

    expect(configSource).toContain("const DEFAULT_PORTAL_HOST = 'localhost';");
    expect(configSource).toContain("const DEFAULT_PORTAL_PORT = '4173';");
    expect(configSource).toContain('const PORTAL_HOST = process.env.PORTAL_HARNESS_HOST || DEFAULT_PORTAL_HOST;');
    expect(configSource).toContain('const PORTAL_PORT = process.env.PORTAL_HARNESS_PORT || DEFAULT_PORTAL_PORT;');
    expect(configSource).toContain('process.env.PORTAL_NETWORK_ARTIFACT_DIR ||= path.resolve');
    expect(configSource).not.toContain('127.0.0.1');
  });

  it('resolves a stable route-level artifact path', () => {
    const artifactDir = join('/tmp', 'portal-network-artifacts');
    expect(
      resolvePortalNetworkArtifactPath({
        artifactDir,
        suiteId: 'platform-smoke',
        routeId: 'portal-dashboard',
      }),
    ).toBe('/tmp/portal-network-artifacts/platform-smoke/portal-dashboard.json');
  });

  it('writes the artifact JSON to the resolved stable path', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'portal-network-artifact-'));
    const artifactPath = writePortalNetworkArtifact({
      artifactDir,
      artifact: {
        suiteId: 'product-release-gates',
        routeId: 'portal-budget',
        pathname: '/portal/budget',
        finalUrl: 'http://localhost:4173/portal/budget',
        capturedAt: '2026-04-16T00:00:00.000Z',
        summary: {
          firestoreListenRequests: 0,
          firestoreWriteRequests: 1,
          firestoreListen400s: 0,
          consoleErrors: 1,
        },
        requests: [
          { url: 'https://example.com/api', status: 200 },
        ],
        consoleErrors: [
          { type: 'error', text: 'boom' },
        ],
      },
    });

    expect(artifactPath).toBe(
      resolvePortalNetworkArtifactPath({
        artifactDir,
        suiteId: 'product-release-gates',
        routeId: 'portal-budget',
      }),
    );

    const payload = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      suiteId: string;
      routeId: string;
      pathname: string;
      summary: Record<string, number>;
    };
    expect(payload).toMatchObject({
      suiteId: 'product-release-gates',
      routeId: 'portal-budget',
      pathname: '/portal/budget',
    });
    expect(payload.summary).toMatchObject({
      firestoreListenRequests: 0,
      firestoreWriteRequests: 1,
      firestoreListen400s: 0,
      consoleErrors: 1,
    });
  });
});
