import { describe, expect, it } from 'vitest';
import { shouldResetProjectEditorDraft } from './project-editor-reset';

describe('shouldResetProjectEditorDraft', () => {
  it('hydrates a private server draft when the same editor key is still pristine', () => {
    expect(shouldResetProjectEditorDraft({
      lastResetKey: 'project-a',
      resetKey: 'project-a',
      currentFingerprint: 'canonical',
      lastPersistedFingerprint: 'canonical',
      incomingFingerprint: 'private-draft',
    })).toBe(true);
  });

  it('does not reset for an autosave echo or over unsaved local input', () => {
    expect(shouldResetProjectEditorDraft({
      lastResetKey: 'project-a',
      resetKey: 'project-a',
      currentFingerprint: 'saved-value',
      lastPersistedFingerprint: 'saved-value',
      incomingFingerprint: 'saved-value',
    })).toBe(false);
    expect(shouldResetProjectEditorDraft({
      lastResetKey: 'project-a',
      resetKey: 'project-a',
      currentFingerprint: 'unsaved-local-value',
      lastPersistedFingerprint: 'saved-value',
      incomingFingerprint: 'server-value',
    })).toBe(false);
  });

  it('resets when the editor resource key changes', () => {
    expect(shouldResetProjectEditorDraft({
      lastResetKey: 'project-a',
      resetKey: 'project-b',
      currentFingerprint: 'anything',
      lastPersistedFingerprint: 'anything',
      incomingFingerprint: 'anything',
    })).toBe(true);
  });
});
