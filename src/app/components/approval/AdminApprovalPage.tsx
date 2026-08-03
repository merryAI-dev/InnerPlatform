import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { ProjectMigrationAuditPage } from '../projects/ProjectMigrationAuditPage';
import { MonthlySettlementApprovalSection } from './MonthlySettlementApprovalSection';
import { useAppStore } from '../../data/store';

export function AdminApprovalPage() {
  const { projects } = useAppStore();
  const [pendingMonthlySettlements, setPendingMonthlySettlements] = useState(0);
  const pendingProjectReviews = useMemo(
    () => projects.filter((project) => (
      (project.executiveReviewStatus || (project.registrationSource === 'pm_portal' ? 'PENDING' : 'APPROVED')) === 'PENDING'
    )),
    [projects],
  );
  const totalPending = pendingProjectReviews.length + pendingMonthlySettlements;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CheckCircle2}
        iconGradient="linear-gradient(135deg, #0f766e, #14b8a6)"
        title="승인 대기열"
        description="프로젝트 등록과 월 결산 요청을 최종 결재자 (사업총괄)가 확인하고 승인하거나 반려합니다"
        badge={`대기 ${totalPending}건`}
      />

      <Card className="border-slate-200 bg-white">
        <CardContent className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-600" style={{ fontWeight: 700 }}>대표 검토</p>
            <h2 className="text-[22px] tracking-[-0.04em] text-slate-950" style={{ fontWeight: 800 }}>프로젝트 등록 검토</h2>
            <p className="text-[12px] leading-6 text-slate-600">프로젝트 등록 요청부터 먼저 정리합니다. 계약 근거, 재무/정산, 검토 메모를 한 화면에서 보고 결정합니다.</p>
          </div>
          <Badge className="border-0 bg-[#001e46] text-white">등록 요청 우선</Badge>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-900">승인 대기 항목</p>
            <p className="text-[12px] leading-6 text-slate-600">실제 제출된 프로젝트 등록과 월 결산 문서만 표시합니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">전체 대기</p>
              <p className="text-[18px] font-bold text-slate-900">{totalPending}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">프로젝트 등록</p>
              <p className="text-[18px] font-bold text-slate-600">{pendingProjectReviews.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">월 결산</p>
              <p className="text-[18px] font-bold text-[#001e46]">{pendingMonthlySettlements}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {totalPending > 0 ? (
        <Card className="border-slate-200 bg-white">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white">
              <AlertTriangle className="h-4 w-4 text-red-700" />
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-slate-900">이번에 처리할 승인 항목이 남아 있습니다</p>
              <p className="text-[11px] leading-6 text-slate-600">
                프로젝트 등록 요청 {pendingProjectReviews.length}건과 월 결산 {pendingMonthlySettlements}건을 확인할 수 있습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <MonthlySettlementApprovalSection onPendingCountChange={setPendingMonthlySettlements} />
      <ProjectMigrationAuditPage embedded reviewScope="pending" />
    </div>
  );
}
