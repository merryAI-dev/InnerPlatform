import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Upload, Loader2, ShieldAlert, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { usePortalStore, type BankStatementApplyCellPatch } from '../../data/portal-store';
import {
  buildBankStatementServerImportLines,
  isHtmlMaskedAsXls,
  normalizeBankStatementMatrix,
  parseHtmlBankExport,
  sanitizeHtmlMatrix,
  type BankStatementRow,
} from '../../platform/bank-statement';
import { normalizeKey, parseCsv } from '../../platform/csv-utils';
import { warmExcelJs } from '../../platform/lazy-heavy-modules';
import { parseXlsxWorkbook } from '../../platform/local-workbook';
import { readTextFile } from '../../platform/text-file-decoder';
import { CASHFLOW_LINE_OPTIONS, SETTLEMENT_COLUMNS, type ImportRow } from '../../platform/settlement-csv';
import { findWeekForDate, getYearMondayWeeks } from '../../platform/cashflow-weeks';
import { useFirebase } from '../../lib/firebase-context';
import { normalizeBudgetLabel, buildBudgetLabelKey } from '../../platform/budget-labels';
import { useAuth } from '../../data/auth-store';
import { EditLeaseDialogs } from '../editing/EditLeaseDialogs';
import { useCashflowEditLease } from '../cashflow/useCashflowEditLease';
import { createCashflowPrivateDraftClient } from '../../lib/cashflow-private-draft-client';

function getTransactionAmountColumnIndexes(columns: string[]): Set<number> {
  return new Set(
    columns.map((col, idx) => ({ col, idx }))
      .filter(({ col }) => {
        const key = normalizeKey(col);
        return key.includes(normalizeKey('입금')) || key.includes(normalizeKey('출금'));
      })
      .map(({ idx }) => idx),
  );
}

type WizardDraft = Record<string, string>;

const WIZARD_FIELDS = [
  { key: 'budgetCategory', label: '비목', column: '비목' },
  { key: 'budgetSubCategory', label: '세목', column: '세목' },
  { key: 'budgetSubSubCategory', label: '세세목', column: '세세목' },
  { key: 'cashflowLine', label: 'cashflow항목', column: 'cashflow항목' },
  { key: 'depositAmount', label: '입금액(사업비,공급가액,은행이자)', column: '입금액(사업비,공급가액,은행이자)' },
  { key: 'vatRefund', label: '매입부가세 반환', column: '매입부가세 반환' },
  { key: 'expenseAmount', label: '사업비 사용액', column: '사업비 사용액' },
  { key: 'vatIn', label: '매입부가세', column: '매입부가세' },
] as const;

const WIZARD_PRIMARY_FIELDS = WIZARD_FIELDS.filter((field) => (
  field.key === 'budgetCategory'
  || field.key === 'budgetSubCategory'
  || field.key === 'budgetSubSubCategory'
  || field.key === 'cashflowLine'
));
const WIZARD_DEPOSIT_FIELDS = WIZARD_FIELDS.filter((field) => (
  field.key === 'depositAmount' || field.key === 'vatRefund'
));
const WIZARD_WITHDRAWAL_FIELDS = WIZARD_FIELDS.filter((field) => (
  field.key === 'expenseAmount' || field.key === 'vatIn'
));
const WIZARD_AMOUNT_FIELD_KEYS = ['depositAmount', 'vatRefund', 'expenseAmount', 'vatIn'] as const;
const WIZARD_BULK_CLASSIFICATION_FIELD_KEYS = [
  'budgetCategory',
  'budgetSubCategory',
  'budgetSubSubCategory',
  'cashflowLine',
] as const;
const WIZARD_GRID_FIELD_KEYS = WIZARD_BULK_CLASSIFICATION_FIELD_KEYS;
const WIZARD_CASHFLOW_OPTIONS = CASHFLOW_LINE_OPTIONS.filter((option) => option.value !== 'INPUT_VAT_OUT');
const WIZARD_DRAFT_RETENTION_DAYS = 30;

interface WizardDraftVersion {
  id: string;
  createdAtIso: string;
  draftName: string;
  rows: BankStatementRow[];
  drafts: Record<string, WizardDraft>;
  batchKey: string;
}

interface WizardSuggestion {
  counterparty: string;
  draft: WizardDraft;
}

interface WizardImportMeta {
  signedAmount?: number;
  transactionDate: string;
  weekLabel: string;
}

interface WizardGridCell {
  rowKey: string;
  fieldKey: typeof WIZARD_GRID_FIELD_KEYS[number];
}

function bankRowKey(row: BankStatementRow, index: number): string {
  return row.tempId || `row-${index}`;
}

function settlementColumnIndex(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

function settlementCell(row: ImportRow, header: string): string {
  const idx = settlementColumnIndex(header);
  return idx >= 0 ? String(row.cells?.[idx] || '').trim() : '';
}

function formatNumberDraft(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.abs(value).toLocaleString('ko-KR')
    : '';
}

function parseDraftAmount(value: string): number | null {
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function splitVatIncludedAmount(value: string): { supply: string; vat: string } | null {
  const amount = parseDraftAmount(value);
  if (amount == null) return null;
  const sign = amount < 0 ? -1 : 1;
  const vat = Math.round(Math.abs(amount) / 11);
  const supply = Math.max(Math.abs(amount) - vat, 0);
  return {
    supply: (supply * sign).toLocaleString('ko-KR'),
    vat: (vat * sign).toLocaleString('ko-KR'),
  };
}

function parseClipboardGrid(text: string): string[][] {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ''))
    .map((line) => line.split('\t'));
}

function buildWizardBatchKey(projectId: string, rows: BankStatementRow[]): string {
  return [
    projectId || 'no-project',
    ...rows.map((row, index) => bankRowKey(row, index)),
  ].join('|');
}

