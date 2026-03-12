import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  FolderPlus,
  Loader2,
  Plus,
  Send,
  Settings2,
} from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { type EvidenceUploadSelection, SettlementLedgerPage } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import type { CashflowWeekSheet, Transaction, TransactionState } from '../../data/types';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import {
  type GoogleSheetImportPreviewResult,
  type ProvisionTransactionEvidenceDriveResult,
  type SyncTransactionEvidenceDriveResult,
  type UploadTransactionEvidenceDriveResult,
  previewGoogleSheetImportViaBff,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  syncTransactionEvidenceDriveViaBff,
  upsertTransactionViaBff,
  uploadTransactionEvidenceDriveViaBff,
} from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';
import { splitLooseNameList } from '../../platform/name-list';
import {
  GOOGLE_SHEET_PROTECTED_HEADERS,
  planGoogleSheetImportMerge,
  type GoogleSheetImportMergeSummary,
} from '../../platform/google-sheet-import';
import { normalizeMatrixToImportRows, SETTLEMENT_COLUMNS, type ImportRow } from '../../platform/settlement-csv';
import {
  describeGoogleSheetMigrationTarget,
  parseBankStatementMatrix,
  parseBudgetPlanMatrix,
  parseCashflowProjectionMatrix,
  parseEvidenceRuleMatrix,
  planBudgetPlanMerge,
  type BudgetPlanMergePlan,
  type CashflowProjectionImportPayload,
  type GoogleSheetMigrationDescriptor,
} from '../../platform/google-sheet-migration';
import {
  buildDevGoogleSheetImportPreview,
  DEV_GOOGLE_SHEET_SAMPLE_VALUE,
} from '../../platform/google-sheet-migration.samples';
import { readDevAuthHarnessConfig } from '../../platform/dev-harness';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';

function normalizeBudgetLabel(value: string): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
}

type GoogleSheetWizardStep = 'source' | 'sheet' | 'review' | 'apply';

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
  mergeSummary?: GoogleSheetImportMergeSummary;
  budgetPlanMerge?: BudgetPlanMergePlan;
  bankSheet?: ReturnType<typeof parseBankStatementMatrix>;
  evidenceRuleMap?: Record<string, string>;
  cashflowProjection?: CashflowProjectionImportPayload;
}

