import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Upload, Save, Loader2, ArrowRight, ShieldAlert, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { usePortalStore, type BankStatementApplyCellPatch } from '../../data/portal-store';
import {
  detectBankStatementProfile,
  buildBankStatementServerImportLines,
  getBankStatementProfileLabel,
  isHtmlMaskedAsXls,
  normalizeBankStatementMatrix,
  parseHtmlBankExport,
  sanitizeHtmlMatrix,
  type BankStatementRow,
} from '../../platform/bank-statement';
import { normalizeKey, parseCsv } from '../../platform/csv-utils';
import { loadXlsx, warmXlsx } from '../../platform/lazy-heavy-modules';
import { readTextFile } from '../../platform/text-file-decoder';
import { SETTLEMENT_COLUMNS, type ImportRow } from '../../platform/settlement-csv';
import { useFirebase } from '../../lib/firebase-context';
import { getOrgDocumentPath } from '../../lib/firebase';
import { normalizeBudgetLabel, buildBudgetLabelKey } from '../../platform/budget-labels';

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
  { key: 'evidenceRequired', label: '필수증빙자료 리스트', column: '필수증빙자료 리스트' },
  { key: 'memo', label: '상세 적요', column: '상세 적요' },
  { key: 'settlementNote', label: '비고', column: '비고' },
] as const;

const WIZARD_FIELD_KEYS = WIZARD_FIELDS.map((field) => field.key);
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

function wizardDraftCollectionPath(orgId: string, projectId: string): string {
  return `${getOrgDocumentPath(orgId, 'projects', projectId)}/weekly_expense_apply_drafts`;
}

