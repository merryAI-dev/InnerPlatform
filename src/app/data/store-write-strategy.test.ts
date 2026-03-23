import { describe, expect, it } from 'vitest';

import { resolveAppWriteStrategy } from './store-write-strategy';

describe('resolveAppWriteStrategy', () => {
  it('prefers BFF writes without Firestore fallback when the platform API is enabled', () => {
    expect(resolveAppWriteStrategy(true, true)).toEqual({
      target: 'bff',
      mirrorRemoteWritesLocally: false,
    });
  });

  it('mirrors BFF writes locally when Firestore is unavailable', () => {
    expect(resolveAppWriteStrategy(true, false)).toEqual({
      target: 'bff',
      mirrorRemoteWritesLocally: true,
    });
  });

  it('uses Firestore writes when the platform API is disabled', () => {
    expect(resolveAppWriteStrategy(false, true)).toEqual({
      target: 'firestore',
      mirrorRemoteWritesLocally: false,
    });
  });

  it('falls back to local-only writes when no remote path is available', () => {
    expect(resolveAppWriteStrategy(false, false)).toEqual({
      target: 'local',
      mirrorRemoteWritesLocally: false,
    });
  });
});
