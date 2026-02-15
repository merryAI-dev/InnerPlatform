import { describe, expect, it } from 'vitest';
import { computeChangeRequestStateCounts, computeExpenseSetStatusCounts } from './submissions.helpers';

describe('submissions helpers', () => {
  it('counts expense set statuses', () => {
    const counts = computeExpenseSetStatusCounts([
      { id: '1', projectId: 'p', ledgerId: '', title: '', createdBy: '', createdByName: '', createdAt: '', updatedAt: '', status: 'DRAFT', period: '', items: [], totalNet: 0, totalVat: 0, totalGross: 0 },
      { id: '2', projectId: 'p', ledgerId: '', title: '', createdBy: '', createdByName: '', createdAt: '', updatedAt: '', status: 'SUBMITTED', period: '', items: [], totalNet: 0, totalVat: 0, totalGross: 0 },
      { id: '3', projectId: 'p', ledgerId: '', title: '', createdBy: '', createdByName: '', createdAt: '', updatedAt: '', status: 'SUBMITTED', period: '', items: [], totalNet: 0, totalVat: 0, totalGross: 0 },
      { id: '4', projectId: 'p', ledgerId: '', title: '', createdBy: '', createdByName: '', createdAt: '', updatedAt: '', status: 'REJECTED', period: '', items: [], totalNet: 0, totalVat: 0, totalGross: 0 },
    ] as any);

    expect(counts.DRAFT).toBe(1);
    expect(counts.SUBMITTED).toBe(2);
    expect(counts.REJECTED).toBe(1);
    expect(counts.APPROVED).toBe(0);
  });

  it('counts change request states', () => {
    const counts = computeChangeRequestStateCounts([
      { id: '1', projectId: 'p', title: '', type: 'ORG', state: 'DRAFT', requestedBy: '', requestedAt: '', changes: [], timeline: [] },
      { id: '2', projectId: 'p', title: '', type: 'ORG', state: 'SUBMITTED', requestedBy: '', requestedAt: '', changes: [], timeline: [] },
      { id: '3', projectId: 'p', title: '', type: 'ORG', state: 'REVISION_REQUESTED', requestedBy: '', requestedAt: '', changes: [], timeline: [] },
    ] as any);

    expect(counts.DRAFT).toBe(1);
    expect(counts.SUBMITTED).toBe(1);
    expect(counts.REVISION_REQUESTED).toBe(1);
    expect(counts.APPROVED).toBe(0);
  });
});

