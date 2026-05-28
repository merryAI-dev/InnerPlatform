import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('installVitePreloadRecovery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reloads the app shell once when Vite reports a stale preload chunk', async () => {
    const { installVitePreloadRecovery } = await import('./preload-recovery');
    let listener: ((event: Event) => void) | undefined;
    const reload = vi.fn();
    const storage = new Map<string, string>();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const target = {
      addEventListener: vi.fn((type: string, callback: EventListener) => {
        if (type === 'vite:preloadError') listener = callback;
      }),
      location: { pathname: '/portal/cashflow', reload },
      sessionStorage: {
        getItem: vi.fn((key: string) => storage.get(key) || null),
        setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      },
    };
    const event = {
      preventDefault: vi.fn(),
      detail: { message: 'failed to fetch dynamically imported module' },
    } as unknown as Event;

    installVitePreloadRecovery(target);
    listener?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    listener?.(event);
    expect(reload).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('does not reload again after a same-path recovery marker survives reload', async () => {
    const { installVitePreloadRecovery } = await import('./preload-recovery');
    let listener: ((event: Event) => void) | undefined;
    const reload = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = {
      addEventListener: vi.fn((type: string, callback: EventListener) => {
        if (type === 'vite:preloadError') listener = callback;
      }),
      location: { pathname: '/portal/cashflow', reload },
      sessionStorage: {
        getItem: vi.fn(() => JSON.stringify({
          path: '/portal/cashflow',
          requestedAt: Date.now(),
        })),
        setItem: vi.fn(),
      },
    };
    const event = {
      preventDefault: vi.fn(),
      detail: { message: 'failed to fetch dynamically imported module' },
    } as unknown as Event;

    installVitePreloadRecovery(target);
    listener?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already attempted recently'));
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
