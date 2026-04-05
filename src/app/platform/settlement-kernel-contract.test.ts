import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import {
  deserializeImportRowsFromKernel,
  serializeImportRowsForKernel,
} from './settlement-kernel-contract';

describe('settlement-kernel-contract', () => {
  it('roundtrips review metadata and edited cells through kernel serialization', () => {
    const row: ImportRow = {
      tempId: 'imp-1',
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
      cells: Array.from({ length: 27 }, (_, index) => String(index)),
      error: 'needs review',
      reviewHints: ['매입부가세 후보값입니다.'],
      reviewRequiredCellIndexes: [13, 14],
      reviewStatus: 'pending',
      reviewFingerprint: 'fp-1',
      reviewConfirmedAt: '2026-04-05T00:00:00.000Z',
      userEditedCells: new Set([8, 13, 14]),
    };

    const serialized = serializeImportRowsForKernel([row]);
    const roundtripped = deserializeImportRowsFromKernel(serialized);

    expect(serialized[0]?.userEditedCells).toEqual([8, 13, 14]);
    expect(roundtripped).toHaveLength(1);
    expect(roundtripped[0]).toEqual(row);
    expect(roundtripped[0]?.userEditedCells).toEqual(new Set([8, 13, 14]));
  });
});
