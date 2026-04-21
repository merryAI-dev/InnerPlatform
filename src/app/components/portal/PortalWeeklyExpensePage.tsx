import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  FolderPlus,
  Loader2,
  Send,
} from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import type { EvidenceUploadSelection, PendingQuickInsert } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import {
  formatSettlementSheetPolicySummary,
  normalizeSettlementSheetPolicy,
  normalizeProjectFundInputMode,
  PROJECT_FUND_INPUT_MODE_LABELS,
  type CashflowWeekSheet,
  type Transaction,
  type TransactionState,
} from '../../data/types';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import {
  type ProvisionTransactionEvidenceDriveResult,
  type SyncTransactionEvidenceDriveResult,
  type UploadTransactionEvidenceDriveResult,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  syncTransactionEvidenceDriveViaBff,
  upsertTransactionViaBff,
  uploadTransactionEvidenceDriveViaBff,
  fetchBudgetSuggestionViaBff,
  isPlatformApiEnabled,
} from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';
import {
  deriveSettlementRowsLocally,
  buildSettlementActualSyncPayloadLocally,
} from '../../platform/settlement-calculation-kernel';
import {
  GoogleDriveBrowserUploadError,
  uploadFileToGoogleDriveFolder,
} from '../../platform/google-drive-browser-upload';
import { shouldFallbackToBffOnBrowserUploadError } from '../../platform/evidence-drive-upload';
import { splitLooseNameList } from '../../platform/name-list';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { reportError } from '../../platform/observability';
import { type ImportRow } from '../../platform/settlement-csv';
import { buildOptimisticUploadedEvidencePatch } from '../../platform/evidence-upload-flow';
import { readDevAuthHarnessConfig } from '../../platform/dev-harness';
import { detectParticipationRisk } from '../../platform/participation-risk-rules';
import { normalizeBudgetLabel } from '../../platform/budget-labels';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { resolvePortalHappyPath } from '../../platform/portal-happy-path';
import { resolveWeeklyExpenseSavePolicy } from '../../platform/weekly-expense-save-policy';
import { usePortalNavigationGuard } from './PortalLayout';
const GoogleSheetMigrationWizard = lazy(
  () => import('./GoogleSheetMigrationWizard').then((module) => ({ default: module.GoogleSheetMigrationWizard })),
);
const SettlementLedgerPage = lazy(
  () => import('../cashflow/SettlementLedgerPage').then((module) => ({ default: module.SettlementLedgerPage })),
);

