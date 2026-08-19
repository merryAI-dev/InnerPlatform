import { describe, expect, it, vi } from 'vitest';
import { createCashflowPerformanceTrace } from './cashflow-performance.mjs';

const flushLogs = () => new Promise((resolve) => setImmediate(resolve));

describe('cashflow performance trace', () => {
  it('records only safe timing metadata with one request id', async () => {
    const events = [];
    const ticks = [0, 2, 8, 9];
    const trace = createCashflowPerformanceTrace({
      requestId: 'req-1',
      operation: 'cashflow.read',
      logger: (event) => events.push(event),
      now: () => ticks.shift() ?? 9,
    });

    await expect(trace.measure('upstream_ttfb', async () => ({ secret: 'not-logged' }), { attempt: 1 }))
      .resolves.toEqual({ secret: 'not-logged' });
    await flushLogs();

    expect(events).toEqual([{
      severity: 'INFO',
      message: 'cashflow.performance',
      requestId: 'req-1',
      operation: 'cashflow.read',
      phase: 'upstream_ttfb',
      attempt: 1,
      outcome: 'ok',
      durationMs: 6,
      totalMs: 9,
    }]);
    expect(JSON.stringify(events)).not.toContain('not-logged');
  });

  it('preserves the measured result when the logger throws', async () => {
    const trace = createCashflowPerformanceTrace({
      requestId: 'req-2',
      operation: 'cashflow.read',
      logger: () => { throw new Error('logger failed'); },
    });

    await expect(trace.measure('body_read', async () => 'same-result')).resolves.toBe('same-result');
    await flushLogs();
  });

  it('logs a safe error code and rethrows the original error', async () => {
    const events = [];
    const error = Object.assign(new Error('contains private workbook value'), {
      code: 'jvm_weekly_api_unreachable',
      statusCode: 503,
    });
    const trace = createCashflowPerformanceTrace({
      requestId: 'req-3',
      operation: 'cashflow.read',
      logger: (event) => events.push(event),
    });

    await expect(trace.measure('auth_headers', async () => { throw error; })).rejects.toBe(error);
    await flushLogs();
    expect(events[0]).toMatchObject({
      outcome: 'error',
      statusCode: 503,
      errorCode: 'jvm_weekly_api_unreachable',
    });
    expect(JSON.stringify(events)).not.toContain('private workbook value');
  });

  it('keeps a slow logger outside the measured request path', async () => {
    let logged = false;
    const trace = createCashflowPerformanceTrace({
      requestId: 'req-4',
      operation: 'cashflow.read',
      logger: () => {
        const until = Date.now() + 20;
        while (Date.now() < until) {}
        logged = true;
      },
    });

    await expect(trace.measure('body_read', async () => 'same-result')).resolves.toBe('same-result');
    expect(logged).toBe(false);
    await flushLogs();
    expect(logged).toBe(true);
  });
});

describe('cashflow performance trace Server-Timing', () => {
  it('renders measured spans as a Server-Timing header with a total', async () => {
    let clock = 0;
    const trace = createCashflowPerformanceTrace({
      requestId: 'req-1',
      operation: 'cashflow.month_close.read',
      logger: () => {},
      now: () => clock,
    });
    await trace.measure('jvm_dashboard', async () => { clock += 3200; }, { attempt: 1 });
    await trace.measure('dashboard_compose', async () => { clock += 410; }, { attempt: 1 });
    await trace.measure('jvm_dashboard', async () => { clock += 100; }, { attempt: 2 });
    await expect(trace.measure('publication_after', async () => { clock += 5; throw Object.assign(new Error('x'), { code: 'cashflow_x' }); })).rejects.toThrow();
    clock += 15;
    expect(trace.serverTiming()).toBe(
      'jvm_dashboard;dur=3200, dashboard_compose;dur=410, jvm_dashboard.2;dur=100, publication_after;dur=5;desc="error", total;dur=3730',
    );
  });
});
