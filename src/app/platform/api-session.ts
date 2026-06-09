import { parseFeatureFlag } from '../config/feature-flags';
import { normalizePlatformApiBaseUrl } from './platform-api-base-url';
import { createRequestId } from './request-context';

function readSessionRuntimeConfig(env: Record<string, unknown> = import.meta.env) {
  const enabled = parseFeatureFlag(env.VITE_PLATFORM_API_ENABLED, parseFeatureFlag(env.PROD, false));
  const isProductionBuild = parseFeatureFlag(env.PROD, false);
  return {
    enabled,
    baseUrl: normalizePlatformApiBaseUrl(env.VITE_PLATFORM_API_BASE_URL, {
      requireConfigured: enabled && isProductionBuild,
      rejectBrowserRewriteHosts: enabled && isProductionBuild,
      errorPrefix: 'VITE_PLATFORM_API_BASE_URL',
    }),
  };
}

async function postSession(path: string, body: unknown, env: Record<string, unknown> = import.meta.env): Promise<void> {
  const config = readSessionRuntimeConfig(env);
  if (!config.enabled || typeof fetch !== 'function') return;

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-request-id': createRequestId('session'),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Platform API session request failed with status ${response.status}.`);
  }
}

export async function createPlatformApiSession(
  idToken: string | undefined,
  env: Record<string, unknown> = import.meta.env,
): Promise<void> {
  const token = String(idToken || '').trim();
  if (!token) return;
  await postSession('/api/v1/auth/session', { idToken: token }, env);
}

export async function clearPlatformApiSession(env: Record<string, unknown> = import.meta.env): Promise<void> {
  await postSession('/api/v1/auth/logout', {}, env);
}
