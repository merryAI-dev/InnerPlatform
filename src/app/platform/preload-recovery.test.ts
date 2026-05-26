import { describe, expect, it, vi } from 'vitest';
import { installVitePreloadRecovery } from './preload-recovery';

describe('installVitePreloadRecovery', () => {
  it('reloads the app shell when Vite reports a stale preload chunk', () => {
    let listener: ((event: Event) => void) | undefined;
    const reload = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = {
      addEventListener: vi.fn((type: string, callback: EventListener) => {
        if (type === 'vite:preloadError') listener = callback;
      }),
      location: { reload },
    };
    const event = {
      preventDefault: vi.fn(),
      detail: { message: 'failed to fetch dynamically imported module' },
    } as unknown as Event;

    installVitePreloadRecovery(target);
    listener?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
