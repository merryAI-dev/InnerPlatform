import { useMemo } from 'react';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { SettlementLedgerPage } from '../cashflow/SettlementLedgerPage';
import { usePortalStore } from '../../data/portal-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export function PortalCashflowPage() {
  const { portalUser, myProject } = usePortalStore();

  const projectId = portalUser?.projectId || '';
  const projectName = myProject?.name || '내 사업';

  const ready = useMemo(() => Boolean(projectId), [projectId]);

  if (!ready) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="p-4">
      <Tabs defaultValue="settlement">
        <TabsList>
          <TabsTrigger value="settlement">정산 대장</TabsTrigger>
          <TabsTrigger value="cashflow">캐시플로 시트</TabsTrigger>
        </TabsList>
        <TabsContent value="settlement">
          <SettlementLedgerPage projectId={projectId} projectName={projectName} />
        </TabsContent>
        <TabsContent value="cashflow">
          <CashflowProjectSheet projectId={projectId} projectName={projectName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
