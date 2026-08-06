import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { CashflowProjectSheet } from './CashflowProjectSheet';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';

export function ProjectCashflowSheetPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const { getProjectById, members, patchProjectSnapshot } = useAppStore();
  const { setYearMonth } = useCashflowWeeks();

  const ym = searchParams.get('ym') || '';
  const viewParam = searchParams.get('view');
  const initialViewMode = viewParam === 'projection' || viewParam === 'actual' || viewParam === 'compare'
    ? viewParam
    : 'compare';

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
    <CashflowProjectSheet
      key={projectId}
      projectId={projectId}
      projectName={project.name}
      project={project}
      members={members}
      onExecutiveApproverSaved={(result) => patchProjectSnapshot({ ...project, ...result })}
      initialViewMode={initialViewMode}
    />
  );
}
