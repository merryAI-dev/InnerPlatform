import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
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
import type { EvidenceUploadSelection, PendingQuickInsert } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PortalMissionGuide } from './PortalMissionGuide';
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
import { resolvePortalMissionProgress } from '../../platform/portal-mission-guide';
const GoogleSheetMigrationWizard = lazy(
  () => import('./GoogleSheetMigrationWizard').then((module) => ({ default: module.GoogleSheetMigrationWizard })),
);
const SettlementLedgerPage = lazy(
  () => import('../cashflow/SettlementLedgerPage').then((module) => ({ default: module.SettlementLedgerPage })),
);

type PendingUnsavedAction =
  | {
    kind: 'route';
    path: string;
    label: string;
  }
  | {
    kind: 'sheet';
    sheetId: string;
    sheetName: string;
  }
  | {
    kind: 'wizard';
  }
  | {
    kind: 'blocker';
    label: string;
  };

export function PortalWeeklyExpensePage() {
  const location = useLocation();
  const navigate = useNavigate();
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
    sheetSources,
    saveEvidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    createExpenseSheet,
    renameExpenseSheet,
    deleteExpenseSheet,
    expenseSheetRows,
    bankStatementRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetPlanRows,
    budgetCodeBook,
    saveBankStatementRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
    markSheetSourceApplied,
    weeklySubmissionStatuses,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();
  const { submitWeekAsPm, upsertWeekAmounts } = useCashflowWeeks();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const [projectDriveProvisioning, setProjectDriveProvisioning] = useState(false);
  const [googleSheetImportOpen, setGoogleSheetImportOpen] = useState(false);
  const [pendingQuickInsert, setPendingQuickInsert] = useState<PendingQuickInsert | null>(null);
  const [hasUnsavedSettlementChanges, setHasUnsavedSettlementChanges] = useState(false);
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null);
  const [confirmedUnsavedAction, setConfirmedUnsavedAction] = useState<PendingUnsavedAction | null>(null);
  const [discardChangesRequestToken, setDiscardChangesRequestToken] = useState(0);
  const [allowUnsavedNavigation, setAllowUnsavedNavigation] = useState(false);
  const [participationRiskWarning, setParticipationRiskWarning] = useState<{
    yearMonth: string;
    weekNo: number;
    txIds: string[];
    overLimitMembers: { memberName: string; groupLabel: string; totalRate: number }[];
  } | null>(null);

  const projectId = portalUser?.projectId || '';
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
  const blocker = useBlocker(hasUnsavedSettlementChanges && !allowUnsavedNavigation);

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
  const missionProgress = useMemo(() => resolvePortalMissionProgress({
    fundInputMode,
    bankStatementRowCount: bankStatementCount,
    expenseRowCount: expenseSheetRows?.length || 0,
    weeklySubmissionStatuses,
  }), [bankStatementCount, expenseSheetRows?.length, fundInputMode, weeklySubmissionStatuses]);
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
      evidenceCompletedDesc: result.evidenceCompletedDesc || undefined,
      evidenceCompletedManualDesc: result.evidenceCompletedManualDesc || undefined,
      evidenceAutoListedDesc: result.evidenceAutoListedDesc || undefined,
      evidencePendingDesc: result.evidencePendingDesc || undefined,
      supportPendingDocs: result.supportPendingDocs || undefined,
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
        await updateTransaction(tx.id, {
          evidenceDriveFolderId: folderId,
          evidenceDriveFolderName: workingTx.evidenceDriveFolderName,
          evidenceDriveLink: workingTx.evidenceDriveLink,
          evidenceDriveSharedDriveId: sharedDriveId || workingTx.evidenceDriveSharedDriveId,
          evidenceDriveSyncStatus: 'UPLOADED',
          updatedAt: new Date().toISOString(),
        });
        const syncResult = await syncTransactionEvidenceDriveViaBff({
          tenantId: orgId,
          actor: bffActor,
          transactionId: tx.id,
        });
        await applySyncedEvidenceState(tx.id, syncResult);
        const uploadLabel = uploads.length === 1
          ? uploads[0]?.reviewedFileName || uploads[0]?.file.name || '파일 1건'
          : `${uploads[0]?.reviewedFileName || uploads[0]?.file.name || '파일'} 외 ${uploads.length - 1}건`;
        toast.success(`업로드 완료 후 동기화됨: ${uploadLabel}`);
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

  const openGoogleSheetImport = useCallback(() => {
    setGoogleSheetImportOpen(true);
  }, []);

  useEffect(() => {
    setAllowUnsavedNavigation(false);
  }, [location.key]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const nextPath = `${blocker.location.pathname || ''}${blocker.location.search || ''}${blocker.location.hash || ''}` || '다른 화면';
    setPendingUnsavedAction((current) => current || {
      kind: 'blocker',
      label: nextPath,
    });
  }, [blocker]);

  useEffect(() => {
    if (!confirmedUnsavedAction || hasUnsavedSettlementChanges) return;

    if (confirmedUnsavedAction.kind === 'blocker') {
      setAllowUnsavedNavigation(true);
      blocker.proceed();
      setConfirmedUnsavedAction(null);
      return;
    }

    if (confirmedUnsavedAction.kind === 'sheet') {
      setActiveExpenseSheet(confirmedUnsavedAction.sheetId);
      setConfirmedUnsavedAction(null);
      return;
    }

    if (confirmedUnsavedAction.kind === 'wizard') {
      openGoogleSheetImport();
      setConfirmedUnsavedAction(null);
      return;
    }

    setAllowUnsavedNavigation(true);
    navigate(confirmedUnsavedAction.path);
    setConfirmedUnsavedAction(null);
  }, [
    blocker,
    confirmedUnsavedAction,
    hasUnsavedSettlementChanges,
    navigate,
    openGoogleSheetImport,
    setActiveExpenseSheet,
  ]);

  const requestRouteNavigation = useCallback((path: string, label: string) => {
    if (hasUnsavedSettlementChanges) {
      setPendingUnsavedAction({ kind: 'route', path, label });
      return;
    }
    navigate(path);
  }, [hasUnsavedSettlementChanges, navigate]);

  const requestSheetSwitch = useCallback((sheetId: string, sheetName: string) => {
    if (sheetId === activeExpenseSheetId) return;
    if (hasUnsavedSettlementChanges) {
      setPendingUnsavedAction({ kind: 'sheet', sheetId, sheetName });
      return;
    }
    setActiveExpenseSheet(sheetId);
  }, [activeExpenseSheetId, hasUnsavedSettlementChanges, setActiveExpenseSheet]);

  const requestWizardOpen = useCallback(() => {
    if (hasUnsavedSettlementChanges) {
      setPendingUnsavedAction({ kind: 'wizard' });
      return;
    }
    openGoogleSheetImport();
  }, [hasUnsavedSettlementChanges, openGoogleSheetImport]);

  const resetUnsavedAction = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
    setPendingUnsavedAction(null);
    setConfirmedUnsavedAction(null);
  }, [blocker]);

  const confirmUnsavedAction = useCallback(() => {
    const action = pendingUnsavedAction;
    setPendingUnsavedAction(null);
    if (!action) return;
    setConfirmedUnsavedAction(action);
    setDiscardChangesRequestToken((current) => current + 1);
  }, [pendingUnsavedAction]);

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-background px-5 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold">사업비 입력(주간)</h2>
            <Badge variant="secondary" className="text-[10px]">
              현재 탭: {activeSheetName}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {PROJECT_FUND_INPUT_MODE_LABELS[fundInputMode]}
            </Badge>
            {bankStatementCount > 0 && !isDirectEntryMode && (
              <Badge variant="outline" className="text-[10px]">
                통장내역 {bankStatementCount}건 연결
              </Badge>
            )}
            {isENaraProject && (
              <Badge variant="outline" className="text-[10px]">
                TYPE5 / 전용계좌
              </Badge>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">
            {isDirectEntryMode
              ? '이 표에서 바로 입금, 지출, 조정을 입력하고 잔액 흐름을 이어가세요.'
              : '필요한 준비는 버튼에서 바로 처리하고, 아래 표에서 바로 입력을 이어가세요.'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            현재 정책: {formatSettlementSheetPolicySummary(settlementSheetPolicy)}
          </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
              <Button variant="outline" size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}>
                기존 통장내역 가져오기
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements', '통장내역')}>
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
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-slate-50/70 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">작업 방식</div>
            <div className="mt-1 text-sm font-semibold">{PROJECT_FUND_INPUT_MODE_LABELS[fundInputMode]}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {isDirectEntryMode ? '표에서 바로 기록하고 계산을 검토합니다.' : '통장내역 업로드 후 사용내역을 정리합니다.'}
            </div>
          </div>
          <div className="rounded-xl border bg-slate-50/70 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">정산 정책</div>
            <div className="mt-1 text-sm font-semibold">{settlementSheetPolicy.preset === 'STANDARD' ? '표준형' : settlementSheetPolicy.preset === 'DIRECT_ENTRY' ? '직접 입력형' : '잔액 추적형'}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{formatSettlementSheetPolicySummary(settlementSheetPolicy)}</div>
          </div>
          <div className="rounded-xl border bg-slate-50/70 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">원본 준비</div>
            <div className="mt-1 text-sm font-semibold">
              {!isDirectEntryMode ? (bankStatementCount > 0 ? `${bankStatementCount}건 연결됨` : '업로드 필요') : '직접 입력 진행'}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              기본 폴더 {myProject?.evidenceDriveRootFolderId ? '준비됨' : '미설정'}
            </div>
          </div>
          <div className="rounded-xl border bg-slate-50/70 px-3 py-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">이번 탭</div>
            <div className="mt-1 text-sm font-semibold">{activeSheetName}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {transactions.length}건의 거래와 연결되어 있습니다.
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/10 px-4 py-3 text-[11px] text-muted-foreground">
        {!isDirectEntryMode && <span>통장내역: {bankStatementCount > 0 ? `${bankStatementCount}건 연결됨` : '업로드 필요'}</span>}
        {isDirectEntryMode && <span>입력 방식: 직접 입력</span>}
        <span>시트 정책: {formatSettlementSheetPolicySummary(settlementSheetPolicy)}</span>
        <span>거래: {transactions.length}건</span>
        <span>기본 폴더: {myProject?.evidenceDriveRootFolderId ? '준비됨' : '미설정'}</span>
        {isENaraProject && <span>TYPE5 / 전용계좌 프로젝트</span>}
      </div>

      <PortalMissionGuide progress={missionProgress} compact />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {visibleExpenseSheets.map((sheet) => (
            <Button
              key={sheet.id}
              variant={sheet.id === activeExpenseSheetId ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => requestSheetSwitch(sheet.id, sheet.name)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={requestWizardOpen}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {isDirectEntryMode ? '기존 시트 가져오기' : 'Migration Wizard'}
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
          hideYearControls
          hideCountBadge
          autoSaveSheet
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
          discardChangesRequestToken={discardChangesRequestToken}
        />
      </Suspense>
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
      <AlertDialog open={!!pendingUnsavedAction}>
        <AlertDialogContent
          data-testid="weekly-expense-unsaved-dialog"
          onEscapeKeyDown={resetUnsavedAction}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>저장되지 않은 사업비 입력이 있습니다</AlertDialogTitle>
            <AlertDialogDescription>
              지금 이동하면 저장되지 않은 사업비 입력(주간) 편집 내용이 유실될 수 있습니다.
              {pendingUnsavedAction?.kind === 'sheet' && ` ${pendingUnsavedAction.sheetName} 탭으로 바꾸기 전에 먼저 저장하거나, 변경을 버릴지 확인해 주세요.`}
              {pendingUnsavedAction?.kind === 'route' && ` ${pendingUnsavedAction.label} 화면으로 이동하기 전에 먼저 저장하거나, 변경을 버릴지 확인해 주세요.`}
              {pendingUnsavedAction?.kind === 'wizard' && ' Migration Wizard를 열기 전에 현재 편집 내용을 먼저 저장하거나, 변경을 버릴지 확인해 주세요.'}
              {pendingUnsavedAction?.kind === 'blocker' && ` ${pendingUnsavedAction.label} 화면으로 이동하면 현재 편집 내용이 유실될 수 있습니다.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={resetUnsavedAction}>계속 편집</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnsavedAction}>
              변경 버리고 이동
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