function formatWizardDraftVersionLabel(createdAtIso: string): string {
  const date = new Date(createdAtIso);
  if (!Number.isFinite(date.getTime())) return '작성본 불러오기';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${pick('year')}년${pick('month')}월${pick('day')}일${pick('hour')}시${pick('minute')}분 작성본 불러오기`;
}

function parseWizardDraftVersions(value: unknown, batchKey?: string): WizardDraftVersion[] {
  if (!Array.isArray(value)) return [];
  const minCreatedAt = Date.now() - WIZARD_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return value
    .map((item): WizardDraftVersion | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const source = item as Partial<WizardDraftVersion>;
      const createdAtIso = String(source.createdAtIso || '');
      const createdAt = new Date(createdAtIso).getTime();
      const versionBatchKey = String(source.batchKey || '');
      if (!source.id || !Number.isFinite(createdAt) || createdAt < minCreatedAt || !versionBatchKey) return null;
      if (batchKey && versionBatchKey !== batchKey) return null;
      return {
        id: String(source.id),
        createdAtIso,
        draftName: String(source.draftName || ''),
        rows: Array.isArray(source.rows) ? source.rows : [],
        drafts: source.drafts && typeof source.drafts === 'object' && !Array.isArray(source.drafts)
          ? source.drafts
          : {},
        batchKey: versionBatchKey,
      };
    })
    .filter((version): version is WizardDraftVersion => version !== null)
    .sort((left, right) => new Date(right.createdAtIso).getTime() - new Date(left.createdAtIso).getTime());
}

function getBankRowCounterparty(columns: string[], row: BankStatementRow): string {
  const aliases = ['거래처', '의뢰인/수취인', '수취인', '지급처', '적요', '내용'];
  for (const alias of aliases) {
    const aliasKey = normalizeKey(alias);
    const idx = columns.findIndex((column) => normalizeKey(column).includes(aliasKey));
    const value = idx >= 0 ? String(row.cells?.[idx] || '').trim() : '';
    if (value) return value;
  }
  return '';
}

function buildInitialWizardDraft(signedAmount: number | null | undefined): WizardDraft {
  if (typeof signedAmount !== 'number' || !Number.isFinite(signedAmount)) return {};
  return signedAmount < 0
    ? { expenseAmount: formatNumberDraft(signedAmount), vatIn: '' }
    : { depositAmount: formatNumberDraft(signedAmount), vatRefund: '' };
}

function buildWizardWeekLabel(transactionDate: string | null | undefined): string {
  const dateOnly = String(transactionDate || '').slice(0, 10);
  const year = Number.parseInt(dateOnly.slice(0, 4), 10);
  if (!dateOnly || !Number.isFinite(year)) return '';
  return findWeekForDate(dateOnly, getYearMondayWeeks(year))?.label || '';
}

function buildSameCounterpartySuggestions(expenseSheets: { rows?: ImportRow[] | null }[]): Map<string, WizardSuggestion> {
  const suggestions = new Map<string, WizardSuggestion>();
  expenseSheets.forEach((sheet) => {
    (sheet.rows || []).forEach((row) => {
      const counterparty = settlementCell(row, '지급처');
      const key = normalizeKey(counterparty);
      if (!key) return;
      const draft: WizardDraft = {
        budgetCategory: settlementCell(row, '비목'),
        budgetSubCategory: settlementCell(row, '세목'),
        budgetSubSubCategory: settlementCell(row, '세세목'),
        cashflowLine: settlementCell(row, 'cashflow항목'),
      };
      if (Object.values(draft).some(Boolean)) {
        suggestions.set(key, { counterparty, draft });
      }
    });
  });
  return suggestions;
}

function collectAppliedBankLineIds(rows: ImportRow[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const source = String(row.sourceTxId || '').trim();
    const match = source.match(/^bank-import-line:(.+)$/);
    if (match?.[1]) ids.add(match[1]);
  });
  return ids;
}

function buildWizardCellPatchesByRowKey(rows: BankStatementRow[], drafts: Record<string, WizardDraft>): Record<string, BankStatementApplyCellPatch[]> {
  const result: Record<string, BankStatementApplyCellPatch[]> = {};
  rows.forEach((row, index) => {
    const rowKey = bankRowKey(row, index);
    const draft = drafts[rowKey] || {};
    const patches = WIZARD_FIELDS
      .map((field): BankStatementApplyCellPatch | null => {
        const columnIndex = settlementColumnIndex(field.column);
        const rawValue = String(draft[field.key] || '').trim();
        if (columnIndex < 0 || !rawValue) return null;
        return { columnIndex, rawValue, userEdited: true };
      })
      .filter((patch): patch is BankStatementApplyCellPatch => patch !== null);
    if (patches.length > 0) result[rowKey] = patches;
  });
  return result;
}

export function PortalBankStatementPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const {
    activeProjectId,
    portalUser,
    myProject,
    bankStatementRows,
    bankStatementProjectId,
    expenseSheets,
    expenseSheetRows,
    budgetCodeBook,
    budgetTreeV2,
    saveBankStatementRows,
    applyBankStatementRowsToExpenseSheet,
    refreshBankStatementRows,
  } = usePortalStore();
  const { orgId } = useFirebase();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<BankStatementRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPreparing, setUploadPreparing] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [activeStatusTab, setActiveStatusTab] = useState<'staged' | 'applied'>('staged');
  const [wizardRows, setWizardRows] = useState<BankStatementRow[]>([]);
  const [wizardDrafts, setWizardDrafts] = useState<Record<string, WizardDraft>>({});
  const [wizardDraftVersions, setWizardDraftVersions] = useState<WizardDraftVersion[]>([]);
  const [wizardHistory, setWizardHistory] = useState<Record<string, WizardDraft>[]>([]);
  const [wizardSelectedRowKeys, setWizardSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [wizardGridSelection, setWizardGridSelection] = useState<{ start: WizardGridCell; end: WizardGridCell } | null>(null);
  const [wizardSavingDraft, setWizardSavingDraft] = useState(false);
  const [wizardSidebarCollapsed, setWizardSidebarCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wizardDraftsRef = useRef<Record<string, WizardDraft>>({});
  const wizardGridDraggingRef = useRef(false);
  const loadedProjectIdRef = useRef('');
  const currentProjectIdRef = useRef('');
  const loadedPrivateDraftKeyRef = useRef('');
  const privateDraftLoadRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const projectName = myProject?.name || '내 사업';
  const projectId = activeProjectId || myProject?.id || '';
  currentProjectIdRef.current = projectId;
  const scopedBankStatementRows = bankStatementProjectId === projectId ? bankStatementRows : null;
  const bffActor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: authUser?.role || portalUser?.role || 'pm',
    idToken: authUser?.idToken,
    googleAccessToken: authUser?.googleAccessToken,
  }), [
    authUser?.email,
    authUser?.googleAccessToken,
    authUser?.idToken,
    authUser?.role,
    authUser?.uid,
    portalUser?.email,
    portalUser?.id,
    portalUser?.role,
  ]);
  const cashflowLease = useCashflowEditLease({ tenantId: orgId, projectId, actor: bffActor });
  const cashflowPrivateDraftClient = useMemo(() => (
    cashflowLease.sessionId && projectId
      ? createCashflowPrivateDraftClient({
          tenantId: orgId,
          projectId,
          actor: bffActor,
          sessionId: cashflowLease.sessionId,
        })
      : null
  ), [bffActor, cashflowLease.sessionId, orgId, projectId]);
  const hydrateBankPrivateDraft = useCallback(async (ownership: { leaseId: string; fence: number }) => {
    if (!cashflowPrivateDraftClient) throw new Error('임시저장 API가 준비되지 않았습니다.');
    const key = `${projectId}:${ownership.leaseId}:${ownership.fence}`;
    if (loadedPrivateDraftKeyRef.current === key) return;
    if (privateDraftLoadRef.current?.key === key) return privateDraftLoadRef.current.promise;
    const promise = (async () => {
      const opened = await cashflowPrivateDraftClient.open(ownership, { baseSnapshot: {}, payload: {} });
      if (currentProjectIdRef.current !== projectId) return;
      const bankStatement = opened.draft.payload.bankStatement;
      if (bankStatement && typeof bankStatement === 'object' && !Array.isArray(bankStatement)) {
        const snapshot = bankStatement as { columns?: unknown; rows?: unknown };
        if (Array.isArray(snapshot.columns) && Array.isArray(snapshot.rows)) {
          const restoredColumns = snapshot.columns.map((value) => String(value ?? ''));
          const restoredRows = snapshot.rows.map((value, index) => {
            const row = value && typeof value === 'object' ? value as Partial<BankStatementRow> : {};
            return {
              tempId: typeof row.tempId === 'string' ? row.tempId : `bank-draft-${index}`,
              cells: Array.isArray(row.cells) ? row.cells.map((cell) => String(cell ?? '')) : [],
              status: row.status === 'applied' ? 'applied' as const : 'staged' as const,
            };
          });
          setColumns(restoredColumns);
          setRows(restoredRows);
          setDirty(true);
        }
      }
      setWizardDraftVersions(parseWizardDraftVersions(opened.draft.payload.bankWizardDraftVersions));
      loadedPrivateDraftKeyRef.current = key;
    })();
    privateDraftLoadRef.current = { key, promise };
    try {
      await promise;
    } finally {
      if (privateDraftLoadRef.current?.key === key) privateDraftLoadRef.current = null;
    }
  }, [cashflowPrivateDraftClient, projectId]);
  useEffect(() => {
    loadedPrivateDraftKeyRef.current = '';
    privateDraftLoadRef.current = null;
  }, [projectId]);
  useEffect(() => {
    if (!cashflowLease.canEdit || !cashflowLease.ownership) return;
    void hydrateBankPrivateDraft(cashflowLease.ownership).catch((error) => {
      toast.error(error instanceof Error ? error.message : '임시저장본을 복구하지 못했습니다.');
    });
  }, [cashflowLease.canEdit, cashflowLease.ownership, hydrateBankPrivateDraft]);
  const beginBankEditing = useCallback(async (resumePrevious = false) => {
    const ownership = await (resumePrevious ? cashflowLease.takeover() : cashflowLease.acquire());
    if (!ownership) return;
    try {
      await hydrateBankPrivateDraft(ownership);
    } catch (error) {
      await cashflowLease.release();
      toast.error(error instanceof Error ? error.message : '임시저장본을 열지 못했습니다.');
    }
  }, [cashflowLease.acquire, cashflowLease.release, cashflowLease.takeover, hydrateBankPrivateDraft]);
  const ready = useMemo(() => Boolean(activeProjectId || myProject?.id), [activeProjectId, myProject?.id]);
  const transactionAmountColIdxs = useMemo(() => getTransactionAmountColumnIndexes(columns), [columns]);
  const hasTransactionAmountColumns = transactionAmountColIdxs.size > 0;
  const hasUploadedSheet = rows.length > 0 && columns.length > 0;
  const selectedRows = useMemo(
    () => rows.filter((row, rowIdx) => selectedRowIds.has(row.tempId || `row-${rowIdx}`)),
    [rows, selectedRowIds],
  );
  const appliedBankLineIds = useMemo(() => {
    const rowsAcrossSheets = expenseSheets.flatMap((sheet) => sheet.rows || []);
    return collectAppliedBankLineIds(rowsAcrossSheets.length > 0 ? rowsAcrossSheets : expenseSheetRows);
  }, [expenseSheetRows, expenseSheets]);
  const unappliedSelectedRows = useMemo(
    () => selectedRows.filter((row, index) => {
      const id = bankRowKey(row, index);
      return !appliedBankLineIds.has(id);
    }),
    [appliedBankLineIds, selectedRows],
  );
  const skippedAppliedCount = selectedRows.length - unappliedSelectedRows.length;
  const budgetCategoryOptions = useMemo(() => {
    if (budgetTreeV2?.codes?.length) return budgetTreeV2.codes.map((entry) => entry.code).filter(Boolean);
    return budgetCodeBook.map((entry) => entry.code).filter(Boolean);
  }, [budgetCodeBook, budgetTreeV2?.codes]);
  const budgetHierarchyIndex = useMemo(() => {
    const subCategoriesByBudget = new Map<string, string[]>();
    const subSubCategoriesByPair = new Map<string, string[]>();
    if (budgetTreeV2?.codes?.length) {
      budgetTreeV2.codes.forEach((entry) => {
        const budgetKey = normalizeBudgetLabel(entry.code);
        subCategoriesByBudget.set(budgetKey, (entry.subItems || []).map((subItem) => subItem.subCode).filter(Boolean));
        (entry.subItems || []).forEach((subItem) => {
          subSubCategoriesByPair.set(
            buildBudgetLabelKey(entry.code, subItem.subCode),
            (subItem.leafItems || []).map((leaf) => normalizeBudgetLabel(leaf.subSubCode)).filter(Boolean),
          );
        });
      });
    } else {
      budgetCodeBook.forEach((entry) => {
        subCategoriesByBudget.set(normalizeBudgetLabel(entry.code), entry.subCodes || []);
      });
    }
    return { subCategoriesByBudget, subSubCategoriesByPair };
  }, [budgetCodeBook, budgetTreeV2?.codes]);
  const sameCounterpartySuggestions = useMemo(
    () => buildSameCounterpartySuggestions(expenseSheets),
    [expenseSheets],
  );
  const wizardIssueSummary = useMemo(() => {
    return wizardRows.reduce((summary, row, index) => {
      const draft = wizardDrafts[bankRowKey(row, index)] || {};
      const hasDeposit = parseDraftAmount(draft.depositAmount || '') !== null;
      const hasExpense = parseDraftAmount(draft.expenseAmount || '') !== null;
      const invalidAmount = ['depositAmount', 'vatRefund', 'expenseAmount', 'vatIn']
        .some((fieldKey) => {
          const value = draft[fieldKey] || '';
          return Boolean(value.trim()) && parseDraftAmount(value) === null;
        });
      const missingVat = (hasDeposit && String(draft.vatRefund || '').trim() === '')
        || (hasExpense && String(draft.vatIn || '').trim() === '');
      if ((!hasDeposit && !hasExpense) || invalidAmount || missingVat) summary.amount += 1;
      if (!draft.budgetCategory || !draft.budgetSubCategory) summary.budget += 1;
      return summary;
    }, { amount: 0, budget: 0 });
  }, [wizardDrafts, wizardRows]);
  const wizardImportMetaByRowKey = useMemo(() => {
    const importLines = buildBankStatementServerImportLines({ columns, rows: wizardRows });
    const result = new Map<string, WizardImportMeta>();
    wizardRows.forEach((row, index) => {
      const importLine = importLines[index];
      const signedAmount = importLine?.signedAmount;
      const transactionDate = importLine?.transactionDate || '';
      const meta: WizardImportMeta = {
        transactionDate,
        weekLabel: buildWizardWeekLabel(transactionDate),
      };
      if (typeof signedAmount === 'number' && Number.isFinite(signedAmount)) {
        meta.signedAmount = signedAmount;
      }
      result.set(bankRowKey(row, index), meta);
    });
    return result;
  }, [columns, wizardRows]);

  useEffect(() => {
    if (loadedProjectIdRef.current === projectId) return;
    loadedProjectIdRef.current = projectId;
    setColumns([]);
    setRows([]);
    setSelectedRowIds(new Set());
    setDirty(false);
  }, [projectId]);

  useEffect(() => {
    if (dirty || !scopedBankStatementRows) return;
    const nextColumns = scopedBankStatementRows.columns || [];
    const nextRows = scopedBankStatementRows.rows || [];
    setColumns(nextColumns);
    setRows(nextRows);
    setSelectedRowIds(new Set());
  }, [dirty, scopedBankStatementRows]);

  useEffect(() => {
    wizardDraftsRef.current = wizardDrafts;
  }, [wizardDrafts]);

  const parseExcelToMatrix = useCallback(async (file: File): Promise<string[][]> => {
    // KB 등 HTML-as-XLS 감지: 파일 앞부분이 HTML 태그로 시작하면 HTML 파서 사용
    const headBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const headText = new TextDecoder('utf-8', { fatal: false }).decode(headBytes).trim();
    if (isHtmlMaskedAsXls(headText)) {
      const fullText = await file.text();
      const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(fullText));
      if (matrix.length > 0) return matrix;
      // fallback to XLSX if HTML parse yields nothing
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      throw new Error('보안 정책상 XLS 바이너리는 지원하지 않습니다. CSV 또는 XLSX로 변환해 업로드해 주세요.');
    }

    const sheets = await parseXlsxWorkbook(await file.arrayBuffer());
    const sheetMatrices = sheets.map((sheet) => {
      const matrix = sheet.matrix;
      const nonEmpty = matrix.reduce((sum, row) => {
        return sum + row.filter((cell) => String(cell || '').trim().length > 0).length;
      }, 0);
      return { matrix, nonEmpty };
    });

    const best = sheetMatrices
      .sort((a, b) => b.nonEmpty - a.nonEmpty)[0];

    return best?.matrix || [];
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const name = file.name.toLowerCase();
      let matrix: string[][] = [];
      const needsSpreadsheetEngine = name.endsWith('.xlsx') || name.endsWith('.xls');
      if (needsSpreadsheetEngine) {
        setUploadPreparing(true);
      }
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        matrix = await parseExcelToMatrix(file);
      } else if (name.endsWith('.csv')) {
        const text = await readTextFile(file);
        matrix = parseCsv(text);
      } else {
        toast.error('CSV 또는 XLSX 파일만 업로드할 수 있습니다.');
        return;
      }
      const result = normalizeBankStatementMatrix(matrix);
      if (!result.columns.length || !result.rows.length) {
        toast.error('업로드 데이터에서 컬럼/행을 찾지 못했습니다. 파일 형식을 확인해 주세요.');
        return;
      }
      setColumns(result.columns);
      setRows(result.rows);
      setSelectedRowIds(new Set(result.rows.map((row, index) => row.tempId || `row-${index}`)));
      setDirty(true);
    } catch (err) {
      console.error('[BankStatement] upload parse failed:', err);
      toast.error('파일을 읽지 못했습니다. `.xlsx` 또는 `.csv` 파일인지 확인해 주세요.');
    } finally {
      setUploadPreparing(false);
    }
  }, [parseExcelToMatrix]);

  const openFilePicker = useCallback(() => {
    if (!cashflowLease.canEdit) {
      toast.info('수정 시작을 눌러 수정 세션을 먼저 선점해 주세요.');
      return;
    }
    warmExcelJs();
    fileInputRef.current?.click();
  }, [cashflowLease.canEdit]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (!cashflowLease.canEdit) {
      toast.info('수정 시작을 눌러 수정 세션을 먼저 선점해 주세요.');
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  }, [cashflowLease.canEdit, handleFileUpload]);

  const persistSheet = useCallback(async (options?: { silent?: boolean }) => {
    if (!saveBankStatementRows) {
      if (!options?.silent) toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      const mutationLease = await cashflowLease.checkBeforeMutation();
      await saveBankStatementRows({ columns, rows }, { cashflowLease: mutationLease });
      setDirty(false);
      if (!options?.silent) toast.success('통장내역을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] save failed:', err);
      if (!options?.silent) toast.error('통장내역 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [cashflowLease.checkBeforeMutation, columns, rows, saveBankStatementRows]);

  const toggleRowSelection = useCallback((rowIdx: number, checked: boolean) => {
    const row = rows[rowIdx];
    if (!row) return;
    const id = row.tempId || `row-${rowIdx}`;
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, [rows]);

  const toggleAllRows = useCallback((checked: boolean) => {
    setSelectedRowIds(checked ? new Set(rows.map((row, index) => row.tempId || `row-${index}`)) : new Set());
  }, [rows]);

  const switchStatusTab = useCallback(async (status: 'staged' | 'applied') => {
    if (status === activeStatusTab) return;
    if (dirty) {
      toast.message('저장 전 초안을 먼저 기준본으로 저장한 뒤 탭을 전환해 주세요.');
      return;
    }
    setActiveStatusTab(status);
    setSelectedRowIds(new Set());
    try {
      await refreshBankStatementRows(status);
    } catch (err) {
      console.error('[BankStatement] status tab load failed:', err);
      toast.error('통장내역 상태를 불러오지 못했습니다.');
    }
  }, [activeStatusTab, dirty, refreshBankStatementRows]);

  const loadWizardDraftVersions = useCallback(async (targetRows: BankStatementRow[] = wizardRows) => {
    if (!cashflowPrivateDraftClient || !cashflowLease.ownership || !projectId || targetRows.length === 0) {
      setWizardDraftVersions([]);
      return;
    }
    const batchKey = buildWizardBatchKey(projectId, targetRows);
    try {
      const opened = await cashflowPrivateDraftClient.open(cashflowLease.ownership, { baseSnapshot: {}, payload: {} });
      setWizardDraftVersions(parseWizardDraftVersions(opened.draft.payload.bankWizardDraftVersions, batchKey));
    } catch (err) {
      console.error('[BankStatement] wizard draft load failed:', err);
      toast.error('임시 작성본을 불러오지 못했습니다.');
    }
  }, [cashflowLease.ownership, cashflowPrivateDraftClient, projectId, wizardRows]);

  const handleSaveWizardDraft = useCallback(async () => {
    if (!cashflowPrivateDraftClient || !projectId || wizardRows.length === 0) {
      toast.error('임시저장을 사용할 수 없습니다.');
      return;
    }
    setWizardSavingDraft(true);
    try {
      const mutationLease = await cashflowLease.checkBeforeMutation();
      const opened = await cashflowPrivateDraftClient.open(mutationLease, { baseSnapshot: {}, payload: {} });
      const createdAtIso = new Date().toISOString();
      const batchKey = buildWizardBatchKey(projectId, wizardRows);
      const version: WizardDraftVersion = {
        id: `wizard-${Date.now()}`,
        createdAtIso,
        draftName: formatWizardDraftVersionLabel(createdAtIso),
        batchKey,
        rows: wizardRows,
        drafts: wizardDrafts,
      };
      const retainedVersions = parseWizardDraftVersions(opened.draft.payload.bankWizardDraftVersions);
      const saved = await cashflowPrivateDraftClient.save(mutationLease, {
        expectedDraftRevision: opened.draft.draftRevision,
        payload: {
          ...opened.draft.payload,
          bankWizardDraftVersions: [version, ...retainedVersions],
        },
      });
      setWizardDraftVersions(parseWizardDraftVersions(saved.draft.payload.bankWizardDraftVersions, batchKey));
      toast.success('임시 작성본을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] wizard draft save failed:', err);
      toast.error('임시 작성본 저장에 실패했습니다.');
    } finally {
      setWizardSavingDraft(false);
    }
  }, [cashflowLease.checkBeforeMutation, cashflowPrivateDraftClient, projectId, wizardDrafts, wizardRows]);

  const handleLoadWizardDraft = useCallback((version: WizardDraftVersion) => {
    setWizardRows(version.rows);
    setWizardDrafts(version.drafts);
    setWizardSelectedRowKeys(new Set(version.rows.map((row, index) => bankRowKey(row, index))));
    setWizardHistory([]);
    toast.success(formatWizardDraftVersionLabel(version.createdAtIso));
  }, []);

  const pushWizardHistorySnapshot = useCallback(() => {
    const snapshot = wizardDraftsRef.current;
    setWizardHistory((history) => [...history.slice(-19), snapshot]);
  }, []);

  const handleApplySelected = useCallback(async () => {
    if (activeStatusTab !== 'staged') {
      toast.message('이미 반영된 통장내역은 다시 반영할 수 없습니다.');
      return;
    }
    if (selectedRows.length === 0) {
      toast.message('사업비 입력에 반영할 통장내역 행을 선택해 주세요.');
      return;
    }
    if (unappliedSelectedRows.length === 0) {
      toast.message('선택한 통장내역은 이미 사업비 입력에 반영되었습니다.');
      return;
    }
    if (dirty) {
      await persistSheet({ silent: true });
    }
    const serverImportLines = buildBankStatementServerImportLines({ columns, rows: unappliedSelectedRows });
    const nextDrafts: Record<string, WizardDraft> = {};
    unappliedSelectedRows.forEach((row, index) => {
      nextDrafts[bankRowKey(row, index)] = buildInitialWizardDraft(serverImportLines[index]?.signedAmount);
    });
    setWizardRows(unappliedSelectedRows);
    setWizardDrafts(nextDrafts);
    setWizardSelectedRowKeys(new Set(unappliedSelectedRows.map((row, index) => bankRowKey(row, index))));
    setWizardHistory([]);
    void loadWizardDraftVersions(unappliedSelectedRows);
  }, [activeStatusTab, columns, dirty, loadWizardDraftVersions, persistSheet, selectedRows, unappliedSelectedRows]);

  const updateWizardDraft = useCallback((rowKey: string, fieldKey: string, value: string) => {
    pushWizardHistorySnapshot();
    setWizardDrafts((current) => {
      const nextRowDraft = {
        ...(current[rowKey] || {}),
        [fieldKey]: value,
      };
      return {
        ...current,
        [rowKey]: nextRowDraft,
      };
    });
  }, [pushWizardHistorySnapshot]);

  const handleWizardUndo = useCallback(() => {
    setWizardHistory((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setWizardDrafts(previous);
      return history.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    if (wizardRows.length === 0) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      handleWizardUndo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleWizardUndo, wizardRows.length]);

  const toggleWizardRowSelection = useCallback((rowKey: string, checked: boolean) => {
    setWizardSelectedRowKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  const handleApplySuggestion = useCallback((rowKey: string, suggestion: WizardSuggestion) => {
    pushWizardHistorySnapshot();
    setWizardDrafts((current) => {
      return {
        ...current,
        [rowKey]: {
          ...(current[rowKey] || {}),
          ...suggestion.draft,
        },
      };
    });
  }, [pushWizardHistorySnapshot]);

  const handleBulkApplyWizardDraft = useCallback(() => {
    const selectedKeys = Array.from(wizardSelectedRowKeys);
    if (selectedKeys.length < 2) {
      toast.message('분류를 복사할 행을 2개 이상 선택해 주세요.');
      return;
    }
    const sourceKey = selectedKeys.find((key) => WIZARD_BULK_CLASSIFICATION_FIELD_KEYS.some((fieldKey) => String(wizardDrafts[key]?.[fieldKey] || '').trim()));
    if (!sourceKey) {
      toast.message('먼저 기준 행에 비목/세목/cashflow 값을 입력해 주세요.');
      return;
    }
    const sourceDraft = wizardDrafts[sourceKey] || {};
    const patchDraft = WIZARD_BULK_CLASSIFICATION_FIELD_KEYS.reduce<WizardDraft>((acc, fieldKey) => {
      const value = String(sourceDraft[fieldKey] || '').trim();
      if (value) acc[fieldKey] = value;
      return acc;
    }, {});
    pushWizardHistorySnapshot();
    setWizardDrafts((current) => {
      const next = { ...current };
      selectedKeys.forEach((rowKey) => {
        next[rowKey] = {
          ...(next[rowKey] || {}),
          ...patchDraft,
        };
      });
      return next;
    });
  }, [pushWizardHistorySnapshot, wizardDrafts, wizardSelectedRowKeys]);

  const handleApplyVatSplit = useCallback(() => {
    const targetKeys = wizardSelectedRowKeys.size > 0
      ? Array.from(wizardSelectedRowKeys)
      : wizardRows.map((row, index) => bankRowKey(row, index));
    if (targetKeys.length === 0) return;
    pushWizardHistorySnapshot();
    setWizardDrafts((current) => {
      const next = { ...current };
      targetKeys.forEach((rowKey) => {
        const draft = { ...(next[rowKey] || {}) };
        const expenseSplit = String(draft.vatIn || '').trim() === ''
          ? splitVatIncludedAmount(draft.expenseAmount || '')
          : null;
        if (expenseSplit) {
          draft.expenseAmount = expenseSplit.supply;
          draft.vatIn = expenseSplit.vat;
        }
        const depositSplit = String(draft.vatRefund || '').trim() === ''
          ? splitVatIncludedAmount(draft.depositAmount || '')
          : null;
        if (depositSplit) {
          draft.depositAmount = depositSplit.supply;
          draft.vatRefund = depositSplit.vat;
        }
        next[rowKey] = draft;
      });
      return next;
    });
  }, [pushWizardHistorySnapshot, wizardRows, wizardSelectedRowKeys]);

  const wizardGridSelectionBounds = useMemo(() => {
    if (!wizardGridSelection) return null;
    const rowKeys = wizardRows.map((row, index) => bankRowKey(row, index));
    const startRow = rowKeys.indexOf(wizardGridSelection.start.rowKey);
    const endRow = rowKeys.indexOf(wizardGridSelection.end.rowKey);
    const startCol = WIZARD_GRID_FIELD_KEYS.indexOf(wizardGridSelection.start.fieldKey);
    const endCol = WIZARD_GRID_FIELD_KEYS.indexOf(wizardGridSelection.end.fieldKey);
    if (startRow < 0 || endRow < 0 || startCol < 0 || endCol < 0) return null;
    return {
      rowMin: Math.min(startRow, endRow),
      rowMax: Math.max(startRow, endRow),
      colMin: Math.min(startCol, endCol),
      colMax: Math.max(startCol, endCol),
      rowKeys,
    };
  }, [wizardGridSelection, wizardRows]);

  const isWizardGridCellSelected = useCallback((rowKey: string, fieldKey: WizardGridCell['fieldKey']) => {
    if (!wizardGridSelectionBounds) return false;
    const rowIdx = wizardGridSelectionBounds.rowKeys.indexOf(rowKey);
    const colIdx = WIZARD_GRID_FIELD_KEYS.indexOf(fieldKey);
    return rowIdx >= wizardGridSelectionBounds.rowMin
      && rowIdx <= wizardGridSelectionBounds.rowMax
      && colIdx >= wizardGridSelectionBounds.colMin
      && colIdx <= wizardGridSelectionBounds.colMax;
  }, [wizardGridSelectionBounds]);

  const beginWizardGridSelection = useCallback((rowKey: string, fieldKey: WizardGridCell['fieldKey']) => {
    wizardGridDraggingRef.current = true;
    setWizardGridSelection({ start: { rowKey, fieldKey }, end: { rowKey, fieldKey } });
  }, []);

  const extendWizardGridSelection = useCallback((rowKey: string, fieldKey: WizardGridCell['fieldKey']) => {
    if (!wizardGridDraggingRef.current) return;
    setWizardGridSelection((current) => (
      current ? { ...current, end: { rowKey, fieldKey } } : current
    ));
  }, []);

  useEffect(() => {
    if (wizardRows.length === 0) return undefined;
    const stopDragging = () => {
      wizardGridDraggingRef.current = false;
    };
    window.addEventListener('mouseup', stopDragging);
    return () => window.removeEventListener('mouseup', stopDragging);
  }, [wizardRows.length]);

  useEffect(() => {
    if (wizardRows.length === 0) return undefined;
    const readSelectedGrid = () => {
      if (!wizardGridSelectionBounds) return null;
      const lines: string[] = [];
      for (let rowIdx = wizardGridSelectionBounds.rowMin; rowIdx <= wizardGridSelectionBounds.rowMax; rowIdx += 1) {
        const rowKey = wizardGridSelectionBounds.rowKeys[rowIdx];
        const draft = wizardDraftsRef.current[rowKey] || {};
        const values: string[] = [];
        for (let colIdx = wizardGridSelectionBounds.colMin; colIdx <= wizardGridSelectionBounds.colMax; colIdx += 1) {
          values.push(String(draft[WIZARD_GRID_FIELD_KEYS[colIdx]] || ''));
        }
        lines.push(values.join('\t'));
      }
      return lines.join('\n');
    };
    const onCopy = (event: ClipboardEvent) => {
      const text = readSelectedGrid();
      if (text == null) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!wizardGridSelectionBounds) return;
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!text) return;
      const matrix = parseClipboardGrid(text);
      if (matrix.length === 0) return;
      event.preventDefault();
      pushWizardHistorySnapshot();
      setWizardDrafts((current) => {
        const next = { ...current };
        for (let rowIdx = wizardGridSelectionBounds.rowMin; rowIdx <= wizardGridSelectionBounds.rowMax; rowIdx += 1) {
          const rowKey = wizardGridSelectionBounds.rowKeys[rowIdx];
          const draft = { ...(next[rowKey] || {}) };
          for (let colIdx = wizardGridSelectionBounds.colMin; colIdx <= wizardGridSelectionBounds.colMax; colIdx += 1) {
            const matrixRow = matrix[(rowIdx - wizardGridSelectionBounds.rowMin) % matrix.length] || [];
            const rawValue = matrixRow[(colIdx - wizardGridSelectionBounds.colMin) % Math.max(matrixRow.length, 1)] ?? matrixRow[0] ?? '';
            draft[WIZARD_GRID_FIELD_KEYS[colIdx]] = rawValue;
          }
          next[rowKey] = draft;
        }
        return next;
      });
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [pushWizardHistorySnapshot, wizardGridSelectionBounds, wizardRows.length]);

  const closeWizard = useCallback(() => {
    setWizardRows([]);
    setWizardDrafts({});
    setWizardDraftVersions([]);
    setWizardHistory([]);
    setWizardSelectedRowKeys(new Set());
    setWizardGridSelection(null);
    setWizardSidebarCollapsed(false);
  }, []);

  const handleSubmitWizard = useCallback(async () => {
    if (wizardRows.length === 0) return;
    setSaving(true);
    try {
      const cellPatchesByRowKey = buildWizardCellPatchesByRowKey(wizardRows, wizardDrafts);
      const mutationLease = await cashflowLease.checkBeforeMutation();
      if (!cashflowPrivateDraftClient) throw new Error('임시저장 세션이 준비되지 않았습니다.');
      const opened = await cashflowPrivateDraftClient.open(mutationLease, { baseSnapshot: {}, payload: {} });
      const result = await applyBankStatementRowsToExpenseSheet(
        { columns, rows: wizardRows },
        { cellPatchesByRowKey, cashflowLease: mutationLease },
      );
      await cashflowPrivateDraftClient.complete(mutationLease, { expectedDraftRevision: opened.draft.draftRevision });
      await cashflowLease.checkStatus();
      toast.success(`선택한 통장내역 ${result.appliedCount}건을 사업비 입력에 반영했습니다.`);
      setSelectedRowIds(new Set());
      closeWizard();
    } catch (err) {
      console.error('[BankStatement] selected apply failed:', err);
      toast.error('선택한 통장내역 반영에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [applyBankStatementRowsToExpenseSheet, cashflowLease.checkBeforeMutation, cashflowLease.checkStatus, cashflowPrivateDraftClient, closeWizard, columns, wizardDrafts, wizardRows]);

  const getSubCategoryOptions = useCallback((budgetCategory: string): string[] => {
    return budgetHierarchyIndex.subCategoriesByBudget.get(normalizeBudgetLabel(budgetCategory)) || [];
  }, [budgetHierarchyIndex.subCategoriesByBudget]);

  const getSubSubCategoryOptions = useCallback((budgetCategory: string, budgetSubCategory: string): string[] => {
    return budgetHierarchyIndex.subSubCategoriesByPair.get(buildBudgetLabelKey(budgetCategory, budgetSubCategory)) || [];
  }, [budgetHierarchyIndex.subSubCategoriesByPair]);

  const renderWizardField = useCallback((rowKey: string, field: typeof WIZARD_FIELDS[number], draft: WizardDraft) => {
    const amountField = (WIZARD_AMOUNT_FIELD_KEYS as readonly string[]).includes(field.key);
    const vatRefundMissing = field.key === 'vatRefund'
      && String(draft.depositAmount || '').trim() !== ''
      && String(draft.vatRefund || '').trim() === '';
    const vatInMissing = field.key === 'vatIn'
      && String(draft.expenseAmount || '').trim() !== ''
      && String(draft.vatIn || '').trim() === '';
    const vatField = field.key === 'vatRefund' || field.key === 'vatIn';
    const baseClass = [
      'h-7 w-full border border-slate-300 bg-white px-1.5 text-[11px] outline-none focus:border-blue-500',
      amountField ? 'min-w-[84px] text-right tabular-nums' : 'min-w-[104px]',
      vatRefundMissing || vatInMissing ? 'border-red-400 bg-red-50 focus:border-red-500' : '',
    ].join(' ');
    if (field.key === 'cashflowLine') {
      return (
        <select
          className={baseClass}
          value={draft.cashflowLine || ''}
          onChange={(event) => updateWizardDraft(rowKey, field.key, event.target.value)}
          aria-label="cashflow항목은 회사 기준 Actual PK입니다"
          title="cashflow항목은 회사 기준 Actual PK입니다"
        >
          <option value="">선택</option>
          {WIZARD_CASHFLOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.label}>{option.label}</option>
          ))}
        </select>
      );
    }
    if (field.key === 'budgetCategory') {
      return (
        <select
          className={baseClass}
          value={draft.budgetCategory || ''}
          onChange={(event) => updateWizardDraft(rowKey, field.key, event.target.value)}
        >
          <option value="">선택</option>
          {budgetCategoryOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (field.key === 'budgetSubCategory') {
      const options = getSubCategoryOptions(draft.budgetCategory || '');
      return (
        <select
          className={baseClass}
          value={draft.budgetSubCategory || ''}
          onChange={(event) => updateWizardDraft(rowKey, field.key, event.target.value)}
        >
          <option value="">선택</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (field.key === 'budgetSubSubCategory') {
      const options = getSubSubCategoryOptions(draft.budgetCategory || '', draft.budgetSubCategory || '');
      return (
        <select
          className={baseClass}
          value={draft.budgetSubSubCategory || ''}
          onChange={(event) => updateWizardDraft(rowKey, field.key, event.target.value)}
          disabled={options.length === 0}
        >
          <option value="">{options.length > 0 ? '선택' : '없음'}</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        className={baseClass}
        value={draft[field.key] || ''}
        onChange={(event) => updateWizardDraft(rowKey, field.key, event.target.value)}
        placeholder={vatField ? '(공급가액 정산만)' : field.label}
      />
    );
  }, [budgetCategoryOptions, getSubCategoryOptions, getSubSubCategoryOptions, updateWizardDraft]);

  const uploadExperienceHint = uploadPreparing
    ? '엑셀 엔진을 준비하고 있습니다. 첫 업로드는 잠시 더 걸릴 수 있습니다.'
    : '엑셀 파일은 첫 업로드 때 엔진을 먼저 준비한 뒤 읽습니다.';

  if (!ready) {
    return (
      <Card className="border-slate-200 bg-white">
        <CardContent className="p-6">
          <div className="max-w-2xl space-y-3">
            <h1 className="text-[20px] font-extrabold tracking-[-0.03em] text-slate-900">통장내역을 시작하려면 먼저 사업 연결이 필요합니다</h1>
            <p className="text-[13px] leading-6 text-slate-600">
              배정된 사업이 있어야 이번 주 원본 파일을 올리고, 주간 사업비 기준본으로 이어갈 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate('/portal/project-select')}>사업 선택하기</Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
                주간 사업비 화면 보기
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant={cashflowLease.canEdit ? 'default' : 'outline'}
          disabled={!cashflowLease.sessionId || cashflowLease.busy || cashflowLease.canEdit}
          onClick={() => void beginBankEditing()}
        >
          {cashflowLease.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {cashflowLease.canEdit ? '수정 중' : '수정 시작'}
        </Button>
        {cashflowLease.canEdit && (
          <Button type="button" size="sm" variant="ghost" disabled={cashflowLease.busy} onClick={() => void cashflowLease.extend()}>
            {cashflowLease.remainingLabel} · 30분 연장
          </Button>
        )}
        {!cashflowLease.canEdit && <span className="text-[11px] text-slate-500">통장내역은 읽을 수 있지만 업로드·저장·반영은 수정 세션이 필요합니다.</span>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        disabled={!cashflowLease.canEdit}
        accept=".csv,.xlsx"
        className="hidden"
        onClick={() => warmExcelJs()}
        onFocus={() => warmExcelJs()}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileUpload(file);
          e.currentTarget.value = '';
        }}
      />

      {!hasUploadedSheet && (
        <Card data-testid="bank-statement-empty-state" className="border-slate-200 bg-white">
          <CardContent className="p-5">
            <div
              className={`rounded-2xl border-2 border-dashed p-6 transition-colors ${
                dragActive ? 'border-[#001e46] bg-slate-50' : 'border-slate-300 bg-white'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              <div className="flex h-full flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#001e46] text-white shadow-sm">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[18px] font-semibold text-slate-900">이번 주 통장내역을 업로드하세요</p>
                    <p className="max-w-2xl text-[13px] leading-6 text-slate-600">
                      원본 파일을 올린 뒤 필요한 거래만 정리하면 됩니다.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={openFilePicker} disabled={!cashflowLease.canEdit}>
                    {uploadPreparing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                    {uploadPreparing ? '엑셀 준비 중' : '파일 선택'}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">지원 형식: `.csv`, `.xlsx`</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{uploadExperienceHint}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasUploadedSheet ? (
        <div className="overflow-hidden rounded border border-slate-200 bg-white shadow-sm" data-testid="bank-statement-apply-wizard">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-bold text-slate-950">통장내역 선택</h2>
              </div>
            </div>
          </div>

          <div className="border-b px-5 pt-3">
            <div className="flex items-center gap-6 text-[13px] font-semibold">
              <button
                type="button"
                className={`px-1 pb-2 ${activeStatusTab === 'staged' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-slate-500'}`}
                onClick={() => void switchStatusTab('staged')}
              >
                미반영
              </button>
              <button
                type="button"
                className={`px-1 pb-2 ${activeStatusTab === 'applied' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-slate-500'}`}
                onClick={() => void switchStatusTab('applied')}
              >
                반영완료
              </button>
            </div>
          </div>

          <div className="grid min-h-[520px] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="border-r bg-slate-50/70 p-5">
              <div className="rounded border border-blue-200 bg-white p-4 shadow-sm">
                <div className="text-[14px] font-bold text-slate-900">전체</div>
                <div className="mt-7 space-y-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">{activeStatusTab === 'staged' ? '미반영 거래' : '반영완료 거래'}</span>
                    <span className="font-bold">{rows.length.toLocaleString('ko-KR')}건</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-slate-600">금액 컬럼</span>
                    <span className="font-bold">{hasTransactionAmountColumns ? '감지됨' : '확인 필요'}</span>
                  </div>
                </div>
              </div>
            </aside>

            <section className="min-w-0">
              <div className="overflow-auto max-h-[520px]">
                <table className="w-full min-w-[920px] text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-100">
                    <tr>
                      <th className="w-10 border-b border-r px-2 py-2 text-left">
                        <Checkbox
                          checked={hasUploadedSheet && selectedRows.length === rows.length}
                          onCheckedChange={(checked) => toggleAllRows(Boolean(checked))}
                          aria-label="전체 행 선택"
                          disabled={activeStatusTab !== 'staged'}
                        />
                      </th>
                      <th className="w-14 border-b border-r px-2 py-2 text-left font-semibold">행</th>
                      {columns.map((col, idx) => (
                        <th key={idx} className="border-b border-r px-3 py-2 text-left font-semibold whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIdx) => (
                      <tr
                        key={row.tempId || rowIdx}
                        className={`border-t ${selectedRowIds.has(row.tempId || `row-${rowIdx}`) ? 'bg-blue-50/70' : 'bg-white'}`}
                      >
                        <td className="border-r px-2 py-1.5">
                          <Checkbox
                            checked={selectedRowIds.has(row.tempId || `row-${rowIdx}`)}
                            onCheckedChange={(checked) => toggleRowSelection(rowIdx, Boolean(checked))}
                            aria-label={`${rowIdx + 1}행 선택`}
                            disabled={activeStatusTab !== 'staged'}
                          />
                        </td>
                        <td className="border-r px-2 py-1.5">
                          <span className="text-[11px] text-slate-500">{rowIdx + 1}</span>
                        </td>
                        {columns.map((_, colIdx) => (
                          <td
                            key={colIdx}
                            className="border-r px-3 py-2 text-slate-700"
                          >
                            <span className="block min-w-[110px] whitespace-nowrap">{row.cells[colIdx] || ''}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-5 py-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
              취소
            </Button>
            <Button size="sm" onClick={handleApplySelected} disabled={!cashflowLease.canEdit || saving || activeStatusTab !== 'staged' || selectedRows.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              선택 행 반영
            </Button>
          </div>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex min-h-[240px] items-center justify-center p-6">
            <div className="max-w-md text-center">
              <p className="text-[13px] font-medium text-slate-800">업로드 후 표가 여기에 그대로 표시됩니다.</p>
              <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
                헤더와 값은 원본 구조를 유지하고, 이 화면에서는 검토와 선택만 진행합니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {wizardRows.length > 0 ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/45 px-1.5 py-1.5">
          <div
            data-testid="bank-statement-completion-wizard"
            className="flex max-h-[98vh] w-[min(1800px,99vw)] flex-col overflow-hidden border border-slate-300 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b px-3 py-2">
              <div>
                <h2 className="text-[15px] font-extrabold text-slate-950">비어있는 사업비 항목 작성</h2>
              </div>
            </div>

            <div className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden ${wizardSidebarCollapsed ? 'lg:grid-cols-[44px_minmax(0,1fr)]' : 'lg:grid-cols-[220px_minmax(0,1fr)]'}`}>
              <aside className={`${wizardSidebarCollapsed ? 'overflow-hidden p-1' : 'overflow-auto p-2'} border-r bg-slate-50`}>
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    className="h-7 border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700"
                    onClick={() => setWizardSidebarCollapsed((current) => !current)}
                    aria-label={wizardSidebarCollapsed ? '요약 서랍 열기' : '요약 서랍 닫기'}
                  >
                    {wizardSidebarCollapsed ? '>>' : '<<'}
                  </button>
                </div>

                {wizardSidebarCollapsed ? (
                  null
                ) : (
                  <>
                <div className="rounded border border-blue-200 bg-white p-2 shadow-sm">
                  <div className="text-[13px] font-bold text-slate-900">미반영</div>
                  <div className="mt-3 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">선택 거래</span>
                      <span className="font-bold">{selectedRows.length.toLocaleString('ko-KR')}건</span>
                    </div>
                    <div className="flex items-center justify-between border-t pt-3">
                      <span className="text-slate-600">작성 대상</span>
                      <span className="font-bold">{wizardRows.length.toLocaleString('ko-KR')}건</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">이미 반영되어 제외</span>
                      <span className="font-bold">{Math.max(skippedAppliedCount, 0).toLocaleString('ko-KR')}건</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 rounded border bg-white">
                  <div className="border-b bg-slate-100 px-2 py-1.5 text-[12px] font-bold text-slate-900">
                    오류 요약
                  </div>
                  <div className="space-y-1.5 px-2 py-2 text-[11px] leading-4 text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>금액 오류</span>
                      <span className="font-bold">{wizardIssueSummary.amount.toLocaleString('ko-KR')}건</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>비목 누락</span>
                      <span className="font-bold">{wizardIssueSummary.budget.toLocaleString('ko-KR')}건</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 rounded border bg-white">
                  <div className="flex items-center justify-between gap-2 border-b bg-slate-100 px-2 py-1.5">
                    <div className="text-[12px] font-bold text-slate-900">임시 작성본</div>
                    <Button variant="outline" size="sm" onClick={() => void handleSaveWizardDraft()} disabled={wizardSavingDraft}>
                      {wizardSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      임시저장
                    </Button>
                  </div>
                  <div className="space-y-1.5 px-2 py-2 text-[11px] leading-4 text-slate-600">
                    <p>임시저장은 30일 동안 보관됩니다. 30일 이후에는 새 작성본으로 다시 저장해 주세요.</p>
                    {wizardDraftVersions.length > 0 ? (
                      <div className="space-y-1 border-t pt-3">
                        {wizardDraftVersions.map((version) => (
                          <button
                            key={version.id}
                            type="button"
                            className="block w-full border bg-white px-2 py-1.5 text-left text-[11px] text-slate-700 hover:border-blue-300 hover:text-blue-700"
                            onClick={() => handleLoadWizardDraft(version)}
                          >
                            {formatWizardDraftVersionLabel(version.createdAtIso)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="border-t pt-3 text-[11px] text-slate-500">저장된 작성본이 없습니다.</p>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex justify-end">
                  <div
                    data-testid="bank-statement-wizard-policy-help"
                    className="group relative inline-flex"
                  >
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700"
                      aria-label="작성 기준 보기"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      작성 기준
                    </button>
                    <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-[260px] translate-y-1 border border-slate-300 bg-white p-3 text-[11px] leading-5 text-slate-700 opacity-0 shadow-xl transition duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100">
                      <div className="font-bold text-slate-900">검증 기준</div>
                      <div className="mt-2 space-y-1">
                        <div>cashflow항목은 회사 기준 Actual PK입니다. 목록에 없는 값은 직접 입력하지 않습니다.</div>
                        <div>거래처 제안은 자동완성일 뿐 자동확정하지 않습니다.</div>
                        <div>선택 행 분류 복사는 위자드 임시 입력값에만 적용합니다.</div>
                        <div>확정 시 입력값을 사업비 입력 기준본에 반영합니다.</div>
                      </div>
                    </div>
                  </div>
                </div>
                  </>
                )}
              </aside>

              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden p-2">
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                    <div />
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleWizardUndo} disabled={wizardHistory.length === 0}>
                        되돌리기
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleApplyVatSplit} disabled={wizardRows.length === 0}>
                        부가세 계산
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleBulkApplyWizardDraft} disabled={wizardSelectedRowKeys.size < 2}>
                        선택 행 분류만 복사
                      </Button>
                    </div>
                  </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full min-w-[1040px] border-collapse text-[11px]">
                    <thead className="sticky top-0 z-30">
                      <tr className="bg-slate-100 text-left">
                        <th rowSpan={2} className="sticky left-0 z-40 w-8 border bg-slate-100 px-1.5 py-1">
                          <Checkbox
                            checked={wizardRows.length > 0 && wizardSelectedRowKeys.size === wizardRows.length}
                            onCheckedChange={(checked) => {
                              setWizardSelectedRowKeys(Boolean(checked)
                                ? new Set(wizardRows.map((row, index) => bankRowKey(row, index)))
                                : new Set());
                            }}
                            aria-label="위자드 전체 행 선택"
                          />
                        </th>
                        <th rowSpan={2} className="sticky left-8 z-40 w-9 border bg-slate-100 px-1.5 py-1">행</th>
                        <th rowSpan={2} className="sticky left-[68px] z-40 w-[150px] border bg-slate-100 px-1.5 py-1">통장내역 원본</th>
                        <th rowSpan={2} className="w-[68px] border px-1.5 py-1">해당 주차</th>
                        {WIZARD_PRIMARY_FIELDS.map((field) => (
                          <th key={field.key} rowSpan={2} className="border px-1.5 py-1">
                            {field.label}
                          </th>
                        ))}
                        <th colSpan={WIZARD_DEPOSIT_FIELDS.length} className="border bg-emerald-50 px-1.5 py-1 text-center">
                          입금
                        </th>
                        <th colSpan={WIZARD_WITHDRAWAL_FIELDS.length} className="border bg-orange-50 px-1.5 py-1 text-center">
                          출금
                        </th>
                      </tr>
                      <tr className="bg-slate-100 text-left">
                        {WIZARD_DEPOSIT_FIELDS.map((field) => (
                          <th key={field.key} className="w-[88px] border bg-emerald-50 px-1.5 py-1">
                            {field.label}
                          </th>
                        ))}
                        {WIZARD_WITHDRAWAL_FIELDS.map((field) => (
                          <th key={field.key} className="w-[88px] border bg-orange-50 px-1.5 py-1">
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {wizardRows.map((row, rowIdx) => {
                        const rowKey = bankRowKey(row, rowIdx);
                        const previewCells = row.cells
                          .map((cell) => String(cell || '').trim())
                          .filter(Boolean)
                          .slice(0, 5);
                        const draft = wizardDrafts[rowKey] || {};
                        const counterparty = getBankRowCounterparty(columns, row);
                        const suggestion = sameCounterpartySuggestions.get(normalizeKey(counterparty));
                        const importMeta = wizardImportMetaByRowKey.get(rowKey);
                        return (
                          <tr key={rowKey} className="align-top">
                            <td className="sticky left-0 z-20 border bg-slate-50 px-1.5 py-1 text-center">
                              <Checkbox
                                checked={wizardSelectedRowKeys.has(rowKey)}
                                onCheckedChange={(checked) => toggleWizardRowSelection(rowKey, Boolean(checked))}
                                aria-label={`${rowIdx + 1}행 위자드 선택`}
                              />
                            </td>
                            <td className="sticky left-8 z-20 border bg-slate-50 px-1.5 py-1 text-center text-[11px] text-slate-500">
                              {rowIdx + 1}
                            </td>
                            <td className="sticky left-[68px] z-20 border bg-white px-1.5 py-1">
                              <div className="max-w-[145px] space-y-0.5 text-[10px] text-slate-700">
                                {(previewCells.length > 0 ? previewCells : ['원본 셀 없음']).map((cell, idx) => (
                                  <div key={`${rowKey}-raw-${idx}`} className="truncate">
                                    {cell}
                                  </div>
                                ))}
                                {suggestion ? (
                                  <button
                                    type="button"
                                    className="mt-1 border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                                    onClick={() => handleApplySuggestion(rowKey, suggestion)}
                                  >
                                    이전 거래처 조합 적용
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td className="border bg-slate-100 px-1.5 py-1 text-center">
                              <span
                                className="inline-flex h-7 w-full min-w-[58px] items-center justify-center border border-slate-300 bg-slate-50 px-1.5 text-[10px] font-semibold text-slate-600"
                                aria-label="해당 주차 수정불가 계산값"
                                title={importMeta?.transactionDate ? `${importMeta.transactionDate} 기준 수정불가 계산값` : '거래일 기준 수정불가 계산값'}
                              >
                                {importMeta?.weekLabel || '-'}
                              </span>
                            </td>
                            {WIZARD_PRIMARY_FIELDS.map((field) => {
                              const fieldKey = field.key as WizardGridCell['fieldKey'];
                              const selected = isWizardGridCellSelected(rowKey, fieldKey);
                              return (
                              <td
                                key={field.key}
                                className={`border px-1.5 py-1.5 ${selected ? 'relative animate-pulse bg-blue-50 ring-2 ring-inset ring-blue-500 transition-shadow' : ''}`}
                                onMouseDown={(event) => {
                                  if (event.button !== 0) return;
                                  beginWizardGridSelection(rowKey, fieldKey);
                                }}
                                onMouseEnter={() => extendWizardGridSelection(rowKey, fieldKey)}
                              >
                                {renderWizardField(rowKey, field, draft)}
                              </td>
                              );
                            })}
                            {WIZARD_DEPOSIT_FIELDS.map((field) => (
                              <td key={field.key} className="border bg-emerald-50/20 px-1.5 py-1.5">
                                {renderWizardField(rowKey, field, draft)}
                              </td>
                            ))}
                            {WIZARD_WITHDRAWAL_FIELDS.map((field) => (
                              <td key={field.key} className="border bg-orange-50/20 px-1.5 py-1.5">
                                {renderWizardField(rowKey, field, draft)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-4 py-3">
              <Button variant="outline" size="sm" onClick={closeWizard} disabled={saving}>
                취소
              </Button>
              <Button size="sm" onClick={() => void handleSubmitWizard()} disabled={!cashflowLease.canEdit || saving || wizardRows.length === 0}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                작성 내용 반영
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <EditLeaseDialogs
        warningOpen={cashflowLease.warningOpen}
        expiredOpen={cashflowLease.expiredOpen}
        conflictOpen={cashflowLease.conflictOpen}
        holder={cashflowLease.holder}
        busy={cashflowLease.busy}
        onDismissWarning={cashflowLease.dismissWarning}
        onExtend={() => { void cashflowLease.extend(); }}
        onContinueReadOnly={cashflowLease.continueReadOnly}
        onReacquire={() => { void beginBankEditing(); }}
        onTakeover={() => { void beginBankEditing(true); }}
      />
    </div>
  );
}
