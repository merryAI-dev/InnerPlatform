import { describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { loadLazyRouteModule } from './lazy-route';

function Fallback() {
  return null;
}

function Target() {
  return null;
}

describe('loadLazyRouteModule', () => {
  it('returns the named export when the chunk loads normally', async () => {
    const result = await loadLazyRouteModule(
      async () => ({ PortalSubmissionsPage: Target }),
      'PortalSubmissionsPage',
      Fallback,
    );

    expect(result.default).toBe(Target as ComponentType);
  });

  it('falls back cleanly when the chunk loader rejects', async () => {
    const error = new Error('chunk load failed');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadLazyRouteModule(
      async () => {
        throw error;
      },
      'PortalSubmissionsPage',
      Fallback,
      '[routes] failed to load PortalSubmissionsPage:',
    );

    expect(result.default).toBe(Fallback as ComponentType);
    expect(spy).toHaveBeenCalledWith('[routes] failed to load PortalSubmissionsPage:', error);
    spy.mockRestore();
  });
});
