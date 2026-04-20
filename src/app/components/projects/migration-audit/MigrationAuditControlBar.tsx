import { Search } from 'lucide-react';
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
import type { MigrationAuditConsoleSummary } from '../../../platform/project-migration-console';
import type { ProjectMigrationStatus } from '../../../platform/project-migration-audit';

interface MigrationAuditControlBarProps {
  cicOptions: string[];
  cicFilter: string;
  onCicFilterChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'ALL' | ProjectMigrationStatus;
  onStatusFilterChange: (value: 'ALL' | ProjectMigrationStatus) => void;
  summary: MigrationAuditConsoleSummary;
}

export function MigrationAuditControlBar({
  cicOptions,
  cicFilter,
  onCicFilterChange,
  search,
  onSearchChange,
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
              PM 등록 프로젝트 심사
            </h2>
            <p className="mt-1 text-[12px] leading-6 text-slate-600">
              PM이 등록한 사업명을 먼저 검색하고, CIC와 상태로 좁힌 뒤 우측에서 원문을 검토합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="h-9 rounded-full border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-700">
              전체 {summary.total}건
            </Badge>
            <Badge className="h-9 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] text-rose-700">
              미등록 {summary.missing}
            </Badge>
            <Badge className="h-9 rounded-full border border-amber-200 bg-amber-50 px-3 text-[11px] text-amber-700">
              검토중 {summary.candidate}
            </Badge>
            <Badge className="h-9 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11px] text-emerald-700">
              완료 {summary.registered}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="사업명으로 검색"
              className="h-11 rounded-2xl border-slate-200 pl-10 text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-slate-500">CIC 필터</p>
            <Select value={cicFilter} onValueChange={onCicFilterChange}>
              <SelectTrigger className="h-11 rounded-2xl border-slate-200 text-[13px]">
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
            <p className="text-[11px] font-medium text-slate-500">상태 필터</p>
            <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as 'ALL' | ProjectMigrationStatus)}>
              <SelectTrigger className="h-11 rounded-2xl border-slate-200 text-[13px]">
                <SelectValue placeholder="전체 상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="MISSING">미등록</SelectItem>
                <SelectItem value="CANDIDATE">검토중</SelectItem>
                <SelectItem value="REGISTERED">완료</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
