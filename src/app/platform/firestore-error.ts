/**
 * Type-safe Firestore error code check.
 * Replaces `(err as any)?.code` pattern.
 */
export function isFirestoreError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && typeof (err as Record<string, unknown>).code === 'string'
  );
}

export function isPermissionDenied(err: unknown): boolean {
  return isFirestoreError(err) && err.code === 'permission-denied';
}
