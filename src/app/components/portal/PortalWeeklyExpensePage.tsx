import { lazy, Suspense, useMemo, useState } from 'react';
import {
  AlertTriangle,
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
import type { EvidenceUploadSelection } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import type { CashflowWeekSheet, Transaction, TransactionState } from '../../data/types';
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
} from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';
import {
  GoogleDriveBrowserUploadError,
  uploadFileToGoogleDriveFolder,
} from '../../platform/google-drive-browser-upload';
import { splitLooseNameList } from '../../platform/name-list';
import { type ImportRow } from '../../platform/settlement-csv';
import { readDevAuthHarnessConfig } from '../../platform/dev-harness';
const GoogleSheetMigrationWizard = lazy(
  () => import('./GoogleSheetMigrationWizard').then((module) => ({ default: module.GoogleSheetMigrationWizard })),
);
const SettlementLedgerPage = lazy(
  () => import('../cashflow/SettlementLedgerPage').then((module) => ({ default: module.SettlementLedgerPage })),
);

function normalizeBudgetLabel(value: string): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
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

  const handleEvidenceDriveError = (error: unknown, actionLabel: string) => {
    console.error(`[PortalWeeklyExpensePage] ${actionLabel} failed:`, error);
    if (error instanceof GoogleDriveBrowserUploadError) {
      toast.error(error.message || `${actionLabel}에 실패했습니다.`);
      return;
    }
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
      applyProvisionedDriveState(tx.id, result);
      toast.success(`증빙 폴더 연결 완료: ${result.folderName}`);
      return result;
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
        updateTransaction(tx.id, {
          evidenceDriveFolderId: folderId,
          evidenceDriveFolderName: workingTx.evidenceDriveFolderName,
          evidenceDriveLink: workingTx.evidenceDriveLink,
          evidenceDriveSharedDriveId: sharedDriveId || workingTx.evidenceDriveSharedDriveId,
          evidenceDriveSyncStatus: 'UPLOADED',
          updatedAt: new Date().toISOString(),
        });
      } else if (lastResult) {
        applySyncedEvidenceState(tx.id, lastResult);
      }
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 업로드');
      throw error;
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
            onClick={() => setGoogleSheetImportOpen(true)}
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
      </Suspense>
      {googleSheetImportOpen && (
        <Suspense fallback={null}>
          <GoogleSheetMigrationWizard
            open={googleSheetImportOpen}
            onOpenChange={setGoogleSheetImportOpen}
            orgId={orgId}
            projectId={projectId}
            activeSheetName={activeSheetName}
            bffActor={bffActor}
            expenseSheetRows={expenseSheetRows}
            budgetPlanRows={budgetPlanRows}
            evidenceRequiredMap={evidenceRequiredMap}
            devHarnessEnabled={devHarnessConfig.enabled}
            ensureGoogleWorkspaceAccess={ensureGoogleWorkspaceAccess}
            saveExpenseSheetRows={saveExpenseSheetRows}
            saveBudgetPlanRows={saveBudgetPlanRows}
            saveBudgetCodeBook={saveBudgetCodeBook}
            saveBankStatementRows={saveBankStatementRows}
            saveEvidenceRequiredMap={saveEvidenceRequiredMap}
            upsertWeekAmounts={upsertWeekAmounts}
          />
        </Suspense>
      )}
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
