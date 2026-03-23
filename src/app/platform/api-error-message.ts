import { PlatformApiError } from './api-client';

export function resolveApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlatformApiError) {
    const message = typeof error.body === 'object' && error.body && 'message' in (error.body as Record<string, unknown>)
      ? String((error.body as Record<string, unknown>).message || '')
      : '';
    return message || error.message || fallback;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}
