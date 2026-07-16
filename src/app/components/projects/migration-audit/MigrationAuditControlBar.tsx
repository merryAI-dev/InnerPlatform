import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import { Input } from '../../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import type {
  MigrationAuditConsoleStatus,
  MigrationAuditConsoleSummary,
} from '../../../platform/project-migration-console';

interface MigrationAuditControlBarProps {
  cicOptions: string[];
  cicFilter: string;
  onCicFilterChange: (value: string) => void;
  inboxScope: 'MINE' | 'ALL';
  onInboxScopeChange: (value: 'MINE' | 'ALL') => void;
  reviewerDepartment: string;
  workflowStage: 'planning' | 'approval';
  statusFilter: 'ALL' | MigrationAuditConsoleStatus;
  onStatusFilterChange: (value: 'ALL' | MigrationAuditConsoleStatus) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  summary: MigrationAuditConsoleSummary;
}

export function MigrationAuditControlBar({
  cicOptions,
  cicFilter,
  onCicFilterChange,
  inboxScope,
  onInboxScopeChange,
  reviewerDepartment,
  workflowStage,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  summary,
}: MigrationAuditControlBarProps) {
  const reviewTotal = summary.pending + summary.agreed + summary.approved + summary.rejected;
  const pendingCount = workflowStage === 'planning' ? summary.pending : summary.agreed;
  const pendingEnd = reviewTotal ? (summary.pending / reviewTotal) * 100 : 0;
  const agreedEnd = pendingEnd + (reviewTotal ? (summary.agreed / reviewTotal) * 100 : 0);
  const approvedEnd = agreedEnd + (reviewTotal ? (summary.approved / reviewTotal) * 100 : 0);
  const statusChartBackground = reviewTotal
    ? `conic-gradient(#174a7c 0 ${pendingEnd}%, #2563eb ${pendingEnd}% ${agreedEnd}%, #15803d ${agreedEnd}% ${approvedEnd}%, #b42318 ${approvedEnd}% 100%)`
    : '#e2e8f0';

  return (
    <Card className="border-slate-300 bg-white shadow-sm" data-testid="migration-review-search-bar">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{workflowStage === 'planning' ? '경영기획실 합의' : '조직장 결재'}</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-slate-950">
              {workflowStage === 'planning' ? '프로젝트 코드 부여·합의' : '프로젝트 최종 승인'}
            </h2>
            <p className="mt-1 text-[12px] leading-6 text-slate-600">
              {workflowStage === 'planning'
                ? '등록 원문을 확인한 뒤 프로젝트 코드를 부여하고 경영기획실 합의를 남깁니다.'
                : '경영기획실 합의가 끝난 문서를 열어 최종 승인 또는 반려합니다.'}
            </p>
          </div>
          <div className="flex items-center gap-4 border-l border-slate-200 pl-4">
            <div className="grid h-[78px] w-[78px] place-items-center rounded-full" role="img" aria-label={`합의 대기 ${summary.pending}건, 승인 대기 ${summary.agreed}건, 승인 완료 ${summary.approved}건, 반려 ${summary.rejected}건`} style={{ background: statusChartBackground }}>
              <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-white text-center text-[11px] font-semibold text-slate-700">{reviewTotal}<small className="block text-[9px] font-normal">건</small></span>
            </div>
            <dl className="grid grid-cols-3 divide-x divide-slate-200 text-center">
              <div className="px-3"><dt className="text-[10px] text-slate-500">{workflowStage === 'planning' ? '합의대기' : '승인대기'}</dt><dd className="mt-1 text-[15px] font-bold text-[#174a7c]">{pendingCount}</dd></div>
              <div className="px-3"><dt className="text-[10px] text-slate-500">승인완료</dt><dd className="mt-1 text-[15px] font-bold text-[#15803d]">{summary.approved}</dd></div>
              <div className="px-3"><dt className="text-[10px] text-slate-500">반려</dt><dd className="mt-1 text-[15px] font-bold text-[#b42318]">{summary.rejected}</dd></div>
            </dl>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(180px,230px)_minmax(180px,230px)_minmax(180px,230px)_minmax(260px,1fr)]">
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-600">검토함</p>
            <Select value={inboxScope} onValueChange={(value) => onInboxScopeChange(value as 'MINE' | 'ALL')}>
              <SelectTrigger className="h-11 rounded-none border-slate-300 bg-white px-3 text-[13px] font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MINE">내 검토함{reviewerDepartment ? ` · ${reviewerDepartment}` : ''}</SelectItem>
                <SelectItem value="ALL">전체 검토 문서</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-600">CIC 필터</p>
            <Select value={cicFilter} onValueChange={onCicFilterChange}>
              <SelectTrigger className="h-11 rounded-none border-slate-300 bg-white px-3 text-[13px] font-medium">
                <SelectValue placeholder="전체 CIC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 CIC</SelectItem>
                {cicOptions.map((cic) => (
                  <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-600">상태 필터</p>
            <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as 'ALL' | MigrationAuditConsoleStatus)}>
              <SelectTrigger className="h-11 rounded-none border-slate-300 bg-white px-3 text-[13px] font-medium">
                <SelectValue placeholder="전체 상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="PENDING">합의 대기</SelectItem>
                <SelectItem value="PLANNING_AGREED">합의 완료·승인 대기</SelectItem>
                <SelectItem value="APPROVED">승인 완료</SelectItem>
                <SelectItem value="REVISION_REJECTED">수정 요청 후 반려</SelectItem>
                <SelectItem value="DUPLICATE_DISCARDED">중복·폐기</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-600">프로젝트 검색</p>
            <Input
              id="migration-review-project-search"
              name="migrationReviewProjectSearch"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="프로젝트명, 등록 원문, 계약 대상, PM 검색"
              className="h-11 rounded-none border-slate-300 bg-white px-3 text-[13px] font-medium"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
