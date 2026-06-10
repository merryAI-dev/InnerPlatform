import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  ExternalLink,
  FolderPlus,
  Loader2,
} from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import type { EvidenceUploadSelection } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import {
  formatSettlementSheetPolicySummary,
  normalizeSettlementSheetPolicy,
  normalizeProjectFundInputMode,
  PROJECT_FUND_INPUT_MODE_LABELS,
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
  GoogleDriveBrowserUploadError,
  uploadFileToGoogleDriveFolder,
} from '../../platform/google-drive-browser-upload';
import { shouldFallbackToBffOnBrowserUploadError } from '../../platform/evidence-drive-upload';
import { splitLooseNameList } from '../../platform/name-list';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { reportError } from '../../platform/observability';
import { type ImportRow } from '../../platform/settlement-csv';
import { buildOptimisticUploadedEvidencePatch } from '../../platform/evidence-upload-flow';
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
const SettlementLedgerPage = lazy(
  () => import('../cashflow/SettlementLedgerPage').then((module) => ({ default: module.SettlementLedgerPage })),
);

export function PortalWeeklyExpensePage() {
  const navigate = useNavigate();
  const weeklyExpenseSavePolicy = resolveWeeklyExpenseSavePolicy();
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const {
    isLoading: portalStoreLoading,
    activeProjectId,
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
    expenseSheetRows,
    bankStatementRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetPlanRows,
    budgetCodeBook,
    budgetTreeV2,
    weeklySubmissionStatuses,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();
  const { submitWeekAsPm } = useCashflowWeeks();
  const [projectDriveProvisioning, setProjectDriveProvisioning] = useState(false);
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
        toneClass: 'border-cyan-200/70 bg-cyan-50/70',
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

  const requestRouteNavigation = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

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
            <Button size="sm" onClick={() => navigate('/portal/project-select')}>사업 선택하기</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/portal/project-select')}>프로젝트 선택으로 이동</Button>
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
              사업비 입력은 원장 조회 화면입니다. 금액/분류/지급정보 생성과 수정은 위자드에서만 처리합니다.
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
                {bankStatementCount > 0
                  ? '통장 원본 기준과 연결된 원장 상태를 조회합니다.'
                  : '통장내역 기준본을 준비한 뒤 위자드에서 생성/수정합니다.'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap xl:justify-end">
            <Button
              size="sm"
              data-testid="weekly-expense-bank-statement-action"
                onClick={() => requestRouteNavigation('/portal/bank-statements')}
            >
              {bankStatementCount > 0 ? '통장내역 검토' : '통장내역 열기'}
              <ArrowRight className="h-4 w-4" />
            </Button>
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
            onClick={() => requestRouteNavigation('/portal/project-select')}
          >
            사업 선택
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
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/project-select')}>
                          {weeklySetupPanel.actionLabel}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => requestRouteNavigation('/portal/bank-statements')}>
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
              {expenseRowCount}건의 거래를 현재 탭에서 조회합니다. 생성/수정은 위자드를 거쳐 서버 검증 후 반영합니다.
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
          autoSaveSyncCashflow={false}
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
          weeklySubmissionStatuses={weeklySubmissionStatuses}
          discardChangesRequestToken={0}
          ledgerViewOnly
        />
      </Suspense>
      {/* 참여율 이상 탐지 경고 모달 */}
      <AlertDialog open={!!participationRiskWarning} onOpenChange={(open) => { if (!open) setParticipationRiskWarning(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>참여율 초과 경고</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>아래 인력의 참여율이 100%를 초과합니다. 확인 후 제출하세요.</p>
                <ul className="space-y-1 mt-2">
                  {participationRiskWarning?.overLimitMembers.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-rose-700 font-medium">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      {m.memberName} - {m.groupLabel} 합산 {m.totalRate}%
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
