import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const settlementLedgerSource = readFileSync(
  resolve(import.meta.dirname, 'SettlementLedgerPage.tsx'),
  'utf8',
);

describe('SettlementLedgerPage direct-entry workbook flow', () => {
  it('adds explicit template download and workbook upload actions for direct-entry mode', () => {
    expect(settlementLedgerSource).toContain("workflowMode === 'DIRECT_ENTRY'");
    expect(settlementLedgerSource).toContain('엑셀 템플릿 다운로드');
    expect(settlementLedgerSource).toContain('작성본 업로드');
  });

  it('reuses workbook parsing helpers and cashflow sync when applying uploaded direct-entry sheets', () => {
    expect(settlementLedgerSource).toContain('parseLocalWorkbookFile');
    expect(settlementLedgerSource).toContain('normalizeSettlementWorkbookToImportRows');
    expect(settlementLedgerSource).toContain('syncImportRowsToCashflow');
  });

  it('only reports dirty navigation state for real unsaved drafts, not while a save request is in flight', () => {
    expect(settlementLedgerSource).toContain("onDirtyStateChange?.(importDirty || sheetSaveState === 'dirty')");
    expect(settlementLedgerSource).not.toContain("onDirtyStateChange?.(importDirty || sheetSaveState === 'dirty' || sheetSaveState === 'saving')");
  });

  it('emits a separate saving-state signal while the sheet save request is in flight', () => {
    expect(settlementLedgerSource).toContain("onSavingStateChange?.(sheetSaveState === 'saving')");
  });
});
