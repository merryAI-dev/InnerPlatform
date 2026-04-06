import { AlertTriangle, Filter, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import { Input } from '../../ui/input';
import { Badge } from '../../ui/badge';
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
  syncDisabled: boolean;
  syncPending: boolean;
  onSync: () => void;
  onStartQuickCreate: () => void;
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
  syncDisabled,
  syncPending,
  onSync,
  onStartQuickCreate,
}: MigrationAuditControlBarProps) {
  const metrics = [
    { label: '미등록', value: summary.missing, tone: 'text-rose-600' },
    { label: '후보 있음', value: summary.candidate, tone: 'text-amber-600' },
    { label: '완료', value: summary.registered, tone: 'text-emerald-600' },
    { label: '등록 조직 미지정', value: summary.unassignedCic, tone: 'text-slate-700' },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-slate-200/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="원본 사업명, 플랫폼 프로젝트, 발주기관, 등록 조직으로 검색"
                className="pl-9"
              />
            </div>
            <Select value={cicFilter} onValueChange={onCicFilterChange}>
              <SelectTrigger className="w-full xl:w-[220px]">
                <SelectValue placeholder="등록 조직" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 등록 조직</SelectItem>
                {cicOptions.map((cic) => (
                  <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as 'ALL' | ProjectMigrationStatus)}>
              <SelectTrigger className="w-full xl:w-[180px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="MISSING">미등록</SelectItem>
                <SelectItem value="CANDIDATE">후보 있음</SelectItem>
                <SelectItem value="REGISTERED">완료</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" className="gap-1.5" onClick={onStartQuickCreate}>
              <Plus className="h-3.5 w-3.5" />
              새 프로젝트 빠른 등록
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {metrics.map((metric) => (
              <Card key={metric.label} className="border-slate-200 bg-slate-50/70 shadow-none">
                <CardContent className="p-4">
                  <p className="text-[11px] text-muted-foreground">{metric.label}</p>
                  <p className={`mt-2 text-2xl font-semibold ${metric.tone}`}>{metric.value}</p>
                </CardContent>
              </Card>
            ))}
            <Card className="border-sky-200/80 bg-sky-50/70 shadow-none">
              <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
                <div>
                  <p className="text-[11px] text-sky-700">완료율</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">
                    {summary.completionRatio == null ? '-' : `${summary.completionRatio.toFixed(1)}%`}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit border-sky-200 bg-white text-sky-700">
                  {summary.registered}/{summary.total}
                </Badge>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200/70 bg-amber-50/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">이 화면은 대조표보다 queue 중심으로 봅니다.</p>
              <p className="mt-1 text-amber-800/90">좌측에서 미등록 또는 후보 행을 먼저 고르고, 우측 detail panel에서 연결 또는 빠른 등록을 끝내세요.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncDisabled || syncPending}
              className="gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-white"
              onClick={onSync}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncPending ? 'animate-spin' : ''}`} />
              기준 다시 적재
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] text-amber-800/80">
              <Filter className="h-3.5 w-3.5" />
              선택한 등록 조직과 상태 기준으로 queue와 표가 함께 좁혀집니다.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
