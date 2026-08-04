import { describe, expect, it } from 'vitest';
import { mergeProjectInfoDraftFields } from './routes/project-info-drafts.mjs';

const base = { name: '가나AC', contractAmount: 1000, status: 'CONTRACT_PENDING', note: '' };

describe('mergeProjectInfoDraftFields', () => {
  it('keeps the owner edit when only the owner changed the field', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: { ...base, contractAmount: 2000 },
      theirs: base,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
    expect(result.merged.contractAmount).toBe(2000);
  });

  it('adopts the canonical value when only the other side changed the field', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: { ...base, contractAmount: 2000 },
      theirs: { ...base, status: 'IN_PROGRESS' },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([{ field: 'status', value: 'IN_PROGRESS' }]);
    expect(result.merged.status).toBe('IN_PROGRESS');
    expect(result.merged.contractAmount).toBe(2000);
  });

  it('reports a conflict only when both sides moved the same field differently', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: { ...base, contractAmount: 2000 },
      theirs: { ...base, contractAmount: 3000 },
    });
    expect(result.conflicts).toEqual([
      { field: 'contractAmount', base: 1000, mine: 2000, theirs: 3000 },
    ]);
    expect(result.merged.contractAmount).toBe(2000);
  });

  it('does not report a conflict when both sides made the same change', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: { ...base, contractAmount: 3000 },
      theirs: { ...base, contractAmount: 3000 },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toEqual([]);
  });

  it('adopts canonical fields the draft never had', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: base,
      theirs: { ...base, groupwareName: '그룹웨어' },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.groupwareName).toBe('그룹웨어');
  });

  it('compares nested values structurally instead of by reference', () => {
    const nestedBase = { paymentPlan: { contract: 0, interim: 0, final: 0 } };
    const result = mergeProjectInfoDraftFields({
      base: nestedBase,
      mine: { paymentPlan: { contract: 0, interim: 0, final: 0 } },
      theirs: { paymentPlan: { contract: 500, interim: 0, final: 0 } },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.paymentPlan).toEqual({ contract: 500, interim: 0, final: 0 });
  });

  it('treats every difference as a conflict for drafts opened before rebase support', () => {
    const result = mergeProjectInfoDraftFields({
      base: null,
      mine: { ...base, contractAmount: 2000 },
      theirs: { ...base, status: 'IN_PROGRESS' },
    });
    expect(result.autoMerged).toEqual([]);
    expect(result.conflicts.map((conflict) => conflict.field).sort()).toEqual(['contractAmount', 'status']);
    expect(result.conflicts.every((conflict) => conflict.base === null)).toBe(true);
  });

  it('never drops an owner field while resolving', () => {
    const result = mergeProjectInfoDraftFields({
      base,
      mine: { ...base, note: '내 메모' },
      theirs: { ...base, note: '남의 메모' },
    });
    expect(Object.keys(result.merged).sort()).toEqual(Object.keys(base).sort());
    expect(result.merged.note).toBe('내 메모');
  });
});
