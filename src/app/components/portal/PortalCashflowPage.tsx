import { useMemo, useState } from 'react';
import { Pencil, Search, Settings } from 'lucide-react';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { CashflowSheetLabPage } from '../../features/cashflow-sheet-compare/CashflowSheetLabPage';
import { usePortalStore } from '../../data/portal-store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

export function PortalCashflowPage() {
  const {
    activeProjectId,
    portalUser,
    myProject,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();

  const projectId = activeProjectId || myProject?.id || '';
  const [sheetHeader, setSheetHeader] = useState({
    spreadsheetTitle: '저장된 시트',
    sheetName: 'cashflow(사용내역 연동)',
    startWeek: '',
    endWeek: '',
  });

  const ready = useMemo(() => Boolean(projectId), [projectId]);
  const sheetRangeLabel = sheetHeader.startWeek || sheetHeader.endWeek
    ? `합계 기준 ${sheetHeader.startWeek || '시작 미지정'} ~ ${sheetHeader.endWeek || '종료 미지정'}`
    : '합계 기준 미지정';
  const dispatchSheetAction = (action: 'apply' | 'preview' | 'edit') => {
    window.dispatchEvent(new CustomEvent('mysc:cashflow-sheet-lab-action', {
      detail: { action, projectId },
    }));
  };

  if (!ready) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[12px] font-semibold text-slate-950">
              {sheetHeader.spreadsheetTitle || myProject?.name || '저장된 시트'}
            </div>
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[9px] text-blue-700">
              시트 연동
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-slate-500">
            {sheetHeader.sheetName || 'cashflow(사용내역 연동)'} · {sheetRangeLabel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 rounded-none px-2 text-[10px]"
            onClick={() => dispatchSheetAction('apply')}
          >
            <Settings className="h-3 w-3" />
            시트와 연동하기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-none px-2 text-[10px]"
            onClick={() => dispatchSheetAction('preview')}
          >
            <Search className="h-3 w-3" />
            검토
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-none px-2 text-[10px]"
            onClick={() => dispatchSheetAction('edit')}
          >
            <Pencil className="h-3 w-3" />
            수정
          </Button>
        </div>
      </section>
      <CashflowSheetLabPage
        projectIdOverride={projectId}
        embedded
        hideConfigChrome
        onHeaderSummaryChange={setSheetHeader}
      />
      <CashflowProjectSheet
        projectId={projectId}
        roleOverride={portalUser?.role}
        onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
      />
    </div>
  );
}
