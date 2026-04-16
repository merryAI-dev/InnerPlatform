import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PORTAL_NETWORK_GATE_COMMANDS,
  PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS,
  formatPortalNetworkGateSummary,
  evaluatePortalNetworkGate,
  preparePortalNetworkArtifactDir,
  readPortalNetworkArtifacts,
  runPortalNetworkGateCommand,
} from '../../../scripts/portal_network_gate';

describe('readPortalNetworkArtifacts', () => {
  it('reads nested route artifact files and normalizes summary metrics', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'portal-network-gate-'));
    const suiteDir = join(artifactDir, 'platform-smoke');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(join(suiteDir, 'portal-weekly-expenses.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'portal-weekly-expenses',
      pathname: '/portal/weekly-expenses',
      finalUrl: 'http://localhost:4173/portal/weekly-expenses',
      capturedAt: '2026-04-16T00:00:00.000Z',
      summary: {
        firestoreListenRequests: 0,
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    expect(readPortalNetworkArtifacts(artifactDir)).toEqual([
      expect.objectContaining({
        suiteId: 'platform-smoke',
        routeId: 'portal-weekly-expenses',
        pathname: '/portal/weekly-expenses',
        observed: {
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      }),
    ]);
  });

  it('fails closed when an artifact metric is malformed', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'portal-network-gate-invalid-'));
    const suiteDir = join(artifactDir, 'platform-smoke');
    mkdirSync(suiteDir, { recursive: true });
    writeFileSync(join(suiteDir, 'portal-dashboard.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'portal-dashboard',
      pathname: '/portal',
      summary: {
        firestoreListenRequests: 'oops',
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    expect(() => readPortalNetworkArtifacts(artifactDir)).toThrow(/invalid artifact metric/i);
  });

  it('fails closed when required artifact metrics are omitted or null', () => {
    const omittedDir = mkdtempSync(join(tmpdir(), 'portal-network-gate-omitted-'));
    const omittedSuiteDir = join(omittedDir, 'platform-smoke');
    mkdirSync(omittedSuiteDir, { recursive: true });
    writeFileSync(join(omittedSuiteDir, 'portal-dashboard.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'portal-dashboard',
      pathname: '/portal',
      summary: {
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    const nullDir = mkdtempSync(join(tmpdir(), 'portal-network-gate-null-'));
    const nullSuiteDir = join(nullDir, 'platform-smoke');
    mkdirSync(nullSuiteDir, { recursive: true });
    writeFileSync(join(nullSuiteDir, 'portal-dashboard.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'portal-dashboard',
      pathname: '/portal',
      summary: {
        firestoreListenRequests: null,
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    expect(() => readPortalNetworkArtifacts(omittedDir)).toThrow(/missing artifact metric/i);
    expect(() => readPortalNetworkArtifacts(nullDir)).toThrow(/missing artifact metric/i);
  });
});

describe('preparePortalNetworkArtifactDir', () => {
  it('cleans an explicit artifact directory before a run', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'portal-network-gate-explicit-'));
    writeFileSync(join(artifactDir, 'stale.json'), '{"stale":true}');

    const preparedDir = preparePortalNetworkArtifactDir({
      artifactDir,
    });

    expect(preparedDir).toBe(resolve(artifactDir));
    expect(existsSync(join(preparedDir, 'stale.json'))).toBe(false);
  });

  it('creates a unique run-scoped directory when using an artifact root', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'portal-network-gate-root-'));
    const firstDir = preparePortalNetworkArtifactDir({ artifactRoot });
    const secondDir = preparePortalNetworkArtifactDir({ artifactRoot });

    expect(firstDir.startsWith(resolve(artifactRoot))).toBe(true);
    expect(secondDir.startsWith(resolve(artifactRoot))).toBe(true);
    expect(firstDir).not.toBe(secondDir);
  });
});

describe('runPortalNetworkGateCommand', () => {
  it('fails deterministically when child process startup errors', async () => {
    const fakeChild = new EventEmitter() as EventEmitter;

    const outcome = await runPortalNetworkGateCommand({
      label: 'unit-contract',
      command: 'npm test -- fake-suite',
      cwd: process.cwd(),
      artifactDir: mkdtempSync(join(tmpdir(), 'portal-network-gate-command-')),
      spawnImpl: () => {
        queueMicrotask(() => {
          fakeChild.emit('error', new Error('spawn failed'));
        });
        return fakeChild as never;
      },
    });

    expect(outcome).toMatchObject({
      label: 'unit-contract',
      command: 'npm test -- fake-suite',
      exitCode: 1,
      passed: false,
    });
    expect(outcome.errorMessage).toContain('spawn failed');
  });
});

describe('evaluatePortalNetworkGate', () => {
  it('isolates the run artifact directory and ignores stale artifacts outside the run scope', () => {
    const artifactRoot = mkdtempSync(join(tmpdir(), 'portal-network-gate-run-'));
    const staleDir = join(artifactRoot, 'stale-artifacts');
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'portal-dashboard.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'portal-dashboard',
      pathname: '/portal',
      summary: {
        firestoreListenRequests: 99,
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    const runDir = preparePortalNetworkArtifactDir({
      artifactRoot,
    });

    const runSuiteDir = join(runDir, 'platform-smoke');
    mkdirSync(runSuiteDir, { recursive: true });

    for (const routeId of PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS) {
      const pathname = {
        'portal-dashboard': '/portal',
        'portal-submissions': '/portal/submissions',
        'portal-weekly-expenses': '/portal/weekly-expenses',
        'portal-bank-statements': '/portal/bank-statements',
        'portal-payroll': '/portal/payroll',
      }[routeId];

      writeFileSync(join(runSuiteDir, `${routeId}.json`), JSON.stringify({
        suiteId: 'platform-smoke',
        routeId,
        pathname,
        finalUrl: `http://localhost:4173${pathname}`,
        capturedAt: '2026-04-16T00:00:00.000Z',
        summary: {
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      }));
    }

    writeFileSync(join(runSuiteDir, 'admin-404.json'), JSON.stringify({
      suiteId: 'platform-smoke',
      routeId: 'admin-404',
      pathname: '/admin/404',
      finalUrl: 'http://localhost:4173/admin/404',
      capturedAt: '2026-04-16T00:00:00.000Z',
      summary: {
        firestoreListenRequests: 0,
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      },
    }));

    const staleArtifacts = readPortalNetworkArtifacts(staleDir);
    const artifacts = readPortalNetworkArtifacts(runDir);
    const result = evaluatePortalNetworkGate({
      artifacts,
      commandResults: [
        {
          label: 'unit-contract',
          command: 'npm test -- some-suite',
          exitCode: 0,
          passed: true,
          durationMs: 1,
        },
      ],
      artifactDir: runDir,
    });

    expect(result.passed).toBe(true);
    expect(result.artifactDir.startsWith(resolve(artifactRoot))).toBe(true);
    expect(result.summary.totalArtifacts).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length + 1);
    expect(result.summary.requiredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.coveredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.missingRequiredRouteCount).toBe(0);
    expect(result.summary.skippedArtifactCount).toBe(1);
    expect(result.skippedArtifacts).toEqual([
      expect.objectContaining({
        routeId: 'admin-404',
        reason: 'unknown-route-budget',
      }),
    ]);
    expect(staleArtifacts).toEqual([
      expect.objectContaining({
        routeId: 'portal-dashboard',
        observed: {
          firestoreListenRequests: 99,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      }),
    ]);
  });
});

describe('evaluatePortalNetworkGate', () => {
  it('expands the default unit-contract command to the phase1 suite plus phase0 contract coverage', () => {
    expect(PORTAL_NETWORK_GATE_COMMANDS.unitContract).toBe(
      'npm test -- src/app/platform/dev-harness-portal-api.test.ts src/app/platform/harness-stability.contract.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalOnboarding.shell.test.ts src/app/lib/platform-bff-client.test.ts src/app/components/portal/PortalDashboard.layout.test.ts src/app/platform/check-patch-notes-guard.test.ts server/bff/routes/portal-entry.test.mjs server/bff/routes/portal-read-model.test.mjs src/app/platform/portal-dashboard-surface.test.ts src/app/platform/portal-network-budgets.test.ts src/app/platform/portal-network-gate.test.ts',
    );
  });

  it('references only existing files in the default unit-contract command', () => {
    const filePaths = PORTAL_NETWORK_GATE_COMMANDS.unitContract
      .split(' -- ')[1]
      ?.split(/\s+/)
      .filter(Boolean) ?? [];

    expect(filePaths.length).toBeGreaterThan(0);
    expect(filePaths.every((filePath) => existsSync(resolve(import.meta.dirname, '../../../', filePath)))).toBe(true);
  });

  it('fails when a route artifact violates its budget', () => {
    const result = evaluatePortalNetworkGate({
      artifacts: [
        {
          routeId: 'portal-dashboard',
          pathname: '/portal',
          firestoreListenRequests: 1,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-submissions',
          pathname: '/portal/submissions',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-weekly-expenses',
          pathname: '/portal/weekly-expenses',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-bank-statements',
          pathname: '/portal/bank-statements',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-payroll',
          pathname: '/portal/payroll',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      ],
      commandResults: [],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.failedCount).toBe(1);
    expect(result.routes[0]?.evaluation.failures).toContain('firestoreListenRequests');
  });

  it('fails when a required gate command fails even if budgets pass', () => {
    const result = evaluatePortalNetworkGate({
      artifacts: PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.map((routeId) => ({
        routeId,
        pathname: {
          'portal-dashboard': '/portal',
          'portal-submissions': '/portal/submissions',
          'portal-weekly-expenses': '/portal/weekly-expenses',
          'portal-bank-statements': '/portal/bank-statements',
          'portal-payroll': '/portal/payroll',
        }[routeId],
        firestoreListenRequests: 0,
        firestoreWriteRequests: 0,
        firestoreListen400s: 0,
        consoleErrors: 0,
      })),
      commandResults: [
        {
          label: 'unit-contract',
          command: 'npm test -- some-suite',
          exitCode: 1,
          passed: false,
          durationMs: 250,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.commandFailureCount).toBe(1);
    expect(result.summary.failedCount).toBe(1);
  });

  it('fails when required stable portal route coverage is incomplete', () => {
    const result = evaluatePortalNetworkGate({
      artifacts: [
        {
          routeId: 'portal-weekly-expenses',
          pathname: '/portal/weekly-expenses',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      ],
      commandResults: [],
    });

    expect(result.summary.missingRequiredRouteIds).toEqual(
      expect.arrayContaining([
        'portal-dashboard',
        'portal-submissions',
        'portal-bank-statements',
        'portal-payroll',
      ]),
    );
    expect(result.passed).toBe(false);
    expect(result.summary.requiredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.coveredRouteCount).toBe(1);
    expect(result.summary.missingRequiredRouteCount).toBe(
      PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length - 1,
    );
    expect(result.summary.missingRequiredRouteIds).toContain('portal-payroll');
  });

  it('fails when no required stable portal route coverage is present', () => {
    const result = evaluatePortalNetworkGate({
      artifacts: [],
      commandResults: [],
    });

    expect(result.passed).toBe(false);
    expect(result.summary.requiredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.coveredRouteCount).toBe(0);
    expect(result.summary.missingRequiredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.missingRequiredRouteIds).toEqual(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS);
  });

  it('passes when commands and the full stable route set stay within budget', () => {
    const result = evaluatePortalNetworkGate({
      artifacts: [
        {
          routeId: 'portal-dashboard',
          pathname: '/portal',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-submissions',
          pathname: '/portal/submissions',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-weekly-expenses',
          pathname: '/portal/weekly-expenses',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-bank-statements',
          pathname: '/portal/bank-statements',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
        {
          routeId: 'portal-payroll',
          pathname: '/portal/payroll',
          firestoreListenRequests: 0,
          firestoreWriteRequests: 0,
          firestoreListen400s: 0,
          consoleErrors: 0,
        },
      ],
      commandResults: [
        {
          label: 'unit-contract',
          command: 'npm test -- some-suite',
          exitCode: 0,
          passed: true,
          durationMs: 250,
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.summary.failedCount).toBe(0);
    expect(result.summary.passedCount).toBe(5);
    expect(result.summary.requiredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.coveredRouteCount).toBe(PORTAL_NETWORK_GATE_REQUIRED_ROUTE_IDS.length);
    expect(result.summary.missingRequiredRouteCount).toBe(0);

    const summary = formatPortalNetworkGateSummary(result);
    expect(summary).toContain('Coverage: 5/5 required routes covered, 0 missing');
    expect(summary).not.toContain('undefined');
  });
});