function resolveEvidenceSuggestion(
  evidenceRequiredMap: Record<string, string>,
  budgetCategory: string,
  budgetSubCategory: string,
  budgetSubSubCategory?: string,
): string {
  const normalizedBudget = normalizeBudgetLabel(budgetCategory);
  const normalizedSub = normalizeBudgetLabel(budgetSubCategory);
  const normalizedSubSub = normalizeBudgetLabel(budgetSubSubCategory);
  const candidates = [
    normalizedSubSub ? buildBudgetLabelKey(normalizedBudget, normalizedSub, normalizedSubSub) : '',
    normalizedSubSub ? `${normalizedBudget}|${normalizedSub}|${normalizedSubSub}` : '',
    normalizedSubSub,
    buildBudgetLabelKey(normalizedBudget, normalizedSub),
    `${normalizedBudget}|${normalizedSub}`,
    normalizedSub,
    normalizedBudget,
  ].filter(Boolean);
  for (const key of candidates) {
    const mapped = evidenceRequiredMap[key];
    if (mapped) return mapped;
  }
  return '';
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

function buildSameCounterpartySuggestions(expenseSheets: { rows?: ImportRow[] }[]): Map<string, WizardSuggestion> {
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
        evidenceRequired: settlementCell(row, '필수증빙자료 리스트'),
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
      .map((field) => {
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
  const {
    activeProjectId,
    portalUser,
    myProject,
    bankStatementRows,
    expenseSheets,
    expenseSheetRows,
    evidenceRequiredMap,
    budgetCodeBook,
    budgetTreeV2,
    saveBankStatementRows,
    applyBankStatementRowsToExpenseSheet,
    refreshBankStatementRows,
  } = usePortalStore();
  const { db, orgId } = useFirebase();
  const [columns, setColumns] = useState<string[]>(bankStatementRows?.columns || []);
  const [rows, setRows] = useState<BankStatementRow[]>(bankStatementRows?.rows || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastUploadedName, setLastUploadedName] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadPreparing, setUploadPreparing] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [activeStatusTab, setActiveStatusTab] = useState<'staged' | 'applied'>('staged');
  const [wizardRows, setWizardRows] = useState<BankStatementRow[]>([]);
  const [wizardDrafts, setWizardDrafts] = useState<Record<string, WizardDraft>>({});
  const [wizardDraftVersions, setWizardDraftVersions] = useState<WizardDraftVersion[]>([]);
  const [wizardHistory, setWizardHistory] = useState<Record<string, WizardDraft>[]>([]);
  const [wizardSelectedRowKeys, setWizardSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [wizardSavingDraft, setWizardSavingDraft] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wizardDraftsRef = useRef<Record<string, WizardDraft>>({});

  const projectName = myProject?.name || '내 사업';
  const projectId = activeProjectId || myProject?.id || '';
  const ready = useMemo(() => Boolean(activeProjectId || myProject?.id), [activeProjectId, myProject?.id]);
  const bankProfile = useMemo(() => detectBankStatementProfile(columns, lastUploadedName), [columns, lastUploadedName]);
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
      if ((!hasDeposit && !hasExpense) || invalidAmount) summary.amount += 1;
      if (!draft.budgetCategory || !draft.budgetSubCategory) summary.budget += 1;
      if (!draft.evidenceRequired) summary.evidence += 1;
      return summary;
    }, { amount: 0, budget: 0, evidence: 0 });
  }, [wizardDrafts, wizardRows]);

  useEffect(() => {
    if (dirty) return;
    if (bankStatementRows?.rows && bankStatementRows.rows.length > 0) {
      const nextColumns = bankStatementRows.columns || [];
      setColumns(nextColumns);
      setRows(bankStatementRows.rows);
      setSelectedRowIds(new Set());
      return;
    }
    setColumns([]);
    setRows([]);
    setSelectedRowIds(new Set());
  }, [bankStatementRows, dirty]);

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

    const XLSX = await loadXlsx();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });

    const sheetMatrices = workbook.SheetNames.map((sheetName) => {
      const ws = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
      const matrix = rawRows.map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => {
          if (cell == null) return '';
          if (cell instanceof Date) return cell.toISOString().slice(0, 10);
          return String(cell);
        }),
      );
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
        toast.error('CSV, XLSX 또는 XLS 파일만 업로드할 수 있습니다.');
        return;
      }
      const result = normalizeBankStatementMatrix(matrix);
      if (!result.columns.length || !result.rows.length) {
        toast.error('업로드 데이터에서 컬럼/행을 찾지 못했습니다. 파일 형식을 확인해 주세요.');
        return;
      }
      setLastUploadedName(file.name);
      setColumns(result.columns);
      setRows(result.rows);
      setSelectedRowIds(new Set(result.rows.map((row, index) => row.tempId || `row-${index}`)));
      setDirty(true);
    } catch (err) {
      console.error('[BankStatement] upload parse failed:', err);
      toast.error('파일을 읽지 못했습니다. `.xls`/`.xlsx`/`.csv` 파일인지 확인해 주세요.');
    } finally {
      setUploadPreparing(false);
    }
  }, [parseExcelToMatrix]);

  const openFilePicker = useCallback(() => {
    warmXlsx();
    fileInputRef.current?.click();
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  }, [handleFileUpload]);

  const persistSheet = useCallback(async (options?: { silent?: boolean }) => {
    if (!saveBankStatementRows) {
      if (!options?.silent) toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    setSaving(true);
    try {
      await saveBankStatementRows({ columns, rows });
      setDirty(false);
      const now = new Date().toISOString();
      setLastSavedAt(now);
      if (!options?.silent) toast.success('통장내역을 저장했습니다.');
    } catch (err) {
      console.error('[BankStatement] save failed:', err);
      if (!options?.silent) toast.error('통장내역 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [columns, rows, saveBankStatementRows]);

  const handleSave = useCallback(async () => {
    await persistSheet();
  }, [persistSheet]);

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
    if (!db || !orgId || !projectId || targetRows.length === 0) {
      setWizardDraftVersions([]);
      return;
    }
    const batchKey = buildWizardBatchKey(projectId, targetRows);
    const minCreatedAt = Date.now() - WIZARD_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    try {
      const snapshot = await getDocs(collection(db, wizardDraftCollectionPath(orgId, projectId)));
      const versions = snapshot.docs
        .map((draftDoc) => {
          const data = draftDoc.data() as Partial<WizardDraftVersion>;
          return {
            id: draftDoc.id,
            createdAtIso: String(data.createdAtIso || ''),
            draftName: String(data.draftName || ''),
            rows: Array.isArray(data.rows) ? data.rows : [],
            drafts: data.drafts && typeof data.drafts === 'object' ? data.drafts : {},
            batchKey: String(data.batchKey || ''),
          } satisfies WizardDraftVersion;
        })
        .filter((version) => {
          const createdAt = new Date(version.createdAtIso).getTime();
          return version.batchKey === batchKey && Number.isFinite(createdAt) && createdAt >= minCreatedAt;
        })
        .sort((left, right) => new Date(right.createdAtIso).getTime() - new Date(left.createdAtIso).getTime());
      setWizardDraftVersions(versions);
    } catch (err) {
      console.error('[BankStatement] wizard draft load failed:', err);
      toast.error('임시 작성본을 불러오지 못했습니다.');
    }
  }, [db, orgId, projectId, wizardRows]);

  const handleSaveWizardDraft = useCallback(async () => {
    if (!db || !orgId || !projectId || wizardRows.length === 0) {
      toast.error('임시저장을 사용할 수 없습니다.');
      return;
    }
    setWizardSavingDraft(true);
    try {
      const createdAtIso = new Date().toISOString();
      const batchKey = buildWizardBatchKey(projectId, wizardRows);
      const draftRef = doc(collection(db, wizardDraftCollectionPath(orgId, projectId)));
      await setDoc(draftRef, {
        createdAtIso,
        draftName: formatWizardDraftVersionLabel(createdAtIso),
        batchKey,
        projectId,
        rows: wizardRows,
        drafts: wizardDrafts,
        createdBy: portalUser?.name || portalUser?.email || 'unknown',
        expiresAtIso: new Date(Date.now() + WIZARD_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      });
      toast.success('임시 작성본을 저장했습니다.');
      await loadWizardDraftVersions(wizardRows);
    } catch (err) {
      console.error('[BankStatement] wizard draft save failed:', err);
      toast.error('임시 작성본 저장에 실패했습니다.');
    } finally {
      setWizardSavingDraft(false);
    }
  }, [db, loadWizardDraftVersions, orgId, portalUser?.email, portalUser?.name, projectId, wizardDrafts, wizardRows]);

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
      if (
        ['budgetCategory', 'budgetSubCategory', 'budgetSubSubCategory'].includes(fieldKey)
        && !String(nextRowDraft.evidenceRequired || '').trim()
      ) {
        const evidenceSuggestion = resolveEvidenceSuggestion(
          evidenceRequiredMap,
          nextRowDraft.budgetCategory || '',
          nextRowDraft.budgetSubCategory || '',
          nextRowDraft.budgetSubSubCategory || '',
        );
        if (evidenceSuggestion) nextRowDraft.evidenceRequired = evidenceSuggestion;
      }
      return {
        ...current,
        [rowKey]: nextRowDraft,
      };
    });
  }, [evidenceRequiredMap, pushWizardHistorySnapshot]);

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
      toast.message('같은 값을 적용할 행을 2개 이상 선택해 주세요.');
      return;
    }
    const sourceKey = selectedKeys.find((key) => WIZARD_FIELD_KEYS.some((fieldKey) => String(wizardDrafts[key]?.[fieldKey] || '').trim()));
    if (!sourceKey) {
      toast.message('먼저 기준이 될 행에 값을 입력해 주세요.');
      return;
    }
    const sourceDraft = wizardDrafts[sourceKey] || {};
    const patchDraft = WIZARD_FIELD_KEYS.reduce<WizardDraft>((acc, fieldKey) => {
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

  const closeWizard = useCallback(() => {
    setWizardRows([]);
    setWizardDrafts({});
    setWizardDraftVersions([]);
    setWizardHistory([]);
    setWizardSelectedRowKeys(new Set());
  }, []);

  const handleSubmitWizard = useCallback(async () => {
    if (wizardRows.length === 0) return;
    setSaving(true);
    try {
      const cellPatchesByRowKey = buildWizardCellPatchesByRowKey(wizardRows, wizardDrafts);
      const result = await applyBankStatementRowsToExpenseSheet({ columns, rows: wizardRows }, { cellPatchesByRowKey });
      toast.success(`선택한 통장내역 ${result.appliedCount}건을 사업비 입력에 반영했습니다.`);
      setSelectedRowIds(new Set());
      closeWizard();
    } catch (err) {
      console.error('[BankStatement] selected apply failed:', err);
      toast.error('선택한 통장내역 반영에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [applyBankStatementRowsToExpenseSheet, closeWizard, columns, wizardDrafts, wizardRows]);

  const getSubCategoryOptions = useCallback((budgetCategory: string): string[] => {
    return budgetHierarchyIndex.subCategoriesByBudget.get(normalizeBudgetLabel(budgetCategory)) || [];
  }, [budgetHierarchyIndex.subCategoriesByBudget]);

  const getSubSubCategoryOptions = useCallback((budgetCategory: string, budgetSubCategory: string): string[] => {
    return budgetHierarchyIndex.subSubCategoriesByPair.get(buildBudgetLabelKey(budgetCategory, budgetSubCategory)) || [];
  }, [budgetHierarchyIndex.subSubCategoriesByPair]);

  const renderWizardField = useCallback((rowKey: string, field: typeof WIZARD_FIELDS[number], draft: WizardDraft) => {
    const baseClass = 'h-9 w-full min-w-[132px] border border-slate-300 bg-white px-2 text-[12px] outline-none focus:border-blue-500';
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
        placeholder={field.label}
      />
    );
  }, [budgetCategoryOptions, getSubCategoryOptions, getSubSubCategoryOptions, updateWizardDraft]);

  const trustSurface = saving
    ? {
      label: '저장 중',
      description: '현재 업로드한 통장내역을 Java API 경로로 저장하고 있습니다.',
      toneClass: 'border-cyan-200/70 bg-cyan-50/60',
    }
    : dirty
      ? {
        label: '저장 전 초안',
        description: '업로드한 통장내역이 아직 주간 사업비 기준본으로 저장되지 않았습니다. 저장 후 선택 반영할 수 있습니다.',
        toneClass: 'border-slate-200 bg-white',
      }
      : hasUploadedSheet
        ? {
          label: lastSavedAt ? '업로드 기준본 저장 완료' : '현재 저장본 사용 중',
          description: lastSavedAt
            ? '최근 저장본을 기준으로 사업비 입력 화면에서 바로 이어서 작업할 수 있습니다.'
            : '이미 저장된 통장내역 기준본을 열어 검토하고 있습니다.',
          toneClass: 'border-slate-300/80 bg-slate-100',
        }
        : {
          label: '원본 업로드 대기',
          description: '이번 주 원본 파일을 먼저 올리면 주간 사업비 입력의 시작점이 준비됩니다.',
          toneClass: 'border-slate-200/80 bg-slate-50/80',
        };
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[18px]" style={{ fontWeight: 700 }}>통장내역</h1>
            <Badge variant={hasUploadedSheet ? 'secondary' : 'outline'} className="text-[10px]">
              {hasUploadedSheet ? `${rows.length}건 불러옴` : '업로드 전'}
            </Badge>
            <Badge variant={dirty ? 'destructive' : 'secondary'} className="text-[10px]">
              {dirty ? '변경됨' : '저장됨'}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {getBankStatementProfileLabel(bankProfile)}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground">{projectName} · 카드/통장 내역 업로드</p>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
            사업비 입력(주간)으로 이어가기
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <Button size="sm" onClick={openFilePicker} disabled={uploadPreparing}>
            {uploadPreparing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {uploadPreparing ? '엑셀 준비 중' : hasUploadedSheet ? '파일 다시 업로드' : '엑셀 업로드'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onClick={() => warmXlsx()}
            onFocus={() => warmXlsx()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.currentTarget.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={handleApplySelected} disabled={saving || activeStatusTab !== 'staged' || selectedRows.length === 0}>
            선택 행 반영
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || !hasUploadedSheet}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            기준본 저장
          </Button>
        </div>
      </div>

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
                  <Button size="sm" onClick={openFilePicker}>
                    {uploadPreparing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                    {uploadPreparing ? '엑셀 준비 중' : '파일 선택'}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">지원 형식: `.csv`, `.xls`, `.xlsx`</span>
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
                <p className="mt-1 text-[12px] text-slate-500">{projectName} · 반영할 거래를 선택합니다</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
                닫기
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded border bg-slate-50 px-4 py-2.5">
              <span className="text-[12px] font-semibold text-slate-700">거래일자</span>
              <span className="rounded border bg-white px-3 py-1.5 text-[12px] text-slate-700">업로드 원본 전체</span>
              <span className="text-[12px] font-semibold text-slate-700">파일</span>
              <span className="min-w-[220px] rounded border bg-white px-3 py-1.5 text-[12px] text-slate-500">
                {lastUploadedName || '저장된 기준본'}
              </span>
              <Button variant="outline" size="sm" onClick={openFilePicker} disabled={uploadPreparing}>
                {uploadPreparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
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
              <div className="mt-4 rounded border bg-white">
                <div className="border-b bg-slate-100 px-4 py-3 text-[13px] font-bold text-slate-900">
                  {lastUploadedName || `${getBankStatementProfileLabel(bankProfile)} 기준본`}
                </div>
                <div className="space-y-3 px-4 py-4 text-[12px] text-slate-600">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                      <FileSpreadsheet className="h-4 w-4 text-slate-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">{getBankStatementProfileLabel(bankProfile)}</div>
                      <div className="text-slate-500">카드/계좌 원본</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span>선택</span>
                    <span className="font-bold text-slate-900">{selectedRows.length.toLocaleString('ko-KR')}건</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>상태</span>
                    <span className="font-bold text-slate-900">{activeStatusTab === 'staged' ? '미반영' : '반영완료'}</span>
                  </div>
                </div>
              </div>
              <div className={`mt-4 rounded border px-4 py-3 text-[12px] ${trustSurface.toneClass}`}>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                  <div>
                    <p className="font-semibold text-slate-800">{trustSurface.label}</p>
                    <p className="mt-1 leading-5 text-slate-600">{trustSurface.description}</p>
                    {lastSavedAt ? (
                      <p className="mt-1 text-[11px] text-slate-500">마지막 저장 {lastSavedAt.slice(0, 16).replace('T', ' ')}</p>
                    ) : null}
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
                  <tfoot className="sticky bottom-0 bg-amber-50">
                    <tr>
                      <td className="border-t border-r px-2 py-2" />
                      <td className="border-t border-r px-2 py-2 font-bold">처리</td>
                      <td className="border-t px-3 py-2 font-bold" colSpan={Math.max(columns.length, 1)}>
                        선택한 행만 Java API 검증 후 반영합니다
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>

          <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-5 py-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/portal/weekly-expenses')}>
              취소
            </Button>
            <Button size="sm" onClick={handleApplySelected} disabled={saving || activeStatusTab !== 'staged' || selectedRows.length === 0}>
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
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div
            data-testid="bank-statement-completion-wizard"
            className="flex max-h-[86vh] w-[min(1180px,96vw)] flex-col overflow-hidden border border-slate-300 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
              <div>
                <h2 className="text-[20px] font-extrabold text-slate-950">비어있는 사업비 항목 작성</h2>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  통장내역에서 선택한 거래를 원장에 쓰기 전, 비목/세목/세세목, 금액, 증빙을 임시 작성합니다.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeWizard} disabled={saving}>
                닫기
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="border-r bg-slate-50 p-5">
                <div className="rounded border border-blue-200 bg-white p-4 shadow-sm">
                  <div className="text-[14px] font-bold text-slate-900">미반영</div>
                  <div className="mt-7 space-y-3 text-[13px]">
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

                <div className="mt-4 rounded border bg-white">
                  <div className="border-b bg-slate-100 px-4 py-3 text-[13px] font-bold text-slate-900">
                    오류 요약
                  </div>
                  <div className="space-y-2 px-4 py-4 text-[12px] leading-5 text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>금액 오류</span>
                      <span className="font-bold">{wizardIssueSummary.amount.toLocaleString('ko-KR')}건</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>비목 누락</span>
                      <span className="font-bold">{wizardIssueSummary.budget.toLocaleString('ko-KR')}건</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>증빙 누락</span>
                      <span className="font-bold">{wizardIssueSummary.evidence.toLocaleString('ko-KR')}건</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded border bg-white">
                  <div className="flex items-center justify-between gap-2 border-b bg-slate-100 px-4 py-3">
                    <div className="text-[13px] font-bold text-slate-900">임시 작성본</div>
                    <Button variant="outline" size="sm" onClick={() => void handleSaveWizardDraft()} disabled={wizardSavingDraft}>
                      {wizardSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      임시저장
                    </Button>
                  </div>
                  <div className="space-y-2 px-4 py-4 text-[12px] leading-5 text-slate-600">
                    <p>원본 통장내역은 수정하지 않습니다.</p>
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

                <div className="mt-4 rounded border bg-white">
                  <div className="border-b bg-slate-100 px-4 py-3 text-[13px] font-bold text-slate-900">
                    작성 정책
                  </div>
                  <div className="space-y-2 px-4 py-4 text-[12px] leading-5 text-slate-600">
                    <p>거래처 제안은 자동완성일 뿐 자동확정하지 않습니다.</p>
                    <p>선택 행 일괄적용은 위자드 임시 입력값에만 적용합니다.</p>
                    <p>확정 시 Java API가 행/셀 검증 후 사업비 입력에 반영합니다.</p>
                  </div>
                </div>
              </aside>

              <section className="min-w-0 overflow-auto p-5">
                <div className="min-w-[980px]">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[12px] text-slate-500">Ctrl+Z / Command+Z는 이 위자드 입력만 되돌립니다.</div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={handleWizardUndo} disabled={wizardHistory.length === 0}>
                        되돌리기
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleBulkApplyWizardDraft} disabled={wizardSelectedRowKeys.size < 2}>
                        선택 행 일괄적용
                      </Button>
                    </div>
                  </div>
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-slate-100 text-left">
                        <th className="w-10 border px-2 py-2">
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
                        <th className="w-12 border px-2 py-2">행</th>
                        <th className="w-[280px] border px-3 py-2">통장내역 원본</th>
                        {WIZARD_FIELDS.map((field) => (
                          <th key={field.key} className="border px-3 py-2">
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
                        return (
                          <tr key={rowKey} className="align-top">
                            <td className="border bg-slate-50 px-2 py-2 text-center">
                              <Checkbox
                                checked={wizardSelectedRowKeys.has(rowKey)}
                                onCheckedChange={(checked) => toggleWizardRowSelection(rowKey, Boolean(checked))}
                                aria-label={`${rowIdx + 1}행 위자드 선택`}
                              />
                            </td>
                            <td className="border bg-slate-50 px-2 py-2 text-center text-[11px] text-slate-500">
                              {rowIdx + 1}
                            </td>
                            <td className="border px-3 py-2">
                              <div className="space-y-1 text-[12px] text-slate-700">
                                {(previewCells.length > 0 ? previewCells : ['원본 셀 없음']).map((cell, idx) => (
                                  <div key={`${rowKey}-raw-${idx}`} className="truncate">
                                    {cell}
                                  </div>
                                ))}
                                {suggestion ? (
                                  <button
                                    type="button"
                                    className="mt-2 border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                                    onClick={() => handleApplySuggestion(rowKey, suggestion)}
                                  >
                                    이전 거래처 조합 적용
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            {WIZARD_FIELDS.map((field) => (
                              <td key={field.key} className="border px-2 py-2">
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

            <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-6 py-4">
              <Button variant="outline" size="sm" onClick={closeWizard} disabled={saving}>
                취소
              </Button>
              <Button size="sm" onClick={() => void handleSubmitWizard()} disabled={saving || wizardRows.length === 0}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                작성 내용 반영
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
