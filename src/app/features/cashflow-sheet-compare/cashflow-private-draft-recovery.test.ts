import { describe, expect, it, vi } from 'vitest';
import {
  rebaseSheetLabDraft,
  saveSheetLabDraftWithRecovery,
} from './cashflow-private-draft-recovery';

describe('cashflow private draft recovery', () => {
  it('rebases only sheetLab on the latest private payload after one draft revision conflict', () => {
    expect(rebaseSheetLabDraft({
      latest: { ledgerFilter: 'keep', sheetLab: { value: 'old' } },
      localSheetLab: { value: 'new', sheetName: 'Forecast' },
    })).toEqual({
      ledgerFilter: 'keep',
      sheetLab: { value: 'new', sheetName: 'Forecast' },
    });
  });

  it('does not retry a second draft revision conflict', async () => {
    const versionConflict = { body: { code: 'draft_version_conflict' } };
    const client = {
      get: vi.fn(async () => ({
        draft: { draftRevision: 8, payload: { ledgerFilter: 'keep', sheetLab: { value: 'other' } } },
      })),
      save: vi.fn()
        .mockRejectedValueOnce(versionConflict)
        .mockRejectedValueOnce(versionConflict),
    };

    await expect(saveSheetLabDraftWithRecovery({
      client,
      ownership: { leaseId: 'lease-a', fence: 3 },
      expectedDraftRevision: 7,
      payload: { sheetLab: { value: 'new', sheetName: 'Forecast' } },
    })).rejects.toMatchObject({ code: 'cashflow_private_draft_conflict' });

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.save).toHaveBeenCalledTimes(2);
    expect(client.save).toHaveBeenLastCalledWith(
      { leaseId: 'lease-a', fence: 3 },
      {
        expectedDraftRevision: 8,
        payload: { ledgerFilter: 'keep', sheetLab: { value: 'new', sheetName: 'Forecast' } },
      },
    );
  });
});
