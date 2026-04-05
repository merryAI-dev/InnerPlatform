import { describe, expect, it, vi } from 'vitest';
import { createSettlementKernelService, resolveSettlementKernelBinaryPath } from './settlement-kernel.mjs';

describe('settlement-kernel service', () => {
  it('prefers configured binary path when available', () => {
    const binaryPath = resolveSettlementKernelBinaryPath(
      { SETTLEMENT_KERNEL_BIN: '/tmp/custom-kernel' },
      { existsSyncFn: (value) => value === '/tmp/custom-kernel' },
    );

    expect(binaryPath).toBe('/tmp/custom-kernel');
  });

  it('throws 503 when kernel binary is unavailable', () => {
    const service = createSettlementKernelService({
      env: {},
      existsSyncFn: () => false,
    });

    expect(service.isAvailable()).toBe(false);
    expect(() => service.deriveRows({ rows: [], context: {}, options: { mode: 'full' } })).toThrowError('Settlement kernel binary is unavailable.');
  });

  it('serializes derive, flow snapshot, and actual sync commands through the binary', () => {
    const spawnSyncFn = vi.fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ rows: [{ tempId: 'imp-1', cells: ['1'] }] }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ snapshots: [{ tempId: 'imp-1', bankAmount: 110000, expenseAmount: 0, vatIn: 0, depositAmount: 0, refundAmount: 0, budgetActualAmount: 0, cashflowActualLineAmounts: {}, manualOutflowPending: true }] }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ weeks: [{ yearMonth: '2026-03', weekNo: 1, amounts: { DIRECT_COST_OUT: 100000 } }] }),
        stderr: '',
      });
    const service = createSettlementKernelService({
      env: { SETTLEMENT_KERNEL_BIN: '/tmp/kernel-bin' },
      existsSyncFn: (value) => value === '/tmp/kernel-bin',
      spawnSyncFn,
    });

    const derived = service.deriveRows({
      rows: [{ tempId: 'imp-1', cells: ['1'] }],
      context: { projectId: 'p001', defaultLedgerId: 'l001' },
      options: { mode: 'full' },
    });
    const snapshots = service.previewFlowSnapshot({
      rows: [{ tempId: 'imp-1', cells: ['1'] }],
    });
    const preview = service.previewActualSync({
      rows: [{ tempId: 'imp-1', cells: ['1'] }],
      yearWeeks: [{ yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' }],
    });

    expect(spawnSyncFn).toHaveBeenNthCalledWith(1, '/tmp/kernel-bin', expect.objectContaining({
      input: JSON.stringify({
        rows: [{ tempId: 'imp-1', cells: ['1'] }],
        context: { projectId: 'p001', defaultLedgerId: 'l001' },
        options: { mode: 'full' },
      }),
    }));
    expect(spawnSyncFn).toHaveBeenNthCalledWith(2, '/tmp/kernel-bin', expect.objectContaining({
      input: JSON.stringify({
        command: 'flowSnapshot',
        rows: [{ tempId: 'imp-1', cells: ['1'] }],
      }),
    }));
    expect(spawnSyncFn).toHaveBeenNthCalledWith(3, '/tmp/kernel-bin', expect.objectContaining({
      input: JSON.stringify({
        command: 'actualSync',
        rows: [{ tempId: 'imp-1', cells: ['1'] }],
        yearWeeks: [{ yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' }],
      }),
    }));
    expect(derived).toEqual({ rows: [{ tempId: 'imp-1', cells: ['1'] }] });
    expect(snapshots).toEqual({
      snapshots: [{ tempId: 'imp-1', bankAmount: 110000, expenseAmount: 0, vatIn: 0, depositAmount: 0, refundAmount: 0, budgetActualAmount: 0, cashflowActualLineAmounts: {}, manualOutflowPending: true }],
    });
    expect(preview).toEqual({ weeks: [{ yearMonth: '2026-03', weekNo: 1, amounts: { DIRECT_COST_OUT: 100000 } }] });
  });
});
