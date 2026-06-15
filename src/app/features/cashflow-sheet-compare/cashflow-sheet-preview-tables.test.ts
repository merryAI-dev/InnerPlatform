import { describe, expect, it } from 'vitest';
import {
  buildCashflowPreviewTables,
  parseCashflowSheetDisplayAmount,
  selectPreviewAmount,
} from './cashflow-sheet-preview-tables';
import type {
  CashflowSheetLabPreviewResult,
  CashflowSheetLabPreviewValue,
} from '../../lib/sheets-cashflow-readonly-client';

function previewValue(overrides: Partial<CashflowSheetLabPreviewValue> = {}): CashflowSheetLabPreviewValue {
  return {
    mode: 'projection',
    lineId: 'SALES_IN',
    label: '매출액(입금)',
    canonicalLabel: '매출액(입금)',
    direction: 'IN',
    yearMonth: '2026-01',
    weekNo: 1,
    rowIndex: 3,
    columnIndex: 3,
    a1: 'D4',
    sheetValue: '1,000원',
    amount: 2000,
    source: 'java_read_model',
    ...overrides,
  };
}

function previewFixture(values: CashflowSheetLabPreviewValue[]): CashflowSheetLabPreviewResult {
  return {
    projectId: 'project-a',
    spreadsheetId: 'spreadsheet-a',
    spreadsheetTitle: 'cashflow',
    selectedSheetName: 'cashflow(사용내역 연동)',
    availableSheets: [],
    matrix: [],
    accessPolicy: {
      googleAuth: 'service_account',
      googleScope: 'spreadsheets.readonly',
      sheetPermission: 'shared_with_mysc_system_account',
      layoutSource: 'google_sheet_formatted_values',
      valueSource: 'java_cashflow_read_model',
      actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
      sheetReadRange: 'A1:ZZ220',
      sheetPreviewCache: 'miss',
      sheetNamePolicy: 'cashflow_usage_linked_only',
    },
    template: {
      supported: true,
      policyVersion: 'cashflow-policy-v1',
      sectionOrder: ['projection', 'actual'],
      sections: [{
        mode: 'projection',
        headerRowIndex: 0,
        weekRowIndex: 1,
        weekColumns: [],
        lineRows: [{
          rowIndex: 3,
          label: '매출액(입금)',
          canonicalLabel: '매출액(입금)',
          labelColumnIndex: 0,
          a1: 'A4',
          lineId: 'SALES_IN',
          direction: 'IN',
        }],
        derivedRows: [],
        ignoredRows: [],
        mappings: [],
        missingLineIds: [],
        duplicateLineIds: [],
      }],
      mappingCandidates: [],
      derivedRows: [],
      ignoredRows: [],
      reasons: [],
      stats: {
        rowCount: 0,
        maxColumnCount: 0,
        sectionCount: 1,
        mappingCount: 0,
      },
    },
    previewValues: values,
    cashflowSnapshotStatus: 'ready',
  };
}

describe('cashflow sheet preview tables', () => {
  it('parses formatted Korean currency sheet display values', () => {
    expect(parseCashflowSheetDisplayAmount('5,000,000원')).toBe(5000000);
    expect(parseCashflowSheetDisplayAmount('₩5,000,000')).toBe(5000000);
    expect(parseCashflowSheetDisplayAmount('−500,000')).toBe(-500000);
    expect(parseCashflowSheetDisplayAmount('(1,250,000)')).toBe(-1250000);
  });

  it('does not fall back to Java read model when the sheet value is not numeric', () => {
    const amount = selectPreviewAmount(previewValue({
      sheetValue: 'N/A',
      amount: 1000,
    }));

    expect(amount).toMatchObject({
      sheetAmount: null,
      reflectedAmount: 1000,
      displayAmount: null,
      diff: null,
    });
  });

  it('calculates totals from sheet values only while keeping Java values for diff context', () => {
    const tables = buildCashflowPreviewTables(previewFixture([
      previewValue({
        sheetValue: 'N/A',
        amount: 1000,
      }),
    ]));

    expect(tables[0]?.inRows[0]?.cells[0]).toMatchObject({
      sheetAmount: null,
      reflectedAmount: 1000,
      displayAmount: null,
    });
    expect(tables[0]?.totalIn).toEqual([0]);
    expect(tables[0]?.balances).toEqual([0]);
    expect(tables[0]?.nonEmptyCellCount).toBe(1);
  });
});