export function PortalWeeklyExpensePage() {
  const navigate = useNavigate();
  const { registerNavigationHandler } = usePortalNavigationGuard();
  const weeklyExpenseSavePolicy = resolveWeeklyExpenseSavePolicy();
  const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();
  const { orgId } = useFirebase();
  const {
    activeProjectId,
    portalUser,
    myProject,
    ledgers,
    transactions,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    evidenceRequiredMap,
    sheetSources,
    saveEvidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    expenseSheetRows,
    bankStatementRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetPlanRows,
    budgetCodeBook,
    budgetTreeV2,
    saveBankStatementRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
    markSheetSourceApplied,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();
  const { submitWeekAsPm, upsertWeekAmounts } = useCashflowWeeks();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const [projectDriveProvisioning, setProjectDriveProvisioning] = useState(false);
  const [googleSheetImportOpen, setGoogleSheetImportOpen] = useState(false);
  const [pendingQuickInsert, setPendingQuickInsert] = useState<PendingQuickInsert | null>(null);
  const [hasUnsavedSettlementChanges, setHasUnsavedSettlementChanges] = useState(false);
  const [isSettlementSaving, setIsSettlementSaving] = useState(false);
  const [pendingNavigationAttempt, setPendingNavigationAttempt] = useState<{ path: string; label: string } | null>(null);
  const [participationRiskWarning, setParticipationRiskWarning] = useState<{
    yearMonth: string;
    weekNo: number;
    txIds: string[];
    overLimitMembers: { memberName: string; groupLabel: string; totalRate: number }[];
  } | null>(null);

  const projectId = activeProjectId || myProject?.id || '';
  const projectName = myProject?.name || '내 사업';
  const ledgerUserRole = portalUser?.role === 'pm' ? 'pm' : 'admin';
  const visibleExpenseSheets = useMemo(() => (
    expenseSheets.length > 0
      ? expenseSheets
      : [{ id: 'default', name: '기본 탭', rows: expenseSheetRows, order: 0 }]
  ), [expenseSheets, expenseSheetRows]);
  const activeSheetName = useMemo(() => {
    return visibleExpenseSheets.find((sheet) => sheet.id === activeExpenseSheetId)?.name || visibleExpenseSheets[0]?.name || '기본 탭';
  }, [visibleExpenseSheets, activeExpenseSheetId]);
  const bankStatementCount = bankStatementRows?.rows?.length || 0;

  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [projectId, ledgers]);
  const happyPath = useMemo(() => resolvePortalHappyPath({
    authUser,
    portalUser,
    project: myProject,
    ledgers,
  }), [authUser, portalUser, myProject, ledgers]);
  const isENaraProject = myProject?.settlementType === 'TYPE5' || myProject?.accountType === 'DEDICATED';
  const fundInputMode = normalizeProjectFundInputMode(myProject?.fundInputMode);
  const isDirectEntryMode = fundInputMode === 'DIRECT_ENTRY';
  const expenseRowCount = expenseSheetRows?.length || 0;
  const weeklySetupPanel = useMemo(() => {
    if (!happyPath.canOpenWeeklyExpenses) {
      return {
        title: '주간 사업비를 시작하려면 먼저 사업 연결이 필요합니다',
        description: '사업 배정이 끝나면 이 화면과 통장내역, 예산 화면을 같은 기준으로 사용할 수 있습니다.',
        toneClass: 'border-amber-200/70 bg-amber-50/70',
        actionLabel: '사업 설정 열기',
        actionKind: 'settings' as const,
      };
    }
    if (!isDirectEntryMode && bankStatementCount === 0) {
      return {
        title: '이번 주 원본이 아직 없습니다',
        description: '통장내역을 먼저 올리면 이 탭이 자동 분류와 사람 확인 기준으로 바로 이어집니다.',
        toneClass: 'border-indigo-200/70 bg-indigo-50/70',
        actionLabel: '통장내역 열기',
        actionKind: 'bank' as const,
      };
    }
    if (!happyPath.canUseEvidenceWorkflow) {
      return {
        title: '증빙 폴더 연결을 마치면 제출 흐름이 더 빨라집니다',
        description: '기본 폴더를 준비하면 행 저장 후 바로 증빙 폴더 생성, 업로드, 동기화를 이어갈 수 있습니다.',
        toneClass: 'border-amber-200/70 bg-amber-50/70',
        actionLabel: '기본 폴더 준비',
        actionKind: 'drive' as const,
      };
    }
    return null;
  }, [
    bankStatementCount,
    happyPath.canOpenWeeklyExpenses,
    happyPath.canUseEvidenceWorkflow,
    isDirectEntryMode,
  ]);
  const settlementSheetPolicy = useMemo(
    () => normalizeSettlementSheetPolicy(myProject?.settlementSheetPolicy, myProject?.fundInputMode),
    [myProject?.fundInputMode, myProject?.settlementSheetPolicy],
  );
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

    const pushCode = (rawCode?: string | null) => {
      const code = normalizeBudgetLabel(rawCode || '');
      if (!code) return;
      if (!subCodesByCode.has(code)) {
        subCodesByCode.set(code, new Set());
        orderedCodes.push(code);
      }
      return code;
    };

    if (budgetTreeV2?.codes && budgetTreeV2.codes.length > 0) {
      budgetTreeV2.codes.forEach((entry) => {
        const code = pushCode(entry.code);
        if (!code) return;
        entry.subItems.forEach((subItem) => pushEntry(code, subItem.subCode));
      });
    } else {
      budgetCodeBook.forEach((entry) => {
        const code = pushCode(entry.code);
        if (!code) return;
        entry.subCodes.forEach((subCode) => pushEntry(code, subCode));
      });
      (budgetPlanRows || []).forEach((row) => pushEntry(row.budgetCode, row.subCode));
    }

    return orderedCodes.map((code) => ({
      code,
      subCodes: Array.from(subCodesByCode.get(code) || []),
    })).filter((entry) => entry.subCodes.length > 0);
  }, [budgetCodeBook, budgetPlanRows, budgetTreeV2?.codes]);

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
  const deriveRowsWithLocalKernel = useCallback(async (
    rows: ImportRow[],
    context: Parameters<typeof deriveSettlementRowsLocally>[1],
    options: Parameters<typeof deriveSettlementRowsLocally>[2],
  ) => deriveSettlementRowsLocally(rows, context, options), []);
  const previewActualSyncWithLocalKernel = useCallback(async (
    rows: ImportRow[],
    yearWeeks: Parameters<typeof buildSettlementActualSyncPayloadLocally>[1],
    persistedRows?: ImportRow[] | null,
  ) => buildSettlementActualSyncPayloadLocally(rows, yearWeeks, persistedRows), []);

  const handleEvidenceDriveError = useCallback((error: unknown, actionLabel: string) => {
    reportError(error, {
      message: `[PortalWeeklyExpensePage] ${actionLabel} failed:`,
      options: {
        level: 'error',
        tags: {
          surface: 'portal_weekly_expense',
          action: actionLabel,
        },
        extra: {
          projectId,
          actorId: bffActor.uid,
        },
      },
    });
    const fallback = error instanceof GoogleDriveBrowserUploadError
      ? (error.message || `${actionLabel}에 실패했습니다.`)
      : `${actionLabel}에 실패했습니다.`;
    toast.error(resolveApiErrorMessage(error, fallback));
  }, [bffActor.uid, projectId]);

  const queueQuickInsert = (kind: PendingQuickInsert['kind']) => {
    setPendingQuickInsert({
      kind,
      token: Date.now(),
    });
  };

  const resolveVersionFromApiError = useCallback((error: unknown): number | null => {
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
  }, []);

  const applyProvisionedDriveState = useCallback(async (
    txId: string,
    result: ProvisionTransactionEvidenceDriveResult,
  ) => {
    await updateTransaction(txId, {
      version: result.version,
      evidenceDriveFolderId: result.folderId,
      evidenceDriveFolderName: result.folderName,
      evidenceDriveLink: result.webViewLink || undefined,
      evidenceDriveSharedDriveId: result.sharedDriveId || undefined,
      evidenceDriveSyncStatus: result.syncStatus,
      updatedAt: result.updatedAt,
    });
  }, [updateTransaction]);

  const applySyncedEvidenceState = useCallback(async (
    txId: string,
    result: SyncTransactionEvidenceDriveResult | UploadTransactionEvidenceDriveResult,
  ) => {
    await updateTransaction(txId, {
      version: result.version,
      attachmentsCount: result.evidenceCount,
      evidenceDriveFolderId: result.folderId,
      evidenceDriveFolderName: result.folderName,
      evidenceDriveLink: result.webViewLink || undefined,
      evidenceDriveSharedDriveId: result.sharedDriveId || undefined,
      evidenceDriveSyncStatus: 'SYNCED',
      evidenceDriveLastSyncedAt: result.lastSyncedAt,
      evidenceCompletedDesc: result.evidenceCompletedDesc || '',
      evidenceCompletedManualDesc: result.evidenceCompletedManualDesc || '',
      evidenceAutoListedDesc: result.evidenceAutoListedDesc || '',
      evidencePendingDesc: result.evidencePendingDesc || '',
      supportPendingDocs: result.supportPendingDocs || '',
      evidenceMissing: result.evidenceMissing,
      evidenceStatus: result.evidenceStatus,
      updatedAt: result.updatedAt,
    });
  }, [updateTransaction]);

  const ensureTransactionPersisted = useCallback(async ({
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
        await updateTransaction(txId, syncedTx);
      } else {
        await addTransaction(syncedTx);
      }
      return txId;
    } catch (error) {
      handleEvidenceDriveError(error, '거래 저장');
      return null;
    }
  }, [
    addTransaction,
    authUser?.name,
    bffActor,
    defaultLedgerId,
    handleEvidenceDriveError,
    orgId,
    portalUser?.name,
    projectId,
    resolveVersionFromApiError,
    transactions,
    updateTransaction,
  ]);

  const provisionEvidenceDrive = useCallback(async (tx: Transaction) => {
    if (tx.evidenceDriveFolderId) {
      const folderName = tx.evidenceDriveFolderName || '기존 증빙 폴더';
      toast.success(`이미 연결된 증빙 폴더를 사용합니다: ${folderName}`);
      return {
        transactionId: tx.id,
        projectId: tx.projectId,
        projectFolderId: myProject?.evidenceDriveRootFolderId || '',
        projectFolderName: myProject?.evidenceDriveRootFolderName || '',
        folderId: tx.evidenceDriveFolderId,
        folderName,
        webViewLink: tx.evidenceDriveLink || null,
        sharedDriveId: tx.evidenceDriveSharedDriveId || myProject?.evidenceDriveSharedDriveId || null,
        syncStatus: 'LINKED' as const,
        version: tx.version || 1,
        updatedAt: tx.updatedAt || new Date().toISOString(),
      };
    }

    try {
      const result = await provisionTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      await applyProvisionedDriveState(tx.id, result);
      toast.success(`증빙 폴더 연결 완료: ${result.folderName}`);
      return result;
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 폴더 생성');
      throw error;
    }
  }, [applyProvisionedDriveState, bffActor, handleEvidenceDriveError, myProject?.evidenceDriveRootFolderId, myProject?.evidenceDriveRootFolderName, myProject?.evidenceDriveSharedDriveId, orgId]);

  const syncEvidenceDrive = useCallback(async (tx: Transaction) => {
    try {
      const result = await syncTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      await applySyncedEvidenceState(tx.id, result);
      toast.success(`증빙 동기화 완료: Drive 폴더 파일 ${result.evidenceCount}건 반영`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 동기화');
      throw error;
    }
  }, [applySyncedEvidenceState, bffActor, handleEvidenceDriveError, orgId]);

  const provisionProjectDriveRoot = useCallback(async () => {
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
  }, [bffActor, handleEvidenceDriveError, orgId, projectId]);

  const uploadEvidenceDrive = useCallback(async (tx: Transaction, uploads: EvidenceUploadSelection[]) => {
    try {
      const googleAccessToken = bffActor.googleAccessToken || await ensureGoogleWorkspaceAccess() || undefined;
      let workingTx = transactions.find((candidate) => candidate.id === tx.id) || tx;
      let folderId = workingTx.evidenceDriveFolderId || '';
      let sharedDriveId = workingTx.evidenceDriveSharedDriveId || '';

      if (!folderId) {
        const provisioned = await provisionEvidenceDrive(workingTx);
        folderId = provisioned.folderId;
        sharedDriveId = provisioned.sharedDriveId || sharedDriveId;
        workingTx = {
          ...workingTx,
          version: provisioned.version,
          evidenceDriveFolderId: provisioned.folderId,
          evidenceDriveFolderName: provisioned.folderName,
          evidenceDriveLink: provisioned.webViewLink || workingTx.evidenceDriveLink,
          evidenceDriveSharedDriveId: provisioned.sharedDriveId || workingTx.evidenceDriveSharedDriveId,
        };
      }

      if (!folderId) {
        throw new Error('증빙 Drive 폴더를 찾지 못했습니다.');
      }

      let usedBrowserUpload = false;
      let lastResult: UploadTransactionEvidenceDriveResult | null = null;
      for (const upload of uploads) {
        if (googleAccessToken) {
          try {
            await uploadFileToGoogleDriveFolder({
              accessToken: googleAccessToken,
              folderId,
              file: upload.file,
              fileName: upload.reviewedFileName,
              mimeType: upload.file.type || 'application/octet-stream',
              appProperties: {
                managedBy: 'mysc-platform',
                tenantId: orgId,
                projectId,
                transactionId: tx.id,
                evidenceSource: 'platform-upload',
                originalFileName: upload.file.name,
                category: upload.category,
                sharedDriveId,
              },
            });
            usedBrowserUpload = true;
            continue;
          } catch (error) {
            if (!shouldFallbackToBffOnBrowserUploadError(error)) {
              throw error;
            }
            reportError(error, {
              message: '[PortalWeeklyExpensePage] Browser Drive upload failed; falling back to BFF upload:',
              options: {
                level: 'warning',
                tags: {
                  surface: 'portal_weekly_expense',
                  action: 'browser_drive_upload_fallback',
                },
                extra: {
                  projectId,
                  transactionId: tx.id,
                  actorId: bffActor.uid,
                },
              },
            });
          }
        }

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

      if (usedBrowserUpload) {
        await updateTransaction(tx.id, buildOptimisticUploadedEvidencePatch({
          transaction: workingTx,
          folderId,
          folderName: workingTx.evidenceDriveFolderName,
          webViewLink: workingTx.evidenceDriveLink,
          sharedDriveId: sharedDriveId || workingTx.evidenceDriveSharedDriveId,
          uploadedCategories: uploads.map((upload) => String(upload.category || upload.parserCategory).trim()).filter(Boolean),
          updatedAt: new Date().toISOString(),
        }));
        const uploadLabel = uploads.length === 1
          ? uploads[0]?.reviewedFileName || uploads[0]?.file.name || '파일 1건'
          : `${uploads[0]?.reviewedFileName || uploads[0]?.file.name || '파일'} 외 ${uploads.length - 1}건`;
        toast.success(`업로드 완료: ${uploadLabel}`);
      } else if (lastResult) {
        await applySyncedEvidenceState(tx.id, lastResult);
      }
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 업로드');
      throw error;
    }
  }, [
    applySyncedEvidenceState,
    bffActor,
    ensureGoogleWorkspaceAccess,
    handleEvidenceDriveError,
    orgId,
    projectId,
    provisionEvidenceDrive,
    transactions,
    updateTransaction,
  ]);

  const handleAddTransaction = useCallback((tx: Transaction) => {
    void addTransaction(tx).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 저장에 실패했습니다.'));
    });
  }, [addTransaction]);

  const handleUpdateTransaction = useCallback((txId: string, updates: Partial<Transaction>) => {
    void updateTransaction(txId, updates).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 수정에 실패했습니다.'));
    });
  }, [updateTransaction]);

  const handleSubmitWeek = useCallback(async ({ yearMonth, weekNo, txIds }: {
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => {
    const riskCheck = detectParticipationRisk(participationEntries);
    if (riskCheck.hasOverLimit) {
      setParticipationRiskWarning({
        yearMonth,
        weekNo,
        txIds,
        overLimitMembers: riskCheck.overLimitMembers.map((m) => ({
          memberName: m.memberName,
          groupLabel: m.groupLabel,
          totalRate: m.totalRate,
        })),
      });
      return;
    }
    let updatedCount = 0;
    try {
      await submitWeekAsPm({ projectId, yearMonth, weekNo });
      for (const txId of txIds) {
        await changeTransactionState(txId, 'SUBMITTED');
        updatedCount += 1;
      }
      toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
    } catch (err) {
      const fallback = updatedCount > 0
        ? `주간 제출은 저장됐지만 거래 상태 ${updatedCount}/${txIds.length}건만 갱신했습니다.`
        : '주간 제출 처리에 실패했습니다';
      toast.error(resolveApiErrorMessage(err, fallback));
      throw err;
    }
  }, [changeTransactionState, participationEntries, projectId, submitWeekAsPm]);

  const handleChangeTransactionState = useCallback((txId: string, newState: TransactionState, reason?: string) => {
    void changeTransactionState(txId, newState, reason).catch((error) => {
      toast.error(resolveApiErrorMessage(error, '거래 상태 변경에 실패했습니다.'));
    });
  }, [changeTransactionState]);

  const handleFetchBudgetSuggestion = useCallback(async (counterparty: string) => {
    return fetchBudgetSuggestionViaBff({ tenantId: orgId, actor: bffActor, projectId, counterparty });
  }, [bffActor, orgId, projectId]);

  const handlePendingQuickInsertHandled = useCallback(() => {
    setPendingQuickInsert(null);
  }, []);

  const requestRouteNavigation = useCallback((path: string, label: string) => {
    if (isSettlementSaving) return;
    if (hasUnsavedSettlementChanges) {
      setPendingNavigationAttempt({ path, label });
      return;
    }
    navigate(path);
  }, [hasUnsavedSettlementChanges, isSettlementSaving, navigate]);

  useEffect(() => {
    registerNavigationHandler((attempt) => {
      if (isSettlementSaving) return true;
      if (!hasUnsavedSettlementChanges) return false;
      setPendingNavigationAttempt(attempt);
      return true;
    });
    return () => registerNavigationHandler(null);
  }, [hasUnsavedSettlementChanges, isSettlementSaving, registerNavigationHandler]);

  useEffect(() => {
    if (!isSettlementSaving) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSettlementSaving]);

  const requestSheetSwitch = useCallback((sheetId: string) => {
    if (sheetId === activeExpenseSheetId) return;
    setActiveExpenseSheet(sheetId);
  }, [activeExpenseSheetId, setActiveExpenseSheet]);

  if (!projectId) {
    return (
      <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/70 p-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-[20px] font-extrabold tracking-[-0.03em] text-slate-900">주간 사업비 화면을 열 준비가 아직 끝나지 않았습니다</h1>
          <p className="text-[13px] leading-6 text-slate-600">
            사업 배정이 끝나면 이번 주 입력 탭, 통장내역, 증빙 흐름을 같은 기준으로 이어서 사용할 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate('/portal/project-settings')}>사업 연결 확인하기</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/portal')}>포털 홈으로 이동</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-background/95 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold">사업비 입력(주간)</h2>
              <Badge variant="outline" className="text-[10px]">
                {PROJECT_FUND_INPUT_MODE_LABELS[fundInputMode]}
              </Badge>
              {isENaraProject && (
                <Badge variant="outline" className="text-[10px]">
                  TYPE5 / 전용계좌
                </Badge>
              )}
            </div>
            <p className="max-w-4xl text-[12px] text-muted-foreground">
              {isDirectEntryMode
                ? '주간 사업비 시트 또는 엑셀 템플릿으로 직접 입력하고, 저장 후 actual 반영 상태까지 같은 작업면에서 확인합니다.'
                : bankStatementCount > 0
                  ? '통장내역 기준본에서 이어서 작업합니다. 이 화면에서 분류 확인, 행 입력, 저장까지 바로 마무리하세요.'
                  : '통장내역 기준본을 먼저 만들면 이 화면에서 바로 입력과 저장을 이어갈 수 있습니다.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50/80 px-3 py-2.5">
              <Badge variant="secondary" className="text-[10px]">
                현재 탭: {activeSheetName}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                거래 {expenseRowCount}건
              </Badge>
              {!isDirectEntryMode && (
                <Badge variant="outline" className="text-[10px]">
                  {bankStatementCount > 0 ? `통장내역 ${bankStatementCount}건 연결` : '통장내역 기준본 미준비'}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                {isDirectEntryMode
                  ? '원본 입력은 이 화면입니다.'
                  : bankStatementCount > 0
                    ? '원본 기준과 같은 흐름으로 저장과 actual 반영을 이어갑니다.'
                    : '원본 기준본을 준비하면 이 화면에서 바로 이어서 저장할 수 있습니다.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap xl:justify-end">
          {isDirectEntryMode ? (
            <>
              <Button size="sm" onClick={() => queueQuickInsert('DEPOSIT')}>
                입금 추가
              </Button>
              <Button variant="outline" size="sm" onClick={() => queueQuickInsert('EXPENSE')}>
                지출 추가
              </Button>
              {settlementSheetPolicy.allowAdjustmentRows && (
                <Button variant="outline" size="sm" onClick={() => queueQuickInsert('ADJUSTMENT')}>
                  잔액 조정
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                data-testid="weekly-expense-bank-statement-action"
                onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}
              >
                기존 통장내역 가져오기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              data-testid="weekly-expense-bank-statement-action"
              onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}
            >
              {bankStatementCount > 0 ? '통장내역 검토' : '통장내역 열기'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {myProject?.evidenceDriveRootFolderLink && (
            <Button asChild variant="outline" size="sm">
              <a href={myProject.evidenceDriveRootFolderLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                기본 폴더 열기
              </a>
            </Button>
          )}
          {!happyPath.canUseEvidenceWorkflow && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void provisionProjectDriveRoot()}
              disabled={projectDriveProvisioning || !happyPath.canOpenWeeklyExpenses}
            >
              {projectDriveProvisioning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              기본 폴더 준비
            </Button>
          )}
            <Button
              variant="outline"
              size="sm"
            onClick={() => requestRouteNavigation('/portal/project-settings', '사업 배정 수정')}
          >
            설정 열기
          </Button>
          </div>
        </div>
          <div className={`mt-4 grid gap-3 ${weeklySetupPanel ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]' : ''}`}>
          {weeklySetupPanel ? (
            <Card data-testid="weekly-expense-setup-panel" className={weeklySetupPanel.toneClass}>
              <CardContent className="px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">지금 해야 할 일</p>
                    <p className="text-[15px] font-semibold text-slate-900">{weeklySetupPanel.title}</p>
                    <p className="max-w-4xl text-[12px] leading-6 text-slate-600">{weeklySetupPanel.description}</p>
                  </div>
                  {weeklySetupPanel.actionLabel && (
                    <div className="shrink-0">
                      {weeklySetupPanel.actionKind === 'drive' ? (
                        <Button
                          size="sm"
                          onClick={() => void provisionProjectDriveRoot()}
                          disabled={projectDriveProvisioning || !happyPath.canOpenWeeklyExpenses}
                        >
                          {projectDriveProvisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                          {weeklySetupPanel.actionLabel}
                        </Button>
                      ) : weeklySetupPanel.actionKind === 'settings' ? (
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/project-settings', '사업 배정 수정')}>
                          {weeklySetupPanel.actionLabel}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}>
                          {weeklySetupPanel.actionLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-xl border bg-slate-50/80 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">입력 정책</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatSettlementSheetPolicySummary(settlementSheetPolicy)}</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {expenseRowCount}건의 거래를 현재 탭에서 관리하고 있고, 저장 후 actual 반영 상태를 같은 화면에서 확인합니다.
            </div>
          </div>
        </div>

      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {visibleExpenseSheets.map((sheet) => (
            <Button
              key={sheet.id}
              variant={sheet.id === activeExpenseSheetId ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => requestSheetSwitch(sheet.id)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      </div>

      <VarianceFlagBanner
        projectId={projectId}
        pmName={portalUser?.name || 'PM'}
        pmUid={portalUser?.id || ''}
      />
      <Suspense
        fallback={(
          <div className="rounded-xl border bg-background px-4 py-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              사업비 시트를 불러오는 중입니다…
            </div>
          </div>
        )}
      >
        <SettlementLedgerPage
          projectId={projectId}
          projectName={projectName}
          transactions={transactions}
          defaultLedgerId={defaultLedgerId}
          onAddTransaction={handleAddTransaction}
          onUpdateTransaction={handleUpdateTransaction}
          authorOptions={authorOptions}
          budgetCodeBook={effectiveBudgetCodeBook}
          budgetTreeV2={budgetTreeV2}
          hideYearControls
          hideCountBadge
          saveMode={weeklyExpenseSavePolicy.mode}
          autoSaveIdleMs={weeklyExpenseSavePolicy.idleMs}
          autoSaveSyncCashflow={weeklyExpenseSavePolicy.syncCashflowOnAutoSave}
          showSaveStatusButton={weeklyExpenseSavePolicy.showStatusButton}
          evidenceRequiredMap={evidenceRequiredMap}
          onSaveEvidenceRequiredMap={saveEvidenceRequiredMap}
          sheetRows={expenseSheetRows}
          onSaveSheetRows={saveExpenseSheetRows}
          onSubmitWeek={handleSubmitWeek}
          onChangeTransactionState={handleChangeTransactionState}
          currentUserName={portalUser?.name || 'PM'}
          currentUserId={portalUser?.id || 'pm'}
          userRole={ledgerUserRole}
          allowEditSubmitted
          comments={comments}
          onAddComment={addComment}
          onProvisionEvidenceDrive={provisionEvidenceDrive}
          onSyncEvidenceDrive={syncEvidenceDrive}
          onUploadEvidenceDrive={uploadEvidenceDrive}
          onEnsureTransactionPersisted={ensureTransactionPersisted}
          onFetchBudgetSuggestion={isPlatformApiEnabled() ? handleFetchBudgetSuggestion : undefined}
          workflowMode={fundInputMode}
          settlementSheetPolicy={settlementSheetPolicy}
          basis={myProject?.basis}
          onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
          pendingQuickInsert={pendingQuickInsert}
          onPendingQuickInsertHandled={handlePendingQuickInsertHandled}
          onDeriveRows={deriveRowsWithLocalKernel}
          onPreviewActualSyncPayload={previewActualSyncWithLocalKernel}
          onDirtyStateChange={setHasUnsavedSettlementChanges}
          onSavingStateChange={setIsSettlementSaving}
          discardChangesRequestToken={0}
        />
      </Suspense>
      {isSettlementSaving && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex min-h-[22rem] w-[min(92vw,56rem)] max-w-none flex-col items-center justify-center gap-6 rounded-[28px] border bg-background px-8 py-10 shadow-2xl sm:px-12 sm:py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-[2rem]">사업비 입력을 저장하고 있습니다</p>
              <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">저장이 끝날 때까지 잠시 기다려 주세요.</p>
            </div>
          </div>
        </div>
      )}
      {googleSheetImportOpen && (
        <Suspense fallback={null}>
            <GoogleSheetMigrationWizard
              open={googleSheetImportOpen}
              onOpenChange={setGoogleSheetImportOpen}
              orgId={orgId}
              projectId={projectId}
              projectName={projectName}
              projectSettlementType={myProject?.settlementType}
              projectAccountType={myProject?.accountType}
              activeSheetName={activeSheetName}
              bffActor={bffActor}
              expenseSheetRows={expenseSheetRows || []}
              budgetPlanRows={budgetPlanRows || []}
              evidenceRequiredMap={evidenceRequiredMap}
              sheetSources={sheetSources}
              devHarnessEnabled={devHarnessConfig.enabled}
              ensureGoogleWorkspaceAccess={ensureGoogleWorkspaceAccess}
              saveExpenseSheetRows={saveExpenseSheetRows}
              saveBudgetPlanRows={saveBudgetPlanRows}
              saveBudgetCodeBook={saveBudgetCodeBook}
              saveBankStatementRows={saveBankStatementRows}
              saveEvidenceRequiredMap={saveEvidenceRequiredMap}
              markSheetSourceApplied={markSheetSourceApplied}
              upsertWeekAmounts={upsertWeekAmounts}
              previewActualSyncPayload={previewActualSyncWithLocalKernel}
            />
        </Suspense>
      )}
      {/* 참여율 이상 탐지 경고 모달 */}
      <AlertDialog open={!!participationRiskWarning} onOpenChange={(open) => { if (!open) setParticipationRiskWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ 참여율 초과 경고</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>아래 인력의 참여율이 100%를 초과합니다. 확인 후 제출하세요.</p>
                <ul className="space-y-1 mt-2">
                  {participationRiskWarning?.overLimitMembers.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-rose-700 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      {m.memberName} — {m.groupLabel} 합산 {m.totalRate}%
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-[11px] mt-2">
                  계속 진행하면 제출이 완료됩니다. 참여율 관리는 인사 설정에서 수정하세요.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setParticipationRiskWarning(null)}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                if (!participationRiskWarning) return;
                const { yearMonth, weekNo, txIds } = participationRiskWarning;
                setParticipationRiskWarning(null);
                let updatedCount = 0;
                try {
                  await submitWeekAsPm({ projectId, yearMonth, weekNo });
                  for (const txId of txIds) {
                    await changeTransactionState(txId, 'SUBMITTED');
                    updatedCount += 1;
                  }
                  toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
                } catch (err) {
                  const fallback = updatedCount > 0
                    ? `주간 제출은 저장됐지만 거래 상태 ${updatedCount}/${txIds.length}건만 갱신했습니다.`
                    : '주간 제출 처리에 실패했습니다';
                  toast.error(resolveApiErrorMessage(err, fallback));
                }
              }}
            >
              이해했습니다, 제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingNavigationAttempt}
        onOpenChange={(open) => {
          if (!open) setPendingNavigationAttempt(null);
        }}
      >
        <AlertDialogContent
          data-testid="weekly-expense-unsaved-dialog"
          className="w-[min(92vw,56rem)] max-w-none overflow-hidden rounded-[28px] p-0 sm:max-w-none"
        >
          <div className="flex min-h-[22rem] flex-col items-center justify-center gap-8 px-8 py-10 text-center sm:px-12 sm:py-12">
          <AlertDialogHeader className="items-center gap-4 text-center">
            <AlertDialogTitle className="text-2xl font-bold tracking-[-0.03em] text-slate-950 sm:text-[2rem]">
              저장되지 않은 사업비 입력이 있습니다
            </AlertDialogTitle>
            <AlertDialogDescription className="max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              지금 이동하면 저장되지 않은 사업비 입력(주간) 편집 내용이 유실될 수 있습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="w-full items-center justify-center gap-3 sm:flex-row sm:justify-center">
            <AlertDialogCancel
              className="h-12 min-w-[11rem] rounded-xl px-6 text-sm font-semibold"
              onClick={() => setPendingNavigationAttempt(null)}
            >
              계속 편집
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-12 min-w-[12rem] rounded-xl px-6 text-sm font-semibold"
              onClick={() => {
                if (!pendingNavigationAttempt) return;
                const nextPath = pendingNavigationAttempt.path;
                setPendingNavigationAttempt(null);
                navigate(nextPath);
              }}
            >
              변경 버리고 이동
            </AlertDialogAction>
          </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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
