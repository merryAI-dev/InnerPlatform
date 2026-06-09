import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const settlementLedgerSource = readFileSync(
  resolve(import.meta.dirname, 'SettlementLedgerPage.tsx'),
  'utf8',
);
const importEditorSource = readFileSync(
  resolve(import.meta.dirname, 'ImportEditor.tsx'),
  'utf8',
);

describe('SettlementLedgerPage direct-entry workbook flow', () => {
  it('adds explicit template download and workbook upload actions for direct-entry mode', () => {
    expect(settlementLedgerSource).toContain("workflowMode === 'DIRECT_ENTRY'");
    expect(settlementLedgerSource).toContain('엑셀 템플릿 다운로드');
    expect(settlementLedgerSource).toContain('작성본 업로드');
  });

  it('reuses workbook parsing helpers without frontend cashflow actual sync', () => {
    expect(settlementLedgerSource).toContain('parseLocalWorkbookFile');
    expect(settlementLedgerSource).toContain('normalizeSettlementWorkbookToImportRows');
    expect(settlementLedgerSource).not.toContain('syncImportRowsToCashflow');
    expect(settlementLedgerSource).toContain('Actual 반영 결과는 캐시플로에서 확인할 수 있습니다.');
    expect(settlementLedgerSource).not.toContain('backend actual');
  });

  it('only reports dirty navigation state for real unsaved drafts, not while a save request is in flight', () => {
    expect(settlementLedgerSource).toContain("onDirtyStateChange?.(importDirty || sheetSaveState === 'dirty')");
    expect(settlementLedgerSource).not.toContain("onDirtyStateChange?.(importDirty || sheetSaveState === 'dirty' || sheetSaveState === 'saving')");
  });

  it('emits a separate saving-state signal while the sheet save request is in flight', () => {
    expect(settlementLedgerSource).toContain("onSavingStateChange?.(sheetSaveState === 'saving')");
    expect(settlementLedgerSource).not.toContain('cashflowSyncing');
  });

  it('does not keep a human-review queue between expense saves and cashflow actual sync', () => {
    expect(settlementLedgerSource).not.toContain('const syncableWeeks = payload;');
    expect(settlementLedgerSource).not.toContain('const syncableWeeks = payload.filter((week) => !blockedWeeks.includes(week));');
    expect(settlementLedgerSource).not.toContain("expenseSyncState: 'review_required'");
    expect(settlementLedgerSource).not.toContain("expenseSyncState: 'synced'");
  });

  it('does not resume cashflow updates from frontend weekly sync status', () => {
    expect(settlementLedgerSource).toContain('weeklySubmissionStatuses?: WeeklySubmissionStatus[]');
    expect(settlementLedgerSource).not.toContain('resolveCashflowSyncStateFromStatuses');
  });

  it('does not reference removed number formatter dependencies at runtime', () => {
    expect(importEditorSource).not.toContain('formatNumberCell');
  });
});
