import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { CashflowProjectSheet } from './CashflowProjectSheet';
import { SettlementLedgerPage } from './SettlementLedgerPage';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

export function ProjectCashflowSheetPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const { getProjectById } = useAppStore();
  const { setYearMonth } = useCashflowWeeks();

  const ym = searchParams.get('ym') || '';

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(ym)) {
      setYearMonth(ym);
    }
  }, [setYearMonth, ym]);

  const project = useMemo(() => (projectId ? getProjectById(projectId) : undefined), [getProjectById, projectId]);

  if (!projectId || !project) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        프로젝트를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-base font-bold mb-3">{project.name} — 캐시플로</h2>
      <Tabs defaultValue="settlement">
        <TabsList>
          <TabsTrigger value="settlement">정산 대장</TabsTrigger>
          <TabsTrigger value="cashflow">캐시플로 시트</TabsTrigger>
        </TabsList>
        <TabsContent value="settlement">
          <SettlementLedgerPage projectId={projectId} projectName={project.name} />
        </TabsContent>
        <TabsContent value="cashflow">
          <CashflowProjectSheet projectId={projectId} projectName={project.name} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
