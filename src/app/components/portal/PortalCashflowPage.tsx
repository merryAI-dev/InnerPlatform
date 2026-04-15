import { lazy, Suspense, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { readDevAuthHarnessConfig } from '../../platform/dev-harness';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';

const GoogleSheetMigrationWizard = lazy(
  () => import('./GoogleSheetMigrationWizard').then((module) => ({ default: module.GoogleSheetMigrationWizard })),
);

export function PortalCashflowPage() {
  const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();
  const { orgId } = useFirebase();
  const {
    activeProjectId,
    portalUser,
    myProject,
    transactions,
    expenseSheetRows,
    budgetPlanRows,
    evidenceRequiredMap,
    sheetSources,
    saveExpenseSheetRows,
    saveBudgetPlanRows,
    saveBudgetCodeBook,
    saveBankStatementRows,
    saveEvidenceRequiredMap,
    markSheetSourceApplied,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();
  const { upsertWeekAmounts } = useCashflowWeeks();
  const devHarnessConfig = readDevAuthHarnessConfig(import.meta.env, typeof window !== 'undefined' ? window.location : undefined);
  const [googleSheetImportOpen, setGoogleSheetImportOpen] = useState(false);

  const projectId = activeProjectId || myProject?.id || '';
  const projectName = myProject?.name || '내 사업';
  const activeSheetName = '캐시플로우 Projection';

  const ready = useMemo(() => Boolean(projectId), [projectId]);
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

  if (!ready) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <>
      <Card className="mb-4 border-slate-200 bg-white">
        <CardContent className="flex flex-col gap-3 px-5 py-4 text-[12px] text-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-slate-950">기존 캐시플로 가져오기</p>
            <p>Google Sheets, `.xlsx`, `.csv`에서 projection 시트를 불러올 수 있습니다.</p>
          </div>
          <Button type="button" className="h-9 gap-1.5 text-[12px]" onClick={() => setGoogleSheetImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" />
            기존 캐시플로 가져오기
          </Button>
        </CardContent>
      </Card>

      <CashflowProjectSheet
        projectId={projectId}
        projectName={projectName}
        transactions={transactions}
        roleOverride={portalUser?.role}
        onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
      />

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
            upsertWeekAmounts={async (input) => {
              await upsertWeekAmounts(input);
              await upsertWeeklySubmissionStatus({
                projectId: input.projectId,
                yearMonth: input.yearMonth,
                weekNo: input.weekNo,
                ...(input.mode === 'projection'
                  ? { projectionEdited: true, projectionUpdated: true }
                  : { expenseEdited: true, expenseUpdated: true }),
              });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
