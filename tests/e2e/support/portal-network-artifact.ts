import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface PortalNetworkObservedRequest {
  url: string;
  status: number;
  method: string;
  resourceType?: string;
}

export interface PortalNetworkConsoleEvent {
  type: 'error' | 'pageerror';
  text: string;
}

export interface PortalNetworkArtifactSummary {
  firestoreListenRequests: number;
  firestoreWriteRequests: number;
  firestoreListen400s: number;
  consoleErrors: number;
}

export interface PortalNetworkArtifact {
  suiteId: string;
  routeId: string;
  pathname: string;
  finalUrl: string;
  capturedAt: string;
  requests: PortalNetworkObservedRequest[];
  consoleErrors: PortalNetworkConsoleEvent[];
  summary: PortalNetworkArtifactSummary;
}

export interface PortalNetworkArtifactCapture {
  suiteId: string;
  routeId: string;
  pathname: string;
  artifactDir?: string;
}

export interface PortalNetworkArtifactWriteInput {
  artifactDir?: string;
  artifact: PortalNetworkArtifact;
}

export interface PortalNetworkArtifactRequestLike {
  url: string;
  status: number;
  method?: string;
  resourceType?: string;
}

export interface PortalNetworkArtifactSummaryInput {
  requests: Array<PortalNetworkArtifactRequestLike>;
  consoleErrors: Array<PortalNetworkConsoleEvent>;
}

function normalizePathSegment(value: string): string {
  const cleaned = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return cleaned.replace(/^-+|-+$/g, '') || 'unknown';
}

function isFirestoreListenUrl(url: string): boolean {
  const normalized = String(url || '').toLowerCase();
  return normalized.includes('firestore') && normalized.includes('/listen/');
}

function isFirestoreWriteUrl(url: string): boolean {
  const normalized = String(url || '').toLowerCase();
  return normalized.includes('firestore') && normalized.includes('/write/');
}

export function summarizePortalNetworkArtifact(input: PortalNetworkArtifactSummaryInput): PortalNetworkArtifactSummary {
  return {
    firestoreListenRequests: input.requests.filter((entry) => isFirestoreListenUrl(entry.url)).length,
    firestoreWriteRequests: input.requests.filter((entry) => isFirestoreWriteUrl(entry.url)).length,
    firestoreListen400s: input.requests.filter((entry) => isFirestoreListenUrl(entry.url) && Number(entry.status) === 400).length,
    consoleErrors: input.consoleErrors.length,
  };
}

export function resolvePortalNetworkArtifactPath(input: {
  artifactDir: string;
  suiteId: string;
  routeId: string;
}): string {
  return join(
    resolve(input.artifactDir),
    normalizePathSegment(input.suiteId),
    `${normalizePathSegment(input.routeId)}.json`,
  );
}

export function writePortalNetworkArtifact(input: PortalNetworkArtifactWriteInput): string {
  const artifactPath = resolvePortalNetworkArtifactPath({
    artifactDir: input.artifactDir || process.env.PORTAL_NETWORK_ARTIFACT_DIR || resolve('test-results/portal-network-artifacts'),
    suiteId: input.artifact.suiteId,
    routeId: input.artifact.routeId,
  });
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(input.artifact, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export async function recordPortalNetworkArtifact(
  page: {
    on: (event: 'response' | 'console' | 'pageerror', handler: (...args: any[]) => void) => void;
    off?: (event: 'response' | 'console' | 'pageerror', handler: (...args: any[]) => void) => void;
    url: () => string;
  },
  capture: PortalNetworkArtifactCapture,
  run: () => Promise<void> | void,
): Promise<PortalNetworkArtifact> {
  const requests: PortalNetworkObservedRequest[] = [];
  const consoleErrors: PortalNetworkConsoleEvent[] = [];

  const onResponse = (response: { url: () => string; status: () => number; request: () => { method: () => string; resourceType: () => string } }) => {
    const url = response.url();
    const normalized = url.toLowerCase();
    if (!normalized.includes('firestore') || (!normalized.includes('/listen/') && !normalized.includes('/write/'))) {
      return;
    }

    requests.push({
      url,
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
    });
  };

  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() !== 'error') return;
    consoleErrors.push({ type: 'error', text: message.text() });
  };

  const onPageError = (error: Error) => {
    consoleErrors.push({ type: 'pageerror', text: error.message });
  };

  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let capturedError: unknown = null;
  try {
    await run();
  } catch (error) {
    capturedError = error;
  } finally {
    page.off?.('response', onResponse);
    page.off?.('console', onConsole);
    page.off?.('pageerror', onPageError);
  }

  const artifact: PortalNetworkArtifact = {
    suiteId: capture.suiteId,
    routeId: capture.routeId,
    pathname: capture.pathname,
    finalUrl: page.url(),
    capturedAt: new Date().toISOString(),
    requests,
    consoleErrors,
    summary: summarizePortalNetworkArtifact({ requests, consoleErrors }),
  };

  writePortalNetworkArtifact({
    artifactDir: capture.artifactDir,
    artifact,
  });

  if (capturedError) {
    throw capturedError;
  }

  return artifact;
}
