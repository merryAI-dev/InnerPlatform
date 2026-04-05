import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AccountType,
  BudgetCodeEntry,
  BudgetCodeRename,
  BudgetPlanRow,
  ProjectSheetSourceSnapshot,
  SettlementType,
} from '../../data/types';
import {
  type ActorLike,
  analyzeGoogleSheetImportViaBff,
  type GoogleSheetMigrationAnalysisResult,
  type GoogleSheetImportPreviewResult,
  normalizeGoogleSheetMigrationAnalysisResult,
  previewGoogleSheetImportViaBff,
  uploadProjectSheetSourceViaBff,
} from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';
import {
  GOOGLE_SHEET_PROTECTED_HEADERS,
  planGoogleSheetImportMerge,
  type GoogleSheetImportMergeSummary,
} from '../../platform/google-sheet-import';
import {
  buildDevGoogleSheetImportPreview,
  DEV_GOOGLE_SHEET_SAMPLE_VALUE,
} from '../../platform/google-sheet-migration.samples';
import {
  analyzeSettlementHeaderMapping,
  buildSettlementDataPreview,
  normalizeMatrixToImportRows,
  SETTLEMENT_COLUMNS,
  type ImportRow,
  type SettlementHeaderAnalysis,
} from '../../platform/settlement-csv';
import { getYearMondayWeeks } from '../../platform/cashflow-weeks';
import {
  describeGoogleSheetMigrationTarget,
  parseBankStatementMatrix,
  parseBudgetPlanMatrix,
  parseCashflowProjectionMatrix,
  parseEvidenceRuleMatrix,
  planBudgetPlanMerge,
  resolveProjectSheetSourceType,
  type BudgetPlanMergePlan,
  type CashflowProjectionImportPayload,
  type GoogleSheetMigrationDescriptor,
} from '../../platform/google-sheet-migration';
import { parseLocalWorkbookFile, type LocalWorkbookSheet } from '../../platform/local-workbook';
import { reportError } from '../../platform/observability';
import { buildSettlementActualSyncPayloadWithKernel } from '../../platform/settlement-calculation-kernel';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

type GoogleSheetWizardStep = 'source' | 'sheet' | 'review' | 'apply';

type BankStatementImportSheet = ReturnType<typeof parseBankStatementMatrix>;
const GOOGLE_SHEET_AI_MAX_ROWS = 40;
const GOOGLE_SHEET_AI_MAX_COLS = 24;

interface GoogleSheetSummaryStat {
  label: string;
  value: string;
}

interface GoogleSheetMigrationReviewState {
  descriptor: GoogleSheetMigrationDescriptor;
  applySupported: boolean;
  applyButtonLabel: string;
  applyHint: string;
  summaryStats: GoogleSheetSummaryStat[];
  expenseRows?: ImportRow[];
  expenseSheetAnalysis?: SettlementHeaderAnalysis;
  mergeSummary?: GoogleSheetImportMergeSummary;
  budgetPlanMerge?: BudgetPlanMergePlan;
  bankSheet?: BankStatementImportSheet;
  evidenceRuleMap?: Record<string, string>;
  cashflowProjection?: CashflowProjectionImportPayload;
}

interface GoogleSheetMigrationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  projectId: string;
  projectName: string;
  projectSettlementType?: SettlementType;
  projectAccountType?: AccountType;
  activeSheetName: string;
  bffActor: ActorLike;
  expenseSheetRows: ImportRow[];
  budgetPlanRows: BudgetPlanRow[];
  evidenceRequiredMap: Record<string, string>;
  sheetSources: ProjectSheetSourceSnapshot[];
  devHarnessEnabled: boolean;
  ensureGoogleWorkspaceAccess: () => Promise<string | null | undefined>;
  saveExpenseSheetRows: (rows: ImportRow[]) => Promise<ImportRow[] | void>;
  saveBudgetPlanRows: (rows: BudgetPlanRow[]) => Promise<void>;
  saveBudgetCodeBook: (rows: BudgetCodeEntry[], renames?: BudgetCodeRename[]) => Promise<void>;
  saveBankStatementRows: (sheet: BankStatementImportSheet) => Promise<void>;
  saveEvidenceRequiredMap: (map: Record<string, string>) => Promise<void>;
  markSheetSourceApplied: (input: { sourceType: ProjectSheetSourceSnapshot['sourceType']; applyTarget: string }) => Promise<void>;
  upsertWeekAmounts: (input: {
    projectId: string;
    yearMonth: string;
    weekNo: number;
    mode: 'projection' | 'actual';
    amounts: Record<string, number>;
  }) => Promise<void>;
  previewActualSyncViaRust?: (
    rows: ImportRow[],
    yearWeeks: ReturnType<typeof getYearMondayWeeks>,
    persistedRows?: ImportRow[] | null,
  ) => Promise<ReturnType<typeof buildSettlementActualSyncPayloadWithKernel>>;
}

function getGoogleSheetWizardStepLabel(step: GoogleSheetWizardStep): string {
  switch (step) {
    case 'source':
      return '1. 소스 연결';
    case 'sheet':
      return '2. 탭 선택';
    case 'review':
      return '3. 미리보기';
    case 'apply':
      return '4. 안전 반영';
    default:
      return '';
  }
}

function resolveApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlatformApiError) {
    const message = typeof error.body === 'object' && error.body && 'message' in (error.body as Record<string, unknown>)
      ? String((error.body as Record<string, unknown>).message || '')
      : error.message;
    return message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function buildAnalysisMatrixSample(matrix: string[][]): string[][] {
  return (matrix || [])
    .slice(0, GOOGLE_SHEET_AI_MAX_ROWS)
    .map((row) => (row || []).slice(0, GOOGLE_SHEET_AI_MAX_COLS).map((cell) => String(cell ?? '')));
}

function buildStoredPreviewMatrix(matrix: string[][]): string[][] {
  return (matrix || [])
    .slice(0, 60)
    .map((row) => (row || []).slice(0, 24).map((cell) => String(cell ?? '')));
}

function formatHeaderRowTrace(headerRowIndices: number[]): string {
  if (!headerRowIndices.length) return '-';
  return headerRowIndices.map((index) => `${index + 1}행`).join(' + ');
}

function formatFieldList(items: string[], emptyLabel = '-'): string {
  return items.length > 0 ? items.join(', ') : emptyLabel;
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('파일 읽기에 실패했습니다.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

  const [, base64 = ''] = dataUrl.split(',', 2);
  if (!base64) {
    throw new Error(`파일 인코딩에 실패했습니다: ${file.name}`);
  }
  return base64;
}

interface LocalWorkbookState {
  file: File;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheets: LocalWorkbookSheet[];
}

type PreviewSourceMode = 'google_sheet' | 'local_workbook' | 'saved_source';

function buildLocalWorkbookPreview(
  workbook: LocalWorkbookState,
  sheetName: string,
): GoogleSheetImportPreviewResult {
  const selectedSheet = workbook.sheets.find((sheet) => sheet.name === sheetName) || workbook.sheets[0];
  return {
    spreadsheetId: workbook.spreadsheetId,
    spreadsheetTitle: workbook.spreadsheetTitle,
    selectedSheetName: selectedSheet?.name || '',
    availableSheets: workbook.sheets.map((sheet, index) => ({
      sheetId: index,
      title: sheet.name,
      index,
    })),
    matrix: selectedSheet?.matrix || [],
  };
}

function buildSavedSourcePreview(source: ProjectSheetSourceSnapshot): GoogleSheetImportPreviewResult {
  return {
    spreadsheetId: `saved:${source.sourceType}:${source.uploadedAt}`,
    spreadsheetTitle: source.fileName,
    selectedSheetName: source.sheetName,
    availableSheets: [
      { sheetId: 0, title: source.sheetName, index: 0 },
    ],
    matrix: source.previewMatrix || [],
  };
}

function summarizeSourceHeaders(
  descriptor: GoogleSheetMigrationDescriptor,
  matrix: string[][],
): { matchedColumns: string[]; unmatchedColumns: string[] } {
  if (descriptor.target === 'expense_sheet') {
    const summary = analyzeSettlementHeaderMapping(matrix);
    return {
      matchedColumns: summary.matchedHeaders,
      unmatchedColumns: summary.unmatchedHeaders,
    };
  }

  const headers = (matrix.find((row) => (row || []).some((cell) => String(cell || '').trim())) || [])
    .map((cell) => String(cell || '').trim())
    .filter(Boolean);
  if (headers.length === 0) {
    return { matchedColumns: [], unmatchedColumns: [] };
  }

  const headerSet = new Set(headers);
  const matchIfIncludes = (needles: string[]) => headers.filter((header) => needles.some((needle) => header.includes(needle)));
  let matchedColumns: string[] = [];
  switch (descriptor.target) {
    case 'budget_plan':
      matchedColumns = [
        ...matchIfIncludes(['구분', '사업비 구분']),
        ...matchIfIncludes(['비목']),
        ...matchIfIncludes(['세목']),
        ...matchIfIncludes(['최초 승인 예산']),
        ...matchIfIncludes(['변경 승인 예산', '변경 예산']),
        ...matchIfIncludes(['산정 내역', '특이사항']),
      ];
      break;
    case 'evidence_rules':
      matchedColumns = [
        ...matchIfIncludes(['비목']),
        ...matchIfIncludes(['세목']),
        ...matchIfIncludes(['필수 증빙 자료', '사전 업로드']),
        ...matchIfIncludes(['회계법인 추가 요청했던 자료', '사후 업로드']),
      ];
      break;
    case 'bank_statement':
      matchedColumns = matchIfIncludes(['거래일시', '적요', '출금', '입금', '잔액']);
      break;
    case 'cashflow_projection':
      matchedColumns = matchIfIncludes(['구분']);
      break;
    case 'cashflow_guide':
      matchedColumns = matchIfIncludes(['구분']);
      break;
    default:
      matchedColumns = [];
  }
  const dedupedMatched = Array.from(new Set(matchedColumns)).filter((header) => headerSet.has(header));
  return {
    matchedColumns: dedupedMatched,
    unmatchedColumns: headers.filter((header) => !dedupedMatched.includes(header)),
  };
}

export function GoogleSheetMigrationWizard({
  open,
  onOpenChange,
  orgId,
  projectId,
  projectName,
  projectSettlementType,
  projectAccountType,
  activeSheetName,
  bffActor,
  expenseSheetRows,
  budgetPlanRows,
  evidenceRequiredMap,
  sheetSources,
  devHarnessEnabled,
  ensureGoogleWorkspaceAccess,
  saveExpenseSheetRows,
  saveBudgetPlanRows,
  saveBudgetCodeBook,
  saveBankStatementRows,
  saveEvidenceRequiredMap,
  markSheetSourceApplied,
  upsertWeekAmounts,
  previewActualSyncViaRust,
}: GoogleSheetMigrationWizardProps) {
  const [step, setStep] = useState<GoogleSheetWizardStep>('source');
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<GoogleSheetImportPreviewResult | null>(null);
  const [previewSourceMode, setPreviewSourceMode] = useState<PreviewSourceMode>('google_sheet');
  const [selectedSavedSource, setSelectedSavedSource] = useState<ProjectSheetSourceSnapshot | null>(null);
  const [localWorkbook, setLocalWorkbook] = useState<LocalWorkbookState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [sourceUploadingKey, setSourceUploadingKey] = useState('');
  const [analysis, setAnalysis] = useState<GoogleSheetMigrationAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisKey, setAnalysisKey] = useState('');
  const [pendingSheetName, setPendingSheetName] = useState('');
  const isENaraProject = projectSettlementType === 'TYPE5' || projectAccountType === 'DEDICATED';

  useEffect(() => {
    if (open) return;
    setStep('source');
    setLink('');
    setPreview(null);
    setPreviewSourceMode('google_sheet');
    setSelectedSavedSource(null);
    setLocalWorkbook(null);
    setPreviewing(false);
    setApplying(false);
    setSourceUploadingKey('');
    setAnalysis(null);
    setAnalysisLoading(false);
    setAnalysisError('');
    setAnalysisKey('');
    setPendingSheetName('');
  }, [open]);

  const selectedDescriptor = useMemo(
    () => describeGoogleSheetMigrationTarget(preview?.selectedSheetName || ''),
    [preview?.selectedSheetName],
  );
  const showAnalysisAssist = Boolean(preview?.selectedSheetName) && selectedDescriptor.target === 'preview_only';

  const reviewState = useMemo<GoogleSheetMigrationReviewState | null>(() => {
    if (!preview) return null;

    const descriptor = selectedDescriptor;
    const finalizeReviewState = (state: GoogleSheetMigrationReviewState): GoogleSheetMigrationReviewState => {
      if (previewSourceMode !== 'saved_source') return state;
      return {
        ...state,
        applySupported: false,
        applyButtonLabel: '저장된 원본 미리보기',
        applyHint: '저장된 원본은 read-only preview 입니다. 다시 반영하려면 Google Sheets 또는 로컬 워크북을 다시 불러오세요.',
      };
    };
    switch (descriptor.target) {
      case 'expense_sheet': {
        const expenseSheetAnalysis = analyzeSettlementHeaderMapping(preview.matrix);
        const expenseRows = normalizeMatrixToImportRows(preview.matrix);
        const mergePlan = planGoogleSheetImportMerge(expenseSheetRows, expenseRows);
        return finalizeReviewState({
          descriptor,
          applySupported: mergePlan.summary.importedCount > 0,
          applyButtonLabel: `${activeSheetName}에 안전 반영`,
          applyHint: '빈 셀은 기존 값을 지우지 않고, Drive 링크 컬럼은 유지합니다. 캐시플로 actual은 출금 row에서 사업비 사용액을 우선 사용합니다.',
          summaryStats: [
            { label: '가져온 행', value: `${mergePlan.summary.importedCount}건` },
            { label: '신규 추가', value: `${mergePlan.summary.createCount}건` },
            { label: '기존 업데이트', value: `${mergePlan.summary.updateCount}건` },
            { label: '그대로 유지', value: `${mergePlan.summary.unchangedCount}건` },
            { label: '헤더 선택', value: formatHeaderRowTrace(expenseSheetAnalysis.headerRowIndices) },
            { label: '핵심 필드', value: `${expenseSheetAnalysis.matchedCriticalFields.length}/${expenseSheetAnalysis.matchedCriticalFields.length + expenseSheetAnalysis.unmatchedCriticalFields.length}` },
          ],
          expenseRows,
          expenseSheetAnalysis,
          mergeSummary: mergePlan.summary,
        });
      }
      case 'budget_plan': {
        const parsed = parseBudgetPlanMatrix(preview.matrix);
        const mergePlan = planBudgetPlanMerge(budgetPlanRows, parsed.rows);
        return finalizeReviewState({
          descriptor,
          applySupported: parsed.rows.length > 0,
          applyButtonLabel: '예산/비목 세목 교체 반영',
          applyHint: '가져온 예산총괄시트를 기준으로 현재 예산/비목·세목 구성을 교체합니다. 기존에만 있던 항목은 제거됩니다.',
          summaryStats: [
            { label: '가져온 행', value: `${parsed.rows.length}건` },
            { label: '비목 수', value: `${mergePlan.importedCodeBook.length}개` },
            { label: '신규 추가', value: `${mergePlan.summary.createCount}건` },
            { label: '기존 교체', value: `${mergePlan.summary.updateCount}건` },
          ],
          budgetPlanMerge: mergePlan,
        });
      }
      case 'bank_statement': {
        const bankSheet = parseBankStatementMatrix(preview.matrix);
        return finalizeReviewState({
          descriptor,
          applySupported: bankSheet.rows.length > 0,
          applyButtonLabel: '통장내역 반영',
          applyHint: '통장 원본 스냅샷을 갱신합니다. 드라이브/증빙 정보에는 영향을 주지 않습니다.',
          summaryStats: [
            { label: '컬럼 수', value: `${bankSheet.columns.length}개` },
            { label: '행 수', value: `${bankSheet.rows.length}건` },
            { label: '프로파일', value: bankSheet.columns[0] ? '자동 정규화' : '헤더 확인 필요' },
          ],
          bankSheet,
        });
      }
      case 'evidence_rules': {
        const parsed = parseEvidenceRuleMatrix(preview.matrix);
        return finalizeReviewState({
          descriptor,
          applySupported: Object.keys(parsed.map).length > 0,
          applyButtonLabel: '증빙 매핑 반영',
          applyHint: '가져온 비목/세목 규칙만 덮어쓰고, 기존에 없는 키는 유지합니다.',
          summaryStats: [
            { label: '가져온 규칙', value: `${Object.keys(parsed.map).length}개` },
            { label: '기존 규칙', value: `${Object.keys(evidenceRequiredMap || {}).length}개` },
          ],
          evidenceRuleMap: parsed.map,
        });
      }
      case 'cashflow_projection': {
        const parsed = parseCashflowProjectionMatrix(preview.matrix);
        const amountCellCount = parsed.sheets.reduce((total, sheet) => total + Object.keys(sheet.amounts).length, 0);
        const yearMonthCount = new Set(parsed.sheets.map((sheet) => sheet.yearMonth)).size;
        return finalizeReviewState({
          descriptor,
          applySupported: parsed.sheets.length > 0,
          applyButtonLabel: '캐시플로우 projection 반영',
          applyHint: 'projection만 반영합니다. actual은 거래 데이터에서 계속 재계산됩니다.',
          summaryStats: [
            { label: '주차 문서', value: `${parsed.sheets.length}개` },
            { label: '월 수', value: `${yearMonthCount}개월` },
            { label: '입력 셀', value: `${amountCellCount}칸` },
          ],
          cashflowProjection: parsed,
        });
      }
      case 'cashflow_guide': {
        const parsed = parseCashflowProjectionMatrix(preview.matrix);
        const amountCellCount = parsed.sheets.reduce((total, sheet) => total + Object.keys(sheet.amounts).length, 0);
        const yearMonthCount = new Set(parsed.sheets.map((sheet) => sheet.yearMonth)).size;
        return finalizeReviewState({
          descriptor,
          applySupported: false,
          applyButtonLabel: '가이드 탭은 preview only',
          applyHint: parsed.sheets.length > 0
            ? '이 탭은 자동 반영하지 않습니다. 주차 구조를 참고한 뒤 캐시플로우 compare 화면에서 Projection/Actual을 함께 보며 복붙하거나 수동 조정하세요.'
            : 'guide 탭은 계산 source가 아니라 참고용입니다. 실제 projection 반영은 cashflow(사용내역 연동) 같은 계산 탭에서만 진행하세요.',
          summaryStats: [
            { label: '감지 주차', value: `${parsed.sheets.length}개` },
            { label: '감지 월 수', value: `${yearMonthCount}개월` },
            { label: '참고 셀', value: `${amountCellCount}칸` },
            { label: '반영 방식', value: 'preview only' },
          ],
          cashflowProjection: parsed,
        });
      }
      default:
        return finalizeReviewState({
          descriptor,
          applySupported: false,
          applyButtonLabel: '현재는 preview only',
          applyHint: `${descriptor.recommendedScreen} 전용 migration 단계에서 처리하는 것이 안전합니다.`,
          summaryStats: [
            { label: '탭 상태', value: descriptor.readinessLabel },
          ],
        });
    }
  }, [
    activeSheetName,
    budgetPlanRows,
    evidenceRequiredMap,
    expenseSheetRows,
    preview,
    previewSourceMode,
    selectedDescriptor,
  ]);

  useEffect(() => {
    if (!preview || step === 'source') return;
    const key = `${preview.spreadsheetId}:${preview.selectedSheetName}`;
    if (!showAnalysisAssist) {
      setAnalysis(null);
      setAnalysisLoading(false);
      setAnalysisError('');
      setAnalysisKey(key);
      return;
    }
    if (analysisLoading || analysisKey === key) return;

    let cancelled = false;
    setAnalysisLoading(true);
    setAnalysisError('');

    void analyzeGoogleSheetImportViaBff({
      tenantId: orgId,
      actor: bffActor,
      projectId,
      spreadsheetTitle: preview.spreadsheetTitle,
      selectedSheetName: preview.selectedSheetName,
      matrix: buildAnalysisMatrixSample(preview.matrix),
    }).then((result) => {
      if (cancelled) return;
      setAnalysis(result);
      setAnalysisKey(key);
    }).catch((error) => {
      if (cancelled) return;
      setAnalysis(null);
      setAnalysisError(resolveApiErrorMessage(error, '추가 분석을 불러오지 못했습니다.'));
    }).finally(() => {
      if (cancelled) return;
      setAnalysisLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    analysisKey,
    analysisLoading,
    bffActor,
    orgId,
    preview,
    projectId,
    showAnalysisAssist,
    step,
  ]);

  const persistLocalSheetSource = async (
    workbook: LocalWorkbookState,
    nextPreview: GoogleSheetImportPreviewResult,
  ) => {
    const descriptor = describeGoogleSheetMigrationTarget(nextPreview.selectedSheetName);
    const sourceType = resolveProjectSheetSourceType(descriptor.target);
    if (!sourceType) return;
    const uploadKey = `${sourceType}:${nextPreview.selectedSheetName}`;
    setSourceUploadingKey(uploadKey);
    try {
      const { matchedColumns, unmatchedColumns } = summarizeSourceHeaders(descriptor, nextPreview.matrix);
      const contentBase64 = await readFileAsBase64(workbook.file);
      await uploadProjectSheetSourceViaBff({
        tenantId: orgId,
        actor: bffActor,
        projectId,
        upload: {
          sourceType,
          sheetName: nextPreview.selectedSheetName,
          fileName: workbook.file.name,
          mimeType: workbook.file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: workbook.file.size,
          contentBase64,
          rowCount: nextPreview.matrix.length,
          columnCount: Math.max(...nextPreview.matrix.map((row) => row.length), 0),
          matchedColumns,
          unmatchedColumns,
          previewMatrix: buildStoredPreviewMatrix(nextPreview.matrix),
          applyTarget: descriptor.target,
        },
      });
    } catch (error) {
      reportError(error, {
        message: '[GoogleSheetMigrationWizard] source upload failed:',
        options: {
          level: 'error',
          tags: {
            surface: 'google_sheet_migration',
            action: 'source_upload',
          },
          extra: {
            projectId,
            sourceType,
            sheetName: nextPreview.selectedSheetName,
            actorId: bffActor.uid,
          },
        },
      });
      toast.error(resolveApiErrorMessage(error, '원본 워크북 저장에 실패했습니다.'));
    } finally {
      setSourceUploadingKey((current) => (current === uploadKey ? '' : current));
    }
  };

  const handleLocalWorkbookUpload = async (file: File) => {
    setPendingSheetName('');
    setPreviewing(true);
    try {
      const sheets = await parseLocalWorkbookFile(file);
      if (sheets.length === 0) {
        throw new Error('파일에서 읽을 수 있는 시트를 찾지 못했습니다.');
      }
      const workbook: LocalWorkbookState = {
        file,
        spreadsheetId: `local:${Date.now()}:${file.name}`,
        spreadsheetTitle: file.name,
        sheets,
      };
      setLocalWorkbook(workbook);
      setSelectedSavedSource(null);
      setPreviewSourceMode('local_workbook');
      setPreview(buildLocalWorkbookPreview(workbook, sheets[0]?.name || ''));
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      setStep('sheet');
      toast.success(`로컬 워크북 미리보기 완료: ${file.name}`);
    } catch (error) {
      reportError(error, {
        message: '[GoogleSheetMigrationWizard] local workbook preview failed:',
        options: {
          level: 'error',
          tags: {
            surface: 'google_sheet_migration',
            action: 'local_workbook_preview',
          },
          extra: {
            projectId,
            fileName: file.name,
            fileSize: file.size,
            actorId: bffActor.uid,
          },
        },
      });
      setLocalWorkbook(null);
      setPreview(null);
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      toast.error(resolveApiErrorMessage(error, '로컬 워크북을 읽지 못했습니다.'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSavedSourcePreview = (source: ProjectSheetSourceSnapshot) => {
    setSelectedSavedSource(source);
    setLocalWorkbook(null);
    setPreviewSourceMode('saved_source');
    setPreview(buildSavedSourcePreview(source));
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisKey('');
    setStep('review');
  };

  const previewGoogleSheetImport = async (sheetName?: string) => {
    const trimmedLink = link.trim();
    if (!trimmedLink) {
      toast.error('Google Sheets 링크 또는 spreadsheet ID를 입력해 주세요.');
      return;
    }

    if (devHarnessEnabled && trimmedLink === DEV_GOOGLE_SHEET_SAMPLE_VALUE) {
      setPendingSheetName(sheetName || '');
      const result = buildDevGoogleSheetImportPreview(sheetName);
      setPreview(result);
      setPreviewSourceMode('google_sheet');
      setSelectedSavedSource(null);
      setLocalWorkbook(null);
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      setLink(trimmedLink);
      setStep(sheetName ? 'review' : 'sheet');
      setPendingSheetName('');
      toast.success(`개발용 샘플 미리보기 완료: ${result.selectedSheetName}`);
      return;
    }

    setPendingSheetName(sheetName || '');
    setPreviewing(true);
    try {
      const googleAccessToken = bffActor.googleAccessToken || await ensureGoogleWorkspaceAccess() || undefined;
      const result = await previewGoogleSheetImportViaBff({
        tenantId: orgId,
        actor: {
          ...bffActor,
          ...(googleAccessToken ? { googleAccessToken } : {}),
        },
        projectId,
        value: trimmedLink,
        ...(sheetName ? { sheetName } : {}),
      });
      setPreview(result);
      setPreviewSourceMode('google_sheet');
      setSelectedSavedSource(null);
      setLocalWorkbook(null);
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      setLink(trimmedLink);
      setStep(sheetName ? 'review' : 'sheet');
      toast.success(`Google Sheets 미리보기 완료: ${result.selectedSheetName}`);
    } catch (error) {
      reportError(error, {
        message: '[GoogleSheetMigrationWizard] google sheet preview failed:',
        options: {
          level: 'error',
          tags: {
            surface: 'google_sheet_migration',
            action: 'google_sheet_preview',
          },
          extra: {
            projectId,
            actorId: bffActor.uid,
            sheetName: sheetName || '',
            sourceValue: trimmedLink,
          },
        },
      });
      setPreview(null);
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      toast.error(resolveApiErrorMessage(error, 'Google Sheets 미리보기에 실패했습니다.'));
    } finally {
      setPendingSheetName('');
      setPreviewing(false);
    }
  };

  const handleSelectSheet = (sheetName: string) => {
    if (localWorkbook && previewSourceMode === 'local_workbook') {
      const nextPreview = buildLocalWorkbookPreview(localWorkbook, sheetName);
      setPendingSheetName(sheetName);
      setPreview(nextPreview);
      setSelectedSavedSource(null);
      setAnalysis(null);
      setAnalysisError('');
      setAnalysisKey('');
      setStep('review');
      void persistLocalSheetSource(localWorkbook, nextPreview).finally(() => {
        setPendingSheetName('');
      });
      return;
    }
    void previewGoogleSheetImport(sheetName);
  };

  const applyGoogleSheetImport = async () => {
    if (!preview || !reviewState) {
      toast.error('먼저 Google Sheets 미리보기를 불러와 주세요.');
      return;
    }
    if (!reviewState.applySupported) {
      toast.error('현재 선택한 탭은 바로 반영할 수 없습니다.');
      return;
    }

    setApplying(true);
    try {
      switch (reviewState.descriptor.target) {
        case 'expense_sheet': {
          const expenseRows = reviewState.expenseRows || [];
          if (expenseRows.length === 0) throw new Error('가져올 데이터 행이 없습니다.');
          const mergePlan = planGoogleSheetImportMerge(expenseSheetRows, expenseRows);
          const persistedRows = await saveExpenseSheetRows(mergePlan.mergedRows);
          const actualPreviewRows = Array.isArray(persistedRows) ? persistedRows : mergePlan.mergedRows;
          const actualPayload = previewActualSyncViaRust
            ? await previewActualSyncViaRust(
              actualPreviewRows,
              getYearMondayWeeks(new Date().getFullYear()),
              expenseSheetRows,
            )
            : buildSettlementActualSyncPayloadWithKernel(
              actualPreviewRows,
              getYearMondayWeeks(new Date().getFullYear()),
              expenseSheetRows,
            );
          let actualSyncFailed = false;
          if (actualPayload.length > 0) {
            const results = await Promise.allSettled(
              actualPayload.map((sheet) => upsertWeekAmounts({
                projectId,
                yearMonth: sheet.yearMonth,
                weekNo: sheet.weekNo,
                mode: 'actual',
                amounts: sheet.amounts as Record<string, number>,
              })),
            );
            actualSyncFailed = results.some((result) => result.status === 'rejected');
            results.forEach((result) => {
              if (result.status === 'rejected') {
                reportError(result.reason, {
                  message: '[GoogleSheetMigrationWizard] expense sheet actual sync failed:',
                  options: {
                    level: 'error',
                    tags: {
                      surface: 'google_sheet_migration',
                      action: 'expense_sheet_actual_sync',
                    },
                    extra: {
                      projectId,
                      selectedSheetName: preview.selectedSheetName,
                    },
                  },
                });
              }
            });
          }
          if (actualSyncFailed) {
            toast.message(`Google Sheets ${mergePlan.summary.importedCount}건을 ${activeSheetName}에 반영했지만 캐시플로 actual 동기화는 일부 실패했습니다.`);
          } else {
            const cashflowSuffix = actualPayload.length > 0 ? ` · actual ${actualPayload.length}주차 동기화` : '';
            toast.success(`Google Sheets ${mergePlan.summary.importedCount}건을 ${activeSheetName}에 반영했습니다${cashflowSuffix}.`);
          }
          break;
        }
        case 'budget_plan': {
          const budgetPlanMerge = reviewState.budgetPlanMerge;
          if (!budgetPlanMerge || budgetPlanMerge.importedRows.length === 0) throw new Error('가져올 예산 행이 없습니다.');
          await saveBudgetPlanRows(budgetPlanMerge.importedRows);
          await saveBudgetCodeBook(budgetPlanMerge.importedCodeBook);
          toast.success(`예산 ${budgetPlanMerge.summary.importedCount}건으로 교체 반영했습니다.`);
          break;
        }
        case 'bank_statement': {
          if (!reviewState.bankSheet || reviewState.bankSheet.rows.length === 0) throw new Error('가져올 통장내역이 없습니다.');
          await saveBankStatementRows(reviewState.bankSheet);
          toast.success(`통장내역 ${reviewState.bankSheet.rows.length}건을 반영했습니다.`);
          break;
        }
        case 'evidence_rules': {
          const nextMap = {
            ...(evidenceRequiredMap || {}),
            ...(reviewState.evidenceRuleMap || {}),
          };
          if (Object.keys(nextMap).length === 0) throw new Error('가져올 증빙 규칙이 없습니다.');
          await saveEvidenceRequiredMap(nextMap);
          toast.success(`증빙 매핑 ${Object.keys(reviewState.evidenceRuleMap || {}).length}건을 반영했습니다.`);
          break;
        }
        case 'cashflow_projection': {
          const sheets = reviewState.cashflowProjection?.sheets || [];
          if (sheets.length === 0) throw new Error('가져올 캐시플로우 projection이 없습니다.');
          await Promise.all(
            sheets.map((sheet) => upsertWeekAmounts({
              projectId,
              yearMonth: sheet.yearMonth,
              weekNo: sheet.weekNo,
              mode: 'projection',
              amounts: sheet.amounts,
            })),
          );
          toast.success(`캐시플로우 projection ${sheets.length}주차를 반영했습니다.`);
          break;
        }
        default:
          throw new Error('현재 선택한 탭은 바로 반영할 수 없습니다.');
      }
      const sourceType = resolveProjectSheetSourceType(reviewState.descriptor.target);
      if (sourceType) {
        await markSheetSourceApplied({
          sourceType,
          applyTarget: reviewState.descriptor.target,
        });
      }
      setStep('sheet');
    } catch (error) {
      reportError(error, {
        message: '[GoogleSheetMigrationWizard] apply failed:',
        options: {
          level: 'error',
          tags: {
            surface: 'google_sheet_migration',
            action: 'apply',
            applyTarget: reviewState.descriptor.target,
          },
          extra: {
            projectId,
            actorId: bffActor.uid,
            selectedSheetName: preview.selectedSheetName,
          },
        },
      });
      toast.error(resolveApiErrorMessage(error, 'Google Sheets 반영에 실패했습니다.'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <GoogleSheetImportDialog
      open={open}
      onOpenChange={onOpenChange}
      step={step}
      onStepChange={setStep}
      link={link}
      onLinkChange={(value) => {
        setLink(value);
        setPreview(null);
        setAnalysis(null);
        setAnalysisError('');
        setAnalysisKey('');
        setStep('source');
      }}
      preview={preview}
      activeSheetName={activeSheetName}
      projectName={projectName}
      isENaraProject={isENaraProject}
      reviewState={reviewState}
      analysis={analysis}
      analysisLoading={analysisLoading}
      analysisError={analysisError}
      showAnalysisAssist={showAnalysisAssist}
      pendingSheetName={pendingSheetName}
      devHarnessEnabled={devHarnessEnabled}
      sheetSources={sheetSources}
      previewSourceMode={previewSourceMode}
      selectedSavedSource={selectedSavedSource}
      sourceUploadingKey={sourceUploadingKey}
      previewing={previewing}
      applying={applying}
      onPreview={() => void previewGoogleSheetImport()}
      onSelectSheet={handleSelectSheet}
      onUploadLocalWorkbook={(file) => void handleLocalWorkbookUpload(file)}
      onLoadSavedSource={handleSavedSourcePreview}
      onApply={() => void applyGoogleSheetImport()}
    />
  );
}

function GoogleSheetImportDialog({
  open,
  onOpenChange,
  step,
  onStepChange,
  link,
  onLinkChange,
  preview,
  activeSheetName,
  projectName,
  isENaraProject,
  reviewState,
  analysis,
  analysisLoading,
  analysisError,
  showAnalysisAssist,
  pendingSheetName,
  devHarnessEnabled,
  sheetSources,
  previewSourceMode,
  selectedSavedSource,
  sourceUploadingKey,
  previewing,
  applying,
  onPreview,
  onSelectSheet,
  onUploadLocalWorkbook,
  onLoadSavedSource,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: GoogleSheetWizardStep;
  onStepChange: (step: GoogleSheetWizardStep) => void;
  link: string;
  onLinkChange: (value: string) => void;
  preview: GoogleSheetImportPreviewResult | null;
  activeSheetName: string;
  projectName: string;
  isENaraProject: boolean;
  reviewState: GoogleSheetMigrationReviewState | null;
  analysis: GoogleSheetMigrationAnalysisResult | null;
  analysisLoading: boolean;
  analysisError: string;
  showAnalysisAssist: boolean;
  pendingSheetName: string;
  devHarnessEnabled: boolean;
  sheetSources: ProjectSheetSourceSnapshot[];
  previewSourceMode: PreviewSourceMode;
  selectedSavedSource: ProjectSheetSourceSnapshot | null;
  sourceUploadingKey: string;
  previewing: boolean;
  applying: boolean;
  onPreview: () => void;
  onSelectSheet: (sheetName: string) => void;
  onUploadLocalWorkbook: (file: File) => void;
  onLoadSavedSource: (source: ProjectSheetSourceSnapshot) => void;
  onApply: () => void;
}) {
  const protectedHeaderSet = useMemo<Set<string>>(
    () => new Set<string>(GOOGLE_SHEET_PROTECTED_HEADERS),
    [],
  );
  const steps: GoogleSheetWizardStep[] = ['source', 'sheet', 'review', 'apply'];
  const currentStepIndex = steps.indexOf(step);
  const selectedSheetName = pendingSheetName || preview?.selectedSheetName || '';
  const selectedDescriptor = reviewState?.descriptor || describeGoogleSheetMigrationTarget(selectedSheetName);
  const applySupported = Boolean(reviewState?.applySupported);
  const navigationLocked = previewing || applying;
  const matrixPreview = useMemo(
    () => {
      const matrix = preview?.matrix || [];
      if (selectedDescriptor.target === 'expense_sheet') {
        return buildSettlementDataPreview(matrix, 24, 16);
      }
      return matrix.slice(0, 24).map((row) => row.slice(0, 16));
    },
    [preview?.matrix, selectedDescriptor.target],
  );

  const goPrev = () => {
    if (navigationLocked) return;
    if (currentStepIndex <= 0) return;
    onStepChange(steps[currentStepIndex - 1]);
  };

  const goNext = () => {
    if (navigationLocked) return;
    if (step === 'source') {
      if (!preview) return;
      onStepChange('sheet');
      return;
    }
    if (step === 'sheet') {
      if (!preview) return;
      onStepChange('review');
      return;
    }
    if (step === 'review') {
      if (!preview) return;
      onStepChange('apply');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!inset-0 !left-0 !top-0 !h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 sm:!max-w-none">
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="border-b px-4 py-4 sm:px-6">
            <DialogHeader className="gap-2 text-left">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base">Google Sheets Migration Wizard</DialogTitle>
                <Badge variant="outline" className="text-[10px]">{getGoogleSheetWizardStepLabel(step)}</Badge>
              </div>
              <DialogDescription>
                공통양식 워크북을 한 번에 덮어쓰지 않고, 소스 확인 → 탭 선택 → 미리보기 → 안전 반영 순서로 진행합니다.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-2 lg:grid-cols-4">
              {steps.map((stepKey, index) => {
                const isActive = stepKey === step;
                const isDone = index < currentStepIndex;
                return (
                  <button
                    key={stepKey}
                    type="button"
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors ${
                      isActive
                        ? 'border-sky-300 bg-sky-50 text-sky-950'
                        : isDone
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                    disabled={navigationLocked}
                    onClick={() => {
                      if (navigationLocked) return;
                      if (stepKey === 'source') onStepChange('source');
                      if (preview && (stepKey === 'sheet' || stepKey === 'review' || stepKey === 'apply')) {
                        onStepChange(stepKey);
                      }
                    }}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      isActive
                        ? 'border-sky-300 bg-white text-sky-700'
                        : isDone
                          ? 'border-emerald-300 bg-white text-emerald-700'
                          : 'border-slate-300 bg-white text-slate-500'
                    }`}>
                      {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{getGoogleSheetWizardStepLabel(stepKey)}</p>
                      <p className="truncate text-[10px] opacity-80">
                        {stepKey === 'source' && '링크 또는 spreadsheet ID 확인'}
                        {stepKey === 'sheet' && '워크북 탭 분류와 선택'}
                        {stepKey === 'review' && '가져올 구조와 병합 결과 검토'}
                        {stepKey === 'apply' && '보호 컬럼 확인 후 반영'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-h-0 overflow-auto px-4 py-5 sm:px-6">
              {step === 'source' && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                      <p className="text-sm font-semibold text-slate-950">이 wizard가 하는 일</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <SummaryStat label="지원 방식" value="Google Sheets + 로컬 업로드" />
                        <SummaryStat label="현재 직접 반영" value="예산·통장·사용내역·증빙·cashflow projection" />
                        <SummaryStat label="보호 대상" value="증빙/드라이브" />
                        <SummaryStat label="반영 위치" value={activeSheetName} />
                      </div>
                    </div>
                    {isENaraProject && (
                      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-[12px] text-violet-950">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">{projectName} · 이나라도움 흐름</p>
                            <p className="mt-1 text-violet-900/85">
                              예전 e나라도움 import 흐름을 현재 wizard에 다시 연결했습니다. 권장 순서는 통장내역 → cashflow(사용내역 연동) → 사용내역 → 예산총괄시트 → 증빙서류입니다. `cashflow(e나라도움 시 가이드)`는 참고용 preview로만 봅니다.
                            </p>
                          </div>
                          <Badge className="bg-violet-600 text-white hover:bg-violet-600">TYPE5 / 전용계좌</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {['통장내역', 'cashflow', '사용내역', '예산총괄시트', '증빙서류'].map((label) => (
                            <Badge key={label} variant="outline" className="border-violet-300 bg-white text-violet-900">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[12px] text-amber-950">
                      <p className="font-semibold">안전 규칙</p>
                      <ul className="mt-2 space-y-1 text-amber-900/90">
                        <li>빈 셀은 기존 값을 지우지 않습니다.</li>
                        <li>증빙 Drive 링크 컬럼은 덮어쓰지 않습니다.</li>
                        <li>탭 성격이 다른 경우 preview만 허용하고 반영은 막습니다.</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <p className="text-[12px] font-semibold text-slate-900">Google Sheets 링크 또는 ID</p>
                    <Input
                      value={link}
                      onChange={(event) => onLinkChange(event.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/... 또는 spreadsheet ID"
                      className="mt-3 text-[12px]"
                    />
                    <Button
                      type="button"
                      className="mt-3 w-full text-[12px]"
                      disabled={previewing}
                      onClick={onPreview}
                    >
                      {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                      워크북 스캔 시작
                    </Button>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      스캔이 완료되면 탭 목록과 현재 플랫폼에서 직접 반영 가능한 탭을 구분해서 보여줍니다.
                    </p>
                    {devHarnessEnabled && (
                      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-[11px] text-sky-950">
                        <p className="font-medium">로컬 샘플 미리보기</p>
                        <p className="mt-1 text-sky-900/80">
                          외부 Sheets 없이 wizard를 검증하려면 <code className="rounded bg-white px-1 py-0.5">{DEV_GOOGLE_SHEET_SAMPLE_VALUE}</code> 를 입력하세요.
                        </p>
                      </div>
                    )}
                    {preview && (
                      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-[11px] text-emerald-950">
                        <p className="font-semibold">{preview.spreadsheetTitle}</p>
                        <p className="mt-1 text-emerald-900/80">
                          총 {preview.availableSheets.length}개 탭을 확인했습니다. 다음 단계에서 탭별 성격을 보고 선택할 수 있습니다.
                        </p>
                      </div>
                    )}
                    <div className="mt-4 border-t pt-4">
                      <p className="text-[12px] font-semibold text-slate-900">로컬 워크북 업로드</p>
                      <Input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="mt-3 text-[12px]"
                        disabled={previewing}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) onUploadLocalWorkbook(file);
                          event.currentTarget.value = '';
                        }}
                      />
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        `사용내역` 원본은 apply와 별개로 read-only 보관용 snapshot도 함께 저장합니다.
                      </p>
                    </div>
                  </div>
                  {sheetSources.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[12px] font-semibold text-slate-900">최근 업로드한 원본 시트</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            저장된 원본은 read-only preview로 다시 열 수 있습니다.
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{sheetSources.length}건</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {sheetSources.map((source) => (
                          <div key={`${source.sourceType}-${source.uploadedAt}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-[11px]">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900">{source.sheetName}</p>
                                <p className="mt-1 truncate text-slate-600">{source.fileName}</p>
                              </div>
                              <Badge variant="outline" className="text-[10px]">{source.sourceType}</Badge>
                            </div>
                            <p className="mt-2 text-slate-600">
                              {source.rowCount}행 · {source.columnCount}열
                            </p>
                            <p className="mt-1 text-slate-500">
                              업로드: {source.uploadedAt ? source.uploadedAt.slice(0, 10) : '-'}
                            </p>
                            {source.lastAppliedAt && (
                              <p className="mt-1 text-emerald-700">
                                마지막 반영: {source.lastAppliedAt.slice(0, 10)}
                              </p>
                            )}
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 text-[11px]"
                                onClick={() => onLoadSavedSource(source)}
                              >
                                <Upload className="mr-1 h-3.5 w-3.5" />
                                미리보기
                              </Button>
                              {source.downloadURL && (
                                <a
                                  href={source.downloadURL}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-100"
                                >
                                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                  원본 열기
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-[12px] text-sky-950">
                    <p className="font-semibold">추가 분석</p>
                    <p className="mt-1 text-sky-900/85">
                      정규화된 탭은 바로 preview/apply 하고, 미분류 탭에서만 추가 분석을 시도합니다.
                    </p>
                  </div>
                </div>
              )}

              {step === 'sheet' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{preview?.spreadsheetTitle || '워크북 탭 선택'}</p>
                      <p className="text-[12px] text-muted-foreground">
                        현재 선택 탭: {selectedSheetName || '없음'}
                        {previewing && pendingSheetName ? ' · 새 탭 미리보기 불러오는 중' : ''}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{selectedDescriptor.readinessLabel}</Badge>
                  </div>
                  {showAnalysisAssist && (
                    <GoogleSheetMigrationAiInlineCard
                      analysis={analysis}
                      analysisLoading={analysisLoading}
                      analysisError={analysisError}
                      selectedSheetName={selectedSheetName}
                    />
                  )}
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(preview?.availableSheets || []).map((sheet) => {
                      const descriptor = describeGoogleSheetMigrationTarget(sheet.title);
                      const isSelected = sheet.title === selectedSheetName;
                      const isENaraRecommended = isENaraProject && (
                        sheet.title.includes('통장내역')
                        || sheet.title.includes('cashflow')
                        || sheet.title.includes('사용내역')
                        || sheet.title.includes('예산총괄')
                        || sheet.title.includes('증빙서류')
                      );
                      return (
                        <button
                          key={sheet.sheetId}
                          type="button"
                          className={`rounded-2xl border p-4 text-left transition-colors ${
                            isSelected
                              ? 'border-sky-300 bg-sky-50'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                          disabled={navigationLocked}
                          onClick={() => onSelectSheet(sheet.title)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-semibold text-slate-950">{sheet.title}</p>
                              <p className="mt-1 text-[11px] text-slate-600">{descriptor.description}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              {isENaraRecommended && (
                                <Badge variant="outline" className="text-[10px] border-violet-300 bg-violet-50 text-violet-900">
                                  이나라도움 추천
                                </Badge>
                              )}
                              <Badge variant={descriptor.applySupported ? 'default' : 'outline'} className="text-[10px]">
                                {descriptor.kindLabel}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                            <span>추천 화면: {descriptor.recommendedScreen}</span>
                            <span>{descriptor.readinessLabel}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 'review' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{preview?.spreadsheetTitle}</p>
                      <p className="text-[12px] text-muted-foreground">
                        탭: {selectedSheetName} · 활성 반영 대상: {activeSheetName}
                      </p>
                    </div>
                    <Badge variant={selectedDescriptor.applySupported ? 'default' : 'outline'} className="text-[10px]">
                      {selectedDescriptor.readinessLabel}
                    </Badge>
                  </div>
                  {reviewState?.descriptor.target === 'expense_sheet' ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {(reviewState.summaryStats || []).map((item) => (
                              <SummaryStat key={item.label} label={item.label} value={item.value} />
                            ))}
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-[12px] text-slate-700">
                            <p className="font-semibold text-slate-950">Parser trace</p>
                            <p className="mt-1">
                              선택된 헤더 행: {formatHeaderRowTrace(reviewState.expenseSheetAnalysis?.headerRowIndices || [])}
                            </p>
                            <p className="mt-2 text-[11px] text-slate-500">
                              핵심 매칭: {formatFieldList(reviewState.expenseSheetAnalysis?.matchedCriticalFields || [])}
                            </p>
                            <p className="mt-1 text-[11px] text-amber-700">
                              아직 비어 있는 핵심 필드: {formatFieldList(reviewState.expenseSheetAnalysis?.unmatchedCriticalFields || [])}
                            </p>
                            <p className="mt-2 text-[11px] text-slate-500">
                              actual 집계 기준: 입금은 통장에 찍힌 입/출금액, 출금은 사업비 사용액 우선 후 통장 금액 fallback
                            </p>
                          </div>
                        </div>
                        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
                          <table className="w-full border-separate border-spacing-0 text-[11px]">
                            <tbody>
                              {matrixPreview.length > 0 ? matrixPreview.map((row, rowIndex) => (
                                <tr key={`expense-raw-${rowIndex}`}>
                                  {row.map((cell, columnIndex) => (
                                    <td
                                      key={`expense-raw-${rowIndex}-${columnIndex}`}
                                      className={`border-b border-r px-2 py-2 align-top ${rowIndex < 4 ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700'}`}
                                    >
                                      {cell || <span className="text-slate-300">-</span>}
                                    </td>
                                  ))}
                                </tr>
                              )) : (
                                <tr>
                                  <td className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                                    미리보기할 데이터가 없습니다.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="min-w-[1480px]">
                        <table className="w-full border-separate border-spacing-0 text-[11px]">
                          <thead className="sticky top-0 z-10">
                            <tr>
                              {SETTLEMENT_COLUMNS.map((column) => {
                                const isProtected = protectedHeaderSet.has(column.csvHeader);
                                return (
                                  <th
                                    key={column.csvHeader}
                                    className={`border-b px-2 py-2 text-left font-semibold whitespace-nowrap ${isProtected ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-800'}`}
                                  >
                                    <div>{column.csvHeader}</div>
                                    <div className="mt-0.5 text-[10px] font-normal opacity-70">{column.group}</div>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {(reviewState.expenseRows || []).length > 0 ? (reviewState.expenseRows || []).map((row, rowIndex) => (
                              <tr key={`${row.tempId}-${rowIndex}`} className="align-top">
                                {SETTLEMENT_COLUMNS.map((column, columnIndex) => {
                                  const isProtected = protectedHeaderSet.has(column.csvHeader);
                                  return (
                                    <td
                                      key={`${row.tempId}-${column.csvHeader}`}
                                      className={`border-b px-2 py-2 whitespace-pre-wrap ${isProtected ? 'bg-amber-50/70 text-amber-950' : 'text-slate-800'}`}
                                    >
                                      {row.cells[columnIndex] || <span className="text-slate-300">-</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={SETTLEMENT_COLUMNS.length} className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                                  헤더는 읽었지만 가져올 데이터 행이 없습니다.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                      <div className="space-y-4">
                        <div className={`rounded-2xl px-4 py-4 text-[12px] ${selectedDescriptor.applySupported ? 'border border-sky-200 bg-sky-50 text-sky-950' : 'border border-amber-200 bg-amber-50 text-amber-950'}`}>
                          <p className="font-semibold">
                            {selectedDescriptor.kindLabel} 탭 {selectedDescriptor.applySupported ? '구조 확인 완료' : 'preview-only'}
                          </p>
                          <p className="mt-1 opacity-90">{selectedDescriptor.description}</p>
                          <p className="mt-2 text-[11px] opacity-80">추천 화면: {selectedDescriptor.recommendedScreen}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {(reviewState?.summaryStats || []).map((item) => (
                            <SummaryStat key={item.label} label={item.label} value={item.value} />
                          ))}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-[12px] text-slate-700">
                          <p className="font-semibold text-slate-950">반영 방식</p>
                          <p className="mt-1">
                            {reviewState?.applyHint || `${selectedDescriptor.recommendedScreen} 전용 migration 단계에서 처리하는 것이 안전합니다.`}
                          </p>
                          {reviewState?.budgetPlanMerge && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              병합 후 예산 행 {reviewState.budgetPlanMerge.mergedRows.length}건, 코드북 {reviewState.budgetPlanMerge.codeBook.length}개가 유지됩니다.
                            </p>
                          )}
                          {reviewState?.evidenceRuleMap && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              가져온 규칙 {Object.keys(reviewState.evidenceRuleMap).length}개를 기존 프로젝트 증빙 매핑에 합칩니다.
                            </p>
                          )}
                          {reviewState?.cashflowProjection && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              {reviewState.descriptor.target === 'cashflow_projection'
                                ? 'actual 값은 유지하고 projection 필드만 주차별로 upsert합니다.'
                                : '감지된 주차 구조를 참고용으로 보여줍니다. 실제 입력은 캐시플로우 compare 화면에서 projection/actual을 함께 보고 반영하세요.'}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
                        <table className="w-full border-separate border-spacing-0 text-[11px]">
                          <tbody>
                            {matrixPreview.length > 0 ? matrixPreview.map((row, rowIndex) => (
                              <tr key={`raw-${rowIndex}`}>
                                {row.map((cell, columnIndex) => (
                                  <td
                                    key={`raw-${rowIndex}-${columnIndex}`}
                                    className={`border-b border-r px-2 py-2 align-top ${rowIndex < 3 ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-700'}`}
                                  >
                                    {cell || <span className="text-slate-300">-</span>}
                                  </td>
                                ))}
                              </tr>
                            )) : (
                              <tr>
                                <td className="px-4 py-12 text-center text-[12px] text-muted-foreground">
                                  미리보기할 데이터가 없습니다.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 'apply' && (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <p className="text-sm font-semibold text-slate-950">반영 요약</p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        현재 선택한 탭은 <span className="font-medium text-slate-900">{selectedDescriptor.recommendedScreen}</span> 흐름에 반영됩니다.
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {(reviewState?.summaryStats || []).map((item) => (
                          <SummaryStat key={item.label} label={item.label} value={item.value} />
                        ))}
                      </div>
                    </div>
                    {reviewState?.descriptor.target === 'expense_sheet' ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                        <p className="text-[12px] font-semibold text-amber-950">보호 컬럼</p>
                        <p className="mt-1 text-[11px] text-amber-900/80">
                          아래 항목은 Google Sheets 값이 있어도 플랫폼 값을 덮어쓰지 않습니다.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {GOOGLE_SHEET_PROTECTED_HEADERS.map((header) => (
                            <span
                              key={header}
                              className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[10px] font-medium text-amber-900"
                            >
                              {header}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                        <p className="text-[12px] font-semibold text-slate-950">반영 메모</p>
                        <p className="mt-1 text-[11px] text-slate-700">
                          {reviewState?.applyHint || '현재 선택한 탭은 preview-only입니다.'}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-[12px] font-semibold text-slate-900">최종 확인</p>
                    <div className="mt-3 space-y-3 text-[12px] text-slate-700">
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <p className="font-medium text-slate-900">선택 탭</p>
                        <p className="mt-1">{selectedSheetName || '없음'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <p className="font-medium text-slate-900">탭 분류</p>
                        <p className="mt-1">{selectedDescriptor.kindLabel}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{selectedDescriptor.description}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="mt-4 w-full text-[12px]"
                      disabled={applying || previewing || !applySupported}
                      onClick={onApply}
                    >
                      {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                      {reviewState?.applyButtonLabel || '현재는 preview only'}
                    </Button>
                    {!selectedDescriptor.applySupported && (
                      <p className="mt-2 text-[11px] text-amber-700">
                        이 탭은 현재 wizard에서 직접 반영하지 않습니다. {selectedDescriptor.recommendedScreen} 전용 migration 단계에서 처리하는 것이 안전합니다.
                      </p>
                    )}
                    {selectedDescriptor.applySupported && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {reviewState?.applyHint || '현재 선택한 반영 방식의 안전 규칙을 따릅니다.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col border-t bg-slate-50/80 px-4 py-5 sm:px-5 2xl:border-t-0 2xl:border-l">
              <div className="space-y-3">
                <p className="text-[12px] font-semibold text-slate-900">현재 선택 상태</p>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px]">
                  <p className="font-medium text-slate-900">{preview?.spreadsheetTitle || '워크북 미선택'}</p>
                  <p className="mt-1 text-slate-600">탭: {selectedSheetName || '없음'}</p>
                  <p className="mt-1 text-slate-600">분류: {selectedDescriptor.kindLabel}</p>
                  <p className="mt-1 text-slate-600">
                    소스: {previewSourceMode === 'google_sheet'
                      ? 'Google Sheets'
                      : previewSourceMode === 'local_workbook'
                        ? '로컬 워크북'
                        : '저장된 원본'}
                  </p>
                  <p className="mt-1 text-slate-600">추천 화면: {selectedDescriptor.recommendedScreen}</p>
                </div>
                {preview && (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px]">
                    <p className="font-medium text-slate-900">탭 현황</p>
                    <p className="mt-1 text-slate-600">총 {preview.availableSheets.length}개 탭</p>
                    <p className="mt-1 text-slate-600">현재 active expense sheet: {activeSheetName}</p>
                    {selectedSavedSource?.uploadedAt && (
                      <p className="mt-1 text-slate-600">저장 시각: {selectedSavedSource.uploadedAt.replace('T', ' ').slice(0, 16)}</p>
                    )}
                    {sourceUploadingKey && (
                      <p className="mt-1 text-sky-700">원본 snapshot 저장 중…</p>
                    )}
                  </div>
                )}
                {showAnalysisAssist && (
                  <GoogleSheetMigrationAiPanel
                    analysis={analysis}
                    analysisLoading={analysisLoading}
                    analysisError={analysisError}
                    step={step}
                  />
                )}
              </div>
              <div className="mt-5 border-t pt-4 2xl:mt-auto">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 text-[12px]"
                    disabled={currentStepIndex === 0 || navigationLocked}
                    onClick={goPrev}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    이전
                  </Button>
                  {step !== 'apply' ? (
                    <Button
                      type="button"
                      className="flex-1 text-[12px]"
                      disabled={navigationLocked || (step === 'source' && !preview) || (step !== 'source' && !preview)}
                      onClick={goNext}
                    >
                      {previewing && pendingSheetName ? '탭 불러오는 중…' : '다음'}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="flex-1 text-[12px]"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      닫기
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[12px] font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function GoogleSheetMigrationAiInlineCard({
  analysis,
  analysisLoading,
  analysisError,
  selectedSheetName,
}: {
  analysis: GoogleSheetMigrationAnalysisResult | null;
  analysisLoading: boolean;
  analysisError: string;
  selectedSheetName: string;
}) {
  const safeAnalysis = analysis ? normalizeGoogleSheetMigrationAnalysisResult(analysis) : null;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-[12px] text-sky-950">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">탭 구조 분석</p>
        {safeAnalysis && (
          <Badge variant={safeAnalysis.provider === 'anthropic' ? 'default' : 'outline'} className="text-[10px]">
            {safeAnalysis.provider === 'anthropic' ? 'Merry의 분석' : '규칙 기반'}
          </Badge>
        )}
      </div>
      {!selectedSheetName ? (
        <p className="mt-2 text-sky-900/85">탭을 하나 선택하면 구조와 반영 포인트를 바로 정리합니다.</p>
      ) : analysisLoading ? (
        <div className="mt-2 flex items-center gap-2 text-sky-900/85">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{selectedSheetName} 탭을 분석하고 있습니다…</span>
        </div>
      ) : analysisError ? (
        <p className="mt-2 text-amber-900">{analysisError}</p>
      ) : safeAnalysis ? (
        <div className="mt-2 space-y-2">
          <p className="font-medium">{safeAnalysis.summary}</p>
          {safeAnalysis.warnings[0] && (
            <p className="text-[11px] text-amber-900">주의: {safeAnalysis.warnings[0]}</p>
          )}
          {safeAnalysis.nextActions[0] && (
            <p className="text-[11px] text-sky-900/85">추천: {safeAnalysis.nextActions[0]}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sky-900/85">선택한 탭에 대한 AI 분석을 준비 중입니다.</p>
      )}
    </div>
  );
}

function GoogleSheetMigrationAiPanel({
  analysis,
  analysisLoading,
  analysisError,
  step,
}: {
  analysis: GoogleSheetMigrationAnalysisResult | null;
  analysisLoading: boolean;
  analysisError: string;
  step: GoogleSheetWizardStep;
}) {
  const safeAnalysis = analysis ? normalizeGoogleSheetMigrationAnalysisResult(analysis) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-900">Migration assistant</p>
        {safeAnalysis && (
          <Badge variant={safeAnalysis.provider === 'anthropic' ? 'default' : 'outline'} className="text-[10px]">
            {safeAnalysis.provider === 'anthropic' ? 'Merry의 분석' : '규칙 기반'}
          </Badge>
        )}
      </div>
      {step === 'source' ? (
        <p className="mt-2 text-slate-600">
          시트를 불러오면 탭 구조를 읽고, 추천 매핑과 주의사항을 자동으로 정리합니다.
        </p>
      ) : analysisLoading ? (
        <div className="mt-3 flex items-center gap-2 text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>탭 구조를 읽고 있습니다…</span>
        </div>
      ) : analysisError ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-950">
          <p className="font-medium">분석을 불러오지 못했습니다.</p>
          <p className="mt-1 text-[10px] opacity-80">{analysisError}</p>
        </div>
      ) : safeAnalysis ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-900">요약</span>
              <Badge variant="outline" className="text-[10px]">
                신뢰도 {safeAnalysis.confidence}
              </Badge>
            </div>
            <p className="mt-1 text-slate-700">{safeAnalysis.summary}</p>
          </div>
          {safeAnalysis.usageTips.length > 0 && (
            <PanelList title="추천 사용 순서" items={safeAnalysis.usageTips} />
          )}
          {safeAnalysis.warnings.length > 0 && (
            <PanelList title="주의할 점" items={safeAnalysis.warnings} tone="amber" />
          )}
          {safeAnalysis.suggestedMappings.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
              <p className="font-medium text-slate-900">추천 매핑</p>
              <div className="mt-2 space-y-2">
                {safeAnalysis.suggestedMappings.map((item) => (
                  <div key={`${item.sourceHeader}-${item.platformField}`} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                    <p className="font-medium text-slate-900">{item.sourceHeader} → {item.platformField}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{item.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {safeAnalysis.nextActions.length > 0 && (
            <PanelList title="바로 해볼 일" items={safeAnalysis.nextActions} tone="emerald" />
          )}
        </div>
      ) : (
        <p className="mt-2 text-slate-600">아직 분석 결과가 없습니다.</p>
      )}
    </div>
  );
}

function PanelList({
  title,
  items,
  tone = 'slate',
}: {
  title: string;
  items: string[];
  tone?: 'slate' | 'amber' | 'emerald';
}) {
  const toneClasses = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : 'border-slate-200 bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-lg border px-3 py-3 ${toneClasses}`}>
      <p className="font-medium">{title}</p>
      <ul className="mt-2 space-y-1 text-[10px]">
        {items.map((item) => (
          <li key={`${title}-${item}`}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
