export function resolveFirestoreErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybe = error as { code?: unknown };
  return typeof maybe.code === 'string' ? maybe.code : '';
}

export function shouldCreateDocOnUpdateError(error: unknown): boolean {
  return resolveFirestoreErrorCode(error) === 'not-found';
}

