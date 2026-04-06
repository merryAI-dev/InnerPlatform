import { describe, expect, it } from 'vitest';

import {
  readPortalGuideAcknowledged,
  writePortalGuideAcknowledged,
} from './portal-guide-preferences';

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

describe('portal-guide-preferences', () => {
  it('scopes acknowledgment by user and guide id', () => {
    const storage = createStorage();

    writePortalGuideAcknowledged({ uid: 'u-1', guideId: 'weekly-expenses' }, true, storage);

    expect(readPortalGuideAcknowledged({ uid: 'u-1', guideId: 'weekly-expenses' }, storage)).toBe(true);
    expect(readPortalGuideAcknowledged({ uid: 'u-1', guideId: 'budget' }, storage)).toBe(false);
    expect(readPortalGuideAcknowledged({ uid: 'u-2', guideId: 'weekly-expenses' }, storage)).toBe(false);
  });

  it('clears acknowledgment when toggled off', () => {
    const storage = createStorage();

    writePortalGuideAcknowledged({ uid: 'u-1', guideId: 'dashboard' }, true, storage);
    writePortalGuideAcknowledged({ uid: 'u-1', guideId: 'dashboard' }, false, storage);

    expect(readPortalGuideAcknowledged({ uid: 'u-1', guideId: 'dashboard' }, storage)).toBe(false);
  });
});
