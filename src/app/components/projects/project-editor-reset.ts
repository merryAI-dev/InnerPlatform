export function shouldResetProjectEditorDraft(input: {
  lastResetKey: string | null;
  resetKey: string;
  currentFingerprint: string;
  lastPersistedFingerprint: string;
  incomingFingerprint: string;
}): boolean {
  if (input.lastResetKey !== input.resetKey) return true;
  return input.currentFingerprint === input.lastPersistedFingerprint
    && input.currentFingerprint !== input.incomingFingerprint;
}
