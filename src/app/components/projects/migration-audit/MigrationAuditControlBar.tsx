import { AlertTriangle, Plus, RefreshCw, Search } from 'lucide-react';
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
import {
  buildMigrationAuditOperatorSummary,
  type MigrationAuditConsoleSummary,
} from '../../../platform/project-migration-console';
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
  const operatorSummary = buildMigrationAuditOperatorSummary(summary);
  const metrics = [
    { label: '미등록', value: summary.missing, tone: 'border-rose-200 bg-rose-50 text-rose-700' },
    { label: '후보 검토', value: summary.candidate, tone: 'border-amber-200 bg-amber-50 text-amber-700' },
    { label: '연결 완료', value: summary.registered, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { label: '등록 조직 미지정', value: summary.unassignedCic, tone: 'border-slate-200 bg-slate-50 text-slate-700' },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-slate-200/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">운영 포커스</p>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">{operatorSummary.headline}</h2>
                <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                  완료율 {summary.completionRatio == null ? '-' : `${summary.completionRatio.toFixed(1)}%`}
                </Badge>
              </div>
              <p className="text-[12px] leading-6 text-slate-600">{operatorSummary.caption}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={onStartQuickCreate}>
                <Plus className="h-3.5 w-3.5" />
                빠른 등록 시작
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={syncDisabled || syncPending}
                className="gap-1.5"
                onClick={onSync}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncPending ? 'animate-spin' : ''}`} />
                기준 다시 적재
              </Button>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {metrics.map((metric) => (
              <Badge key={metric.label} className={`h-8 gap-1 rounded-full border px-3 text-[11px] ${metric.tone}`}>
                <span>{metric.label}</span>
                <span className="font-semibold">{metric.value}</span>
              </Badge>
            ))}
            <Badge variant="outline" className="h-8 gap-1 rounded-full border-slate-200 bg-white px-3 text-[11px] text-slate-700">
              전체 {summary.total}건
            </Badge>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="원본 사업명, 플랫폼 프로젝트, 발주기관, 등록 조직으로 검색"
                className="pl-9"
              />
            </div>
            <Select value={cicFilter} onValueChange={onCicFilterChange}>
              <SelectTrigger>
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
              <SelectTrigger>
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="MISSING">미등록</SelectItem>
                <SelectItem value="CANDIDATE">후보 검토</SelectItem>
                <SelectItem value="REGISTERED">완료</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 text-[12px] text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>좌측 queue에서 먼저 고르고, 우측에서 연결 또는 빠른 등록만 끝내면 됩니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