export function PortalWeeklyExpensePage() {
  const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();
  const { orgId } = useFirebase();
  const {
    portalUser,
    myProject,
    ledgers,
    transactions,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    evidenceRequiredMap,
    saveEvidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    createExpenseSheet,
    renameExpenseSheet,
    deleteExpenseSheet,
    expenseSheetRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetPlanRows,
    budgetCodeBook,
    saveBankStatementRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
  } = usePortalStore();
  const { submitWeekAsPm, upsertWeekAmounts } = useCashflowWeeks();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const [projectDriveProvisioning, setProjectDriveProvisioning] = useState(false);
  const [googleSheetImportOpen, setGoogleSheetImportOpen] = useState(false);
  const [googleSheetImportStep, setGoogleSheetImportStep] = useState<GoogleSheetWizardStep>('source');
  const [googleSheetImportLink, setGoogleSheetImportLink] = useState('');
  const [googleSheetImportPreview, setGoogleSheetImportPreview] = useState<GoogleSheetImportPreviewResult | null>(null);
  const [googleSheetPreviewing, setGoogleSheetPreviewing] = useState(false);
  const [googleSheetApplying, setGoogleSheetApplying] = useState(false);

  const projectId = portalUser?.projectId || '';
  const projectName = myProject?.name || '내 사업';
  const ledgerUserRole = portalUser?.role === 'pm' || portalUser?.role === 'viewer' ? 'pm' : 'admin';
  const visibleExpenseSheets = useMemo(() => (
    expenseSheets.length > 0
      ? expenseSheets
      : [{ id: 'default', name: '기본 탭', rows: expenseSheetRows, order: 0 }]
  ), [expenseSheets, expenseSheetRows]);
  const activeSheetName = useMemo(() => {
    return visibleExpenseSheets.find((sheet) => sheet.id === activeExpenseSheetId)?.name || visibleExpenseSheets[0]?.name || '기본 탭';
  }, [visibleExpenseSheets, activeExpenseSheetId]);

  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [projectId, ledgers]);

  const effectiveBudgetCodeBook = useMemo(() => {
    const orderedCodes: string[] = [];
    const subCodesByCode = new Map<string, Set<string>>();
    const pushEntry = (rawCode?: string | null, rawSub?: string | null) => {
      const code = normalizeBudgetLabel(rawCode || '');
      const sub = normalizeBudgetLabel(rawSub || '');
      if (!code || !sub) return;
      if (!subCodesByCode.has(code)) {
        subCodesByCode.set(code, new Set());
        orderedCodes.push(code);
      }
      subCodesByCode.get(code)!.add(sub);
    };

    budgetCodeBook.forEach((entry) => {
      const code = normalizeBudgetLabel(entry.code);
      if (!code) return;
      if (!subCodesByCode.has(code)) {
        subCodesByCode.set(code, new Set());
        orderedCodes.push(code);
      }
      entry.subCodes.forEach((subCode) => pushEntry(code, subCode));
    });
    (budgetPlanRows || []).forEach((row) => pushEntry(row.budgetCode, row.subCode));

    return orderedCodes.map((code) => ({
      code,
      subCodes: Array.from(subCodesByCode.get(code) || []),
    })).filter((entry) => entry.subCodes.length > 0);
  }, [budgetCodeBook, budgetPlanRows]);

  const authorOptions = useMemo(() => {
    const names = new Set<string>();
    const collectNames = (value?: string | null) => {
      splitLooseNameList(value).forEach((name) => names.add(name));
    };
    participationEntries
      .filter((e) => e.projectId === projectId)
      .forEach((e) => {
        collectNames(e.memberName);
      });
    collectNames(portalUser?.name);
    collectNames(myProject?.managerName);
    collectNames(myProject?.settlementSupportName);
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [participationEntries, projectId, portalUser?.name, myProject?.managerName, myProject?.settlementSupportName]);

  const bffActor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: authUser?.role || portalUser?.role || 'pm',
    idToken: authUser?.idToken,
    googleAccessToken: authUser?.googleAccessToken,
  }), [
    authUser?.uid,
    authUser?.email,
    authUser?.role,
    authUser?.idToken,
    authUser?.googleAccessToken,
    portalUser?.id,
    portalUser?.email,
    portalUser?.role,
  ]);
  const googleSheetSelectedDescriptor = useMemo(
    () => describeGoogleSheetMigrationTarget(googleSheetImportPreview?.selectedSheetName || ''),
    [googleSheetImportPreview?.selectedSheetName],
  );
  const googleSheetReviewState = useMemo<GoogleSheetMigrationReviewState | null>(() => {
    if (!googleSheetImportPreview) return null;

    const descriptor = googleSheetSelectedDescriptor;
    switch (descriptor.target) {
      case 'expense_sheet': {
        const expenseRows = normalizeMatrixToImportRows(googleSheetImportPreview.matrix);
        const mergePlan = planGoogleSheetImportMerge(expenseSheetRows, expenseRows);
        return {
          descriptor,
          applySupported: mergePlan.summary.importedCount > 0,
          applyButtonLabel: `${activeSheetName}에 안전 반영`,
          applyHint: '빈 셀은 기존 값을 지우지 않고, 드라이브/업로드 연동 컬럼은 유지합니다.',
          summaryStats: [
            { label: '가져온 행', value: `${mergePlan.summary.importedCount}건` },
            { label: '신규 추가', value: `${mergePlan.summary.createCount}건` },
            { label: '기존 업데이트', value: `${mergePlan.summary.updateCount}건` },
            { label: '그대로 유지', value: `${mergePlan.summary.unchangedCount}건` },
          ],
          expenseRows,
          mergeSummary: mergePlan.summary,
        };
      }
      case 'budget_plan': {
        const parsed = parseBudgetPlanMatrix(googleSheetImportPreview.matrix);
        const mergePlan = planBudgetPlanMerge(budgetPlanRows, parsed.rows);
        return {
          descriptor,
          applySupported: parsed.rows.length > 0,
          applyButtonLabel: '예산/비목 세목 반영',
          applyHint: '같은 비목/세목은 갱신하고, 없는 항목은 추가합니다. 기존 예산 외 다른 화면 값은 건드리지 않습니다.',
          summaryStats: [
            { label: '가져온 행', value: `${parsed.rows.length}건` },
            { label: '비목 수', value: `${mergePlan.codeBook.length}개` },
            { label: '신규 추가', value: `${mergePlan.summary.createCount}건` },
            { label: '기존 업데이트', value: `${mergePlan.summary.updateCount}건` },
          ],
          budgetPlanMerge: mergePlan,
        };
      }
      case 'bank_statement': {
        const bankSheet = parseBankStatementMatrix(googleSheetImportPreview.matrix);
        return {
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
        };
      }
      case 'evidence_rules': {
        const parsed = parseEvidenceRuleMatrix(googleSheetImportPreview.matrix);
        return {
          descriptor,
          applySupported: Object.keys(parsed.map).length > 0,
          applyButtonLabel: '증빙 매핑 반영',
          applyHint: '가져온 비목/세목 규칙만 덮어쓰고, 기존에 없는 키는 유지합니다.',
          summaryStats: [
            { label: '가져온 규칙', value: `${Object.keys(parsed.map).length}개` },
            { label: '기존 규칙', value: `${Object.keys(evidenceRequiredMap || {}).length}개` },
          ],
          evidenceRuleMap: parsed.map,
        };
      }
      case 'cashflow_projection': {
        const parsed = parseCashflowProjectionMatrix(googleSheetImportPreview.matrix);
        const amountCellCount = parsed.sheets.reduce((total, sheet) => total + Object.keys(sheet.amounts).length, 0);
        const yearMonthCount = new Set(parsed.sheets.map((sheet) => sheet.yearMonth)).size;
        return {
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
        };
      }
      default:
        return {
          descriptor,
          applySupported: false,
          applyButtonLabel: '현재는 preview only',
          applyHint: `${descriptor.recommendedScreen} 전용 migration 단계에서 처리하는 것이 안전합니다.`,
          summaryStats: [
            { label: '탭 상태', value: descriptor.readinessLabel },
          ],
        };
    }
  }, [
    activeSheetName,
    budgetPlanRows,
    evidenceRequiredMap,
    expenseSheetRows,
    googleSheetImportPreview,
    googleSheetSelectedDescriptor,
  ]);

  const handleEvidenceDriveError = (error: unknown, actionLabel: string) => {
    console.error(`[PortalWeeklyExpensePage] ${actionLabel} failed:`, error);
    if (error instanceof PlatformApiError) {
      const message = typeof error.body === 'object' && error.body && 'message' in (error.body as Record<string, unknown>)
        ? String((error.body as Record<string, unknown>).message || '')
        : error.message;
      toast.error(message || `${actionLabel}에 실패했습니다.`);
      return;
    }
    toast.error(`${actionLabel}에 실패했습니다.`);
  };

  const resolveVersionFromApiError = (error: unknown): number | null => {
    if (!(error instanceof PlatformApiError)) return null;
    const bodyMessage = typeof error.body === 'object' && error.body && 'message' in (error.body as Record<string, unknown>)
      ? String((error.body as Record<string, unknown>).message || '')
      : '';
    const source = `${error.message} ${bodyMessage}`;
    const currentMatch = source.match(/current=(\d+)/i);
    if (currentMatch) return Number.parseInt(currentMatch[1], 10);
    const actualMatch = source.match(/actual\s+(\d+)/i);
    if (actualMatch) return Number.parseInt(actualMatch[1], 10);
    return null;
  };

  const applyProvisionedDriveState = (
    txId: string,
    result: ProvisionTransactionEvidenceDriveResult,
  ) => {
    updateTransaction(txId, {
      version: result.version,
      evidenceDriveFolderId: result.folderId,
      evidenceDriveFolderName: result.folderName,
      evidenceDriveLink: result.webViewLink || undefined,
      evidenceDriveSharedDriveId: result.sharedDriveId || undefined,
      evidenceDriveSyncStatus: result.syncStatus,
      updatedAt: result.updatedAt,
    });
  };

  const applySyncedEvidenceState = (
    txId: string,
    result: SyncTransactionEvidenceDriveResult | UploadTransactionEvidenceDriveResult,
  ) => {
    updateTransaction(txId, {
      version: result.version,
      attachmentsCount: result.evidenceCount,
      evidenceDriveFolderId: result.folderId,
      evidenceDriveFolderName: result.folderName,
      evidenceDriveLink: result.webViewLink || undefined,
      evidenceDriveSharedDriveId: result.sharedDriveId || undefined,
      evidenceDriveSyncStatus: 'SYNCED',
      evidenceDriveLastSyncedAt: result.lastSyncedAt,
      evidenceCompletedDesc: result.evidenceCompletedDesc || undefined,
      evidenceAutoListedDesc: result.evidenceAutoListedDesc || undefined,
      evidencePendingDesc: result.evidencePendingDesc || undefined,
      supportPendingDocs: result.supportPendingDocs || undefined,
      evidenceMissing: result.evidenceMissing,
      evidenceStatus: result.evidenceStatus,
      updatedAt: result.updatedAt,
    });
  };

  const ensureTransactionPersisted = async ({
    transaction,
    sourceTxId,
  }: {
    transaction: Transaction;
    sourceTxId?: string;
  }): Promise<string | null> => {
    const existingTx = sourceTxId ? transactions.find((candidate) => candidate.id === sourceTxId) : undefined;
    const now = new Date().toISOString();
    const txId = existingTx?.id || transaction.id;
    const nextTx: Transaction = {
      ...(existingTx || {}),
      ...transaction,
      id: txId,
      projectId,
      ledgerId: defaultLedgerId,
      counterparty: transaction.counterparty.trim(),
      state: existingTx?.state || transaction.state || 'DRAFT',
      createdAt: existingTx?.createdAt || transaction.createdAt || now,
      createdBy: existingTx?.createdBy || transaction.createdBy || portalUser?.name || authUser?.name || 'pm',
      updatedAt: now,
      updatedBy: portalUser?.name || authUser?.name || transaction.updatedBy || 'pm',
      weekCode: transaction.weekCode || existingTx?.weekCode || '',
    };

    try {
      const requestPayload = {
        ...nextTx,
        ...(Number.isFinite(existingTx?.version)
          ? { expectedVersion: existingTx?.version }
          : {}),
      };
      let result;
      try {
        result = await upsertTransactionViaBff({
          tenantId: orgId,
          actor: bffActor,
          transaction: requestPayload,
        });
      } catch (error) {
        const retryVersion = resolveVersionFromApiError(error);
        if (retryVersion == null) throw error;
        result = await upsertTransactionViaBff({
          tenantId: orgId,
          actor: bffActor,
          transaction: {
            ...nextTx,
            expectedVersion: retryVersion,
          },
        });
      }
      const syncedTx = {
        ...nextTx,
        version: result.version,
        updatedAt: result.updatedAt,
        state: result.state as TransactionState,
      };
      if (existingTx) {
        updateTransaction(txId, syncedTx);
      } else {
        addTransaction(syncedTx);
      }
      return txId;
    } catch (error) {
      handleEvidenceDriveError(error, '거래 저장');
      return null;
    }
  };

  const provisionEvidenceDrive = async (tx: Transaction) => {
    try {
      const result = await provisionTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      applyProvisionedDriveState(tx.id, result);
      toast.success(`증빙 폴더 연결 완료: ${result.folderName}`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 폴더 생성');
      throw error;
    }
  };

  const syncEvidenceDrive = async (tx: Transaction) => {
    try {
      const result = await syncTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      applySyncedEvidenceState(tx.id, result);
      toast.success(`증빙 동기화 완료: ${result.evidenceCount}건`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 동기화');
      throw error;
    }
  };

  const provisionProjectDriveRoot = async () => {
    setProjectDriveProvisioning(true);
    try {
      const result = await provisionProjectEvidenceDriveRootViaBff({
        tenantId: orgId,
        actor: bffActor,
        projectId,
      });
      toast.success(`기본 폴더 연결 완료: ${result.folderName}`);
    } catch (error) {
      handleEvidenceDriveError(error, '기본 폴더 생성');
      throw error;
    } finally {
      setProjectDriveProvisioning(false);
    }
  };

  const uploadEvidenceDrive = async (tx: Transaction, uploads: EvidenceUploadSelection[]) => {
    try {
      let lastResult: UploadTransactionEvidenceDriveResult | null = null;
      for (const upload of uploads) {
        const contentBase64 = await readFileAsBase64(upload.file);
        lastResult = await uploadTransactionEvidenceDriveViaBff({
          tenantId: orgId,
          actor: bffActor,
          transactionId: tx.id,
          upload: {
            fileName: upload.reviewedFileName,
            originalFileName: upload.file.name,
            mimeType: upload.file.type || 'application/octet-stream',
            fileSize: upload.file.size,
            contentBase64,
            category: upload.category,
          },
        });
      }
      if (lastResult) {
        applySyncedEvidenceState(tx.id, lastResult);
      }
      toast.success(`증빙 업로드 완료: ${uploads.length}건`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 업로드');
      throw error;
    }
  };

  const previewGoogleSheetImport = async (sheetName?: string) => {
    const trimmedLink = googleSheetImportLink.trim();
    if (!trimmedLink) {
      toast.error('Google Sheets 링크 또는 spreadsheet ID를 입력해 주세요.');
      return;
    }

    if (devHarnessConfig.enabled && trimmedLink === DEV_GOOGLE_SHEET_SAMPLE_VALUE) {
      const result = buildDevGoogleSheetImportPreview(sheetName);
      setGoogleSheetImportPreview(result);
      setGoogleSheetImportLink(trimmedLink);
      setGoogleSheetImportStep(sheetName ? 'review' : 'sheet');
      toast.success(`개발용 샘플 미리보기 완료: ${result.selectedSheetName}`);
      return;
    }

    setGoogleSheetPreviewing(true);
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
      setGoogleSheetImportPreview(result);
      setGoogleSheetImportLink(trimmedLink);
      setGoogleSheetImportStep(sheetName ? 'review' : 'sheet');
      toast.success(`Google Sheets 미리보기 완료: ${result.selectedSheetName}`);
    } catch (error) {
      setGoogleSheetImportPreview(null);
      handleEvidenceDriveError(error, 'Google Sheets 미리보기');
    } finally {
      setGoogleSheetPreviewing(false);
    }
  };

  const applyGoogleSheetImport = async () => {
    if (!googleSheetImportPreview || !googleSheetReviewState) {
      toast.error('먼저 Google Sheets 미리보기를 불러와 주세요.');
      return;
    }
    if (!googleSheetReviewState.applySupported) {
      toast.error('현재 선택한 탭은 바로 반영할 수 없습니다.');
      return;
    }

    setGoogleSheetApplying(true);
    try {
      switch (googleSheetReviewState.descriptor.target) {
        case 'expense_sheet': {
          const expenseRows = googleSheetReviewState.expenseRows || [];
          if (expenseRows.length === 0) {
            throw new Error('가져올 데이터 행이 없습니다.');
          }
          const mergePlan = planGoogleSheetImportMerge(expenseSheetRows, expenseRows);
          await saveExpenseSheetRows(mergePlan.mergedRows);
          toast.success(`Google Sheets ${mergePlan.summary.importedCount}건을 ${activeSheetName}에 반영했습니다.`);
          break;
        }
        case 'budget_plan': {
          const budgetPlanMerge = googleSheetReviewState.budgetPlanMerge;
          if (!budgetPlanMerge || budgetPlanMerge.mergedRows.length === 0) {
            throw new Error('가져올 예산 행이 없습니다.');
          }
          await saveBudgetPlanRows(budgetPlanMerge.mergedRows);
          await saveBudgetCodeBook(budgetPlanMerge.codeBook);
          toast.success(`예산 ${budgetPlanMerge.summary.importedCount}건을 반영했습니다.`);
          break;
        }
        case 'bank_statement': {
          if (!googleSheetReviewState.bankSheet || googleSheetReviewState.bankSheet.rows.length === 0) {
            throw new Error('가져올 통장내역이 없습니다.');
          }
          await saveBankStatementRows(googleSheetReviewState.bankSheet);
          toast.success(`통장내역 ${googleSheetReviewState.bankSheet.rows.length}건을 반영했습니다.`);
          break;
        }
        case 'evidence_rules': {
          const nextMap = {
            ...(evidenceRequiredMap || {}),
            ...(googleSheetReviewState.evidenceRuleMap || {}),
          };
          if (Object.keys(nextMap).length === 0) {
            throw new Error('가져올 증빙 규칙이 없습니다.');
          }
          await saveEvidenceRequiredMap(nextMap);
          toast.success(`증빙 매핑 ${Object.keys(googleSheetReviewState.evidenceRuleMap || {}).length}건을 반영했습니다.`);
          break;
        }
        case 'cashflow_projection': {
          const sheets = googleSheetReviewState.cashflowProjection?.sheets || [];
          if (sheets.length === 0) {
            throw new Error('가져올 캐시플로우 projection이 없습니다.');
          }
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
      setGoogleSheetImportStep('sheet');
    } catch (error) {
      console.error('[PortalWeeklyExpensePage] Google Sheets import apply failed:', error);
      const message = error instanceof Error ? error.message : 'Google Sheets 반영에 실패했습니다.';
      toast.error(message);
    } finally {
      setGoogleSheetApplying(false);
    }
  };

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold">사업비 입력(주간)</h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            현재 탭: {activeSheetName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {visibleExpenseSheets.map((sheet) => (
            <Button
              key={sheet.id}
              variant={sheet.id === activeExpenseSheetId ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => setActiveExpenseSheet(sheet.id)}
            >
              {sheet.name}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={() => {
              setGoogleSheetImportStep('source');
              setGoogleSheetImportOpen(true);
            }}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Migration Wizard
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={async () => {
              const raw = window.prompt('새 탭 이름을 입력하세요.', `탭 ${visibleExpenseSheets.length + 1}`);
              if (raw == null) return;
              const trimmed = raw.trim();
              if (!trimmed) return;
              const created = await createExpenseSheet(trimmed);
              if (created) toast.success('새 탭을 만들었습니다.');
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            탭 추가
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={async () => {
              const raw = window.prompt('탭 이름을 수정하세요.', activeSheetName);
              if (raw == null) return;
              const trimmed = raw.trim();
              if (!trimmed) return;
              const ok = await renameExpenseSheet(activeExpenseSheetId || visibleExpenseSheets[0]?.id || 'default', trimmed);
              if (ok) toast.success('탭 이름을 수정했습니다.');
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            이름 변경
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px]"
            disabled={visibleExpenseSheets.length <= 1}
            onClick={async () => {
              const targetId = activeExpenseSheetId || visibleExpenseSheets[0]?.id || 'default';
              const ok = await deleteExpenseSheet(targetId);
              if (ok) toast.success('탭을 삭제했습니다.');
            }}
          >
            탭 삭제
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-[12px] text-amber-900">
        <p className="font-semibold">매입 부가세 입력 안내</p>
        <p className="mt-1 text-amber-800/90">
          부가세는 계산값이 아니라 영수증/세금계산서 증빙 기준 금액으로 입력하세요. 통장금액만 있고 사업비 사용액이 비어 있으면
          입력한 부가세를 기준으로 공급가액이 자동 보조 계산됩니다.
        </p>
      </div>
      <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 px-4 py-3 text-[12px] text-sky-950">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <p className="font-semibold">증빙 기본 폴더</p>
            <p className="text-sky-900/80">
              {myProject?.evidenceDriveRootFolderName
                ? `${myProject.evidenceDriveRootFolderName}에 거래별 폴더를 자동 생성합니다.`
                : '아직 사업 기본 폴더가 없습니다. 먼저 기본 폴더를 생성하세요.'}
            </p>
            <p className="text-[11px] text-sky-900/70">
              사업 저장 1회 후에는 각 거래 행에서 `생성 / 업로드 / 동기화`를 바로 사용할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {myProject?.evidenceDriveRootFolderLink && (
              <Button asChild variant="outline" size="sm" className="h-8 text-[11px]">
                <a href={myProject.evidenceDriveRootFolderLink} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  기본 폴더 열기
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              disabled={projectDriveProvisioning}
              onClick={() => void provisionProjectDriveRoot()}
            >
              {projectDriveProvisioning ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderPlus className="mr-1 h-3.5 w-3.5" />
              )}
              {myProject?.evidenceDriveRootFolderId ? '기본 폴더 재확인' : '기본 폴더 생성'}
            </Button>
          </div>
        </div>
      </div>
      <VarianceFlagBanner
        projectId={projectId}
        pmName={portalUser?.name || 'PM'}
        pmUid={portalUser?.id || ''}
      />
      <SettlementLedgerPage
        projectId={projectId}
        projectName={projectName}
        transactions={transactions}
        defaultLedgerId={defaultLedgerId}
        onAddTransaction={addTransaction}
        onUpdateTransaction={updateTransaction}
        authorOptions={authorOptions}
        budgetCodeBook={effectiveBudgetCodeBook}
        hideYearControls
        hideCountBadge
        autoSaveSheet
        evidenceRequiredMap={evidenceRequiredMap}
        onSaveEvidenceRequiredMap={saveEvidenceRequiredMap}
        sheetRows={expenseSheetRows}
        onSaveSheetRows={saveExpenseSheetRows}
        onSubmitWeek={async ({ yearMonth, weekNo, txIds }) => {
          try {
            await submitWeekAsPm({ projectId, yearMonth, weekNo });
            for (const txId of txIds) changeTransactionState(txId, 'SUBMITTED');
            toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
          } catch (err) {
            toast.error('주간 제출 처리에 실패했습니다');
            throw err;
          }
        }}
        onChangeTransactionState={(txId, newState, reason) => changeTransactionState(txId, newState, reason)}
        currentUserName={portalUser?.name || 'PM'}
        currentUserId={portalUser?.id || 'pm'}
        userRole={ledgerUserRole}
        comments={comments}
        onAddComment={addComment}
        onProvisionEvidenceDrive={provisionEvidenceDrive}
        onSyncEvidenceDrive={syncEvidenceDrive}
        onUploadEvidenceDrive={uploadEvidenceDrive}
        onEnsureTransactionPersisted={ensureTransactionPersisted}
      />
      <GoogleSheetImportDialog
        open={googleSheetImportOpen}
        onOpenChange={(nextOpen) => {
          setGoogleSheetImportOpen(nextOpen);
          if (!nextOpen) {
            setGoogleSheetImportStep('source');
          }
        }}
        step={googleSheetImportStep}
        onStepChange={setGoogleSheetImportStep}
        link={googleSheetImportLink}
        onLinkChange={(value) => {
          setGoogleSheetImportLink(value);
          setGoogleSheetImportPreview(null);
          setGoogleSheetImportStep('source');
        }}
        preview={googleSheetImportPreview}
        activeSheetName={activeSheetName}
        reviewState={googleSheetReviewState}
        devHarnessEnabled={devHarnessConfig.enabled}
        previewing={googleSheetPreviewing}
        applying={googleSheetApplying}
        onPreview={() => void previewGoogleSheetImport()}
        onSelectSheet={(sheetName) => void previewGoogleSheetImport(sheetName)}
        onApply={() => void applyGoogleSheetImport()}
      />
    </div>
  );
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

function GoogleSheetImportDialog({
  open,
  onOpenChange,
  step,
  onStepChange,
  link,
  onLinkChange,
  preview,
  activeSheetName,
  reviewState,
  devHarnessEnabled,
  previewing,
  applying,
  onPreview,
  onSelectSheet,
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
  reviewState: GoogleSheetMigrationReviewState | null;
  devHarnessEnabled: boolean;
  previewing: boolean;
  applying: boolean;
  onPreview: () => void;
  onSelectSheet: (sheetName: string) => void;
  onApply: () => void;
}) {
  const protectedHeaderSet = useMemo(() => new Set(GOOGLE_SHEET_PROTECTED_HEADERS), []);
  const steps: GoogleSheetWizardStep[] = ['source', 'sheet', 'review', 'apply'];
  const currentStepIndex = steps.indexOf(step);
  const selectedSheetName = preview?.selectedSheetName || '';
  const selectedDescriptor = reviewState?.descriptor || describeGoogleSheetMigrationTarget(selectedSheetName);
  const applySupported = Boolean(reviewState?.applySupported);
  const matrixPreview = useMemo(
    () => (preview?.matrix || []).slice(0, 24).map((row) => row.slice(0, 16)),
    [preview?.matrix],
  );

  const goPrev = () => {
    if (currentStepIndex <= 0) return;
    onStepChange(steps[currentStepIndex - 1]);
  };

  const goNext = () => {
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
                    onClick={() => {
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
                        <SummaryStat label="지원 방식" value="링크 기반 스캔" />
                        <SummaryStat label="현재 직접 반영" value="예산·통장·사용내역·증빙·cashflow" />
                        <SummaryStat label="보호 대상" value="증빙/드라이브" />
                        <SummaryStat label="반영 위치" value={activeSheetName} />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[12px] text-amber-950">
                      <p className="font-semibold">안전 규칙</p>
                      <ul className="mt-2 space-y-1 text-amber-900/90">
                        <li>빈 셀은 기존 값을 지우지 않습니다.</li>
                        <li>증빙 드라이브/업로드 결과는 덮어쓰지 않습니다.</li>
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
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{selectedDescriptor.readinessLabel}</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(preview?.availableSheets || []).map((sheet) => {
                      const descriptor = describeGoogleSheetMigrationTarget(sheet.title);
                      const isSelected = sheet.title === selectedSheetName;
                      return (
                        <button
                          key={sheet.sheetId}
                          type="button"
                          className={`rounded-2xl border p-4 text-left transition-colors ${
                            isSelected
                              ? 'border-sky-300 bg-sky-50'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                          onClick={() => onSelectSheet(sheet.title)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-semibold text-slate-950">{sheet.title}</p>
                              <p className="mt-1 text-[11px] text-slate-600">{descriptor.description}</p>
                            </div>
                            <Badge variant={descriptor.applySupported ? 'default' : 'outline'} className="text-[10px]">
                              {descriptor.kindLabel}
                            </Badge>
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
                              actual 값은 유지하고 projection 필드만 주차별로 upsert합니다.
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
                  <p className="mt-1 text-slate-600">추천 화면: {selectedDescriptor.recommendedScreen}</p>
                </div>
                {preview && (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[11px]">
                    <p className="font-medium text-slate-900">탭 현황</p>
                    <p className="mt-1 text-slate-600">총 {preview.availableSheets.length}개 탭</p>
                    <p className="mt-1 text-slate-600">현재 active expense sheet: {activeSheetName}</p>
                  </div>
                )}
              </div>
              <div className="mt-5 border-t pt-4 2xl:mt-auto">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 text-[12px]"
                    disabled={currentStepIndex === 0}
                    onClick={goPrev}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    이전
                  </Button>
                  {step !== 'apply' ? (
                    <Button
                      type="button"
                      className="flex-1 text-[12px]"
                      disabled={(step === 'source' && !preview) || (step !== 'source' && !preview)}
                      onClick={goNext}
                    >
                      다음
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

// ── PM 편차 확인 배너 ──

function VarianceFlagBanner({
  projectId,
  pmName,
  pmUid,
}: {
  projectId: string;
  pmName: string;
  pmUid: string;
}) {
  const { weeks } = useCashflowWeeks();
  const [replyText, setReplyText] = useState('');
  const [replyingId, setReplyingId] = useState<string | null>(null);

  // Find all OPEN flags for this project
  const openFlags = useMemo(() => {
    return weeks.filter(
      (w) =>
        w.projectId === projectId &&
        w.varianceFlag?.status === 'OPEN',
    );
  }, [weeks, projectId]);

  const { updateVarianceFlag } = useCashflowWeeks();

  const handleReply = (sheet: CashflowWeekSheet) => {
    if (!replyText.trim() || !sheet.varianceFlag) return;
    const now = new Date().toISOString();
    const nextFlag = {
      ...sheet.varianceFlag,
      status: 'REPLIED' as const,
      pmReply: replyText.trim(),
      pmRepliedBy: pmName,
      pmRepliedByUid: pmUid,
      pmRepliedAt: now,
    };
    const nextHistory = [
      ...(sheet.varianceHistory || []),
      { id: `vf-${Date.now()}`, action: 'REPLY' as const, actor: pmName, actorUid: pmUid, content: replyText.trim(), timestamp: now },
    ];
    updateVarianceFlag({ sheetId: sheet.id, varianceFlag: nextFlag, varianceHistory: nextHistory }).catch(console.error);
    setReplyText('');
    setReplyingId(null);
  };

  if (openFlags.length === 0) return null;

  return (
    <div className="space-y-2">
      {openFlags.map((sheet) => {
        const flag = sheet.varianceFlag!;
        const weekLabel = `${sheet.yearMonth} ${sheet.weekNo}주`;
        const isReplying = replyingId === sheet.id;

        return (
          <div
            key={sheet.id}
            className="flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
                  관리자 확인요청 | {weekLabel}
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                  "{flag.reason}"
                </p>
                <p className="text-[9px] text-amber-600/70 mt-0.5">
                  {flag.flaggedBy} · {flag.flaggedAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              {!isReplying && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100"
                  onClick={() => setReplyingId(sheet.id)}
                >
                  답변
                </Button>
              )}
            </div>
            {isReplying && (
              <div className="flex gap-2 ml-6">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="사유를 입력하세요..."
                  className="flex-1 h-8 rounded-md border bg-background px-2.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleReply(sheet);
                    if (e.key === 'Escape') setReplyingId(null);
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 text-[11px] gap-1 px-3"
                  onClick={() => handleReply(sheet)}
                  disabled={!replyText.trim()}
                >
                  <Send className="h-3 w-3" />
                  전송
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
