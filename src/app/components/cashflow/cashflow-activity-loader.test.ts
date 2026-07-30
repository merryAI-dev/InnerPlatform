import { describe, expect, it, vi } from 'vitest';
import { loadCashflowActivitySourcesSequentially } from './cashflow-activity-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('loadCashflowActivitySourcesSequentially', () => {
  it('renders each success before starting the next source and continues after a middle timeout', async () => {
    const legacy = deferred<string[]>();
    const refresh = deferred<string[]>();
    const audit = deferred<string[]>();
    const timeline: string[] = [];
    const visible: string[] = ['already-loaded'];
    const loadSource = vi.fn((source: 'legacy' | 'sheet_refresh' | 'audit') => {
      timeline.push(`start:${source}`);
      return { legacy: legacy.promise, sheet_refresh: refresh.promise, audit: audit.promise }[source];
    });

    const completed = loadCashflowActivitySourcesSequentially(
      loadSource,
      (source, events) => {
        visible.push(...events);
        timeline.push(`success:${source}`);
      },
      (source) => timeline.push(`error:${source}`),
    );

    expect(timeline).toEqual(['start:legacy']);
    legacy.resolve(['legacy-event']);
    await vi.waitFor(() => expect(timeline).toEqual(['start:legacy', 'success:legacy', 'start:sheet_refresh']));
    expect(visible).toEqual(['already-loaded', 'legacy-event']);

    refresh.reject(new Error('요청 중단'));
    await vi.waitFor(() => expect(timeline).toContain('start:audit'));
    expect(visible).toEqual(['already-loaded', 'legacy-event']);

    audit.resolve(['audit-event']);
    await completed;
    expect(timeline).toEqual([
      'start:legacy', 'success:legacy', 'start:sheet_refresh', 'error:sheet_refresh', 'start:audit', 'success:audit',
    ]);
    expect(visible).toEqual(['already-loaded', 'legacy-event', 'audit-event']);
    expect(loadSource).toHaveBeenCalledTimes(3);
  });
});
