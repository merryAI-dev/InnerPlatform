import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
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
  statusFilter: 'ALL' | MigrationAuditConsoleStatus;
  onStatusFilterChange: (value: 'ALL' | MigrationAuditConsoleStatus) => void;
  summary: MigrationAuditConsoleSummary;
}

export function MigrationAuditControlBar({
  cicOptions,
  cicFilter,
  onCicFilterChange,
  statusFilter,
  onStatusFilterChange,
  summary,
}: MigrationAuditControlBarProps) {
  return (
    <Card className="border-slate-200/80 bg-white/95 shadow-sm" data-testid="migration-review-search-bar">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Executive Review</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-slate-950">
              PM 등록 프로젝트 리뷰
            </h2>
            <p className="mt-1 text-[12px] leading-6 text-slate-600">
              CIC와 상태만 먼저 좁힌 뒤, 우측에서 PM이 포털에서 입력한 내용을 그대로 읽고 CIC 대표 리뷰 판단을 내립니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="h-9 rounded-full border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-700">
              전체 {summary.total}건
            </Badge>
            <Badge className="h-9 rounded-full border border-amber-200 bg-amber-50 px-3 text-[11px] text-amber-700">
              검토 대기 {summary.pending}
            </Badge>
            <Badge className="h-9 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11px] text-emerald-700">
              승인 완료 {summary.approved}
            </Badge>
            <Badge className="h-9 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] text-rose-700">
              반려 {summary.rejected}
            </Badge>
            <Badge className="h-9 rounded-full border border-slate-300 bg-slate-100 px-3 text-[11px] text-slate-700">
              폐기 {summary.discarded}
            </Badge>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(280px,360px)]">
          <div className="space-y-1.5">
            <p className="text-[12px] font-semibold text-slate-600">CIC 필터</p>
            <Select value={cicFilter} onValueChange={onCicFilterChange}>
              <SelectTrigger className="h-14 rounded-2xl border-2 border-slate-300 bg-white px-4 text-[15px] font-medium shadow-sm">
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
              <SelectTrigger className="h-14 rounded-2xl border-2 border-slate-300 bg-white px-4 text-[15px] font-medium shadow-sm">
                <SelectValue placeholder="전체 상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="PENDING">검토 대기</SelectItem>
                <SelectItem value="APPROVED">승인 완료</SelectItem>
                <SelectItem value="REVISION_REJECTED">수정 요청 후 반려</SelectItem>
                <SelectItem value="DUPLICATE_DISCARDED">중복·폐기</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
