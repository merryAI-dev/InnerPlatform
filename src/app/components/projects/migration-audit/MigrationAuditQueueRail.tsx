import { ArrowRight, Users } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import type {
  MigrationAuditConsoleRecord,
  MigrationAuditConsoleSections,
} from '../../../platform/project-migration-console';
import type { ProjectMigrationCurrentRow } from '../../../platform/project-migration-audit';
import { normalizeCicLabel } from '../../../platform/project-migration-console';
import { resolveProjectCic } from '../../../platform/project-cic';

interface MigrationAuditQueueRailProps {
  sections: MigrationAuditConsoleSections;
  currentOnlyRows: ProjectMigrationCurrentRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCurrentOnlyProject: (projectId: string) => void;
}

function statusLabel(status: MigrationAuditConsoleRecord['status']) {
  if (status === 'MISSING') return '연결 필요';
  if (status === 'CANDIDATE') return '검토중';
  return '완료';
}

function statusClass(status: MigrationAuditConsoleRecord['status']) {
  if (status === 'MISSING') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'CANDIDATE') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function queueSort(records: MigrationAuditConsoleRecord[]) {
  const rank: Record<MigrationAuditConsoleRecord['status'], number> = {
    MISSING: 0,
    CANDIDATE: 1,
    REGISTERED: 2,
  };
  return [...records].sort((left, right) => {
    const rankDiff = rank[left.status] - rank[right.status];
    if (rankDiff !== 0) return rankDiff;
    return left.sourceName.localeCompare(right.sourceName, 'ko');
  });
}

export function MigrationAuditQueueRail({
  sections,
  currentOnlyRows,
  selectedId,
  onSelect,
  onOpenCurrentOnlyProject,
}: MigrationAuditQueueRailProps) {
  const records = queueSort([
    ...sections.missing,
    ...sections.candidate,
    ...sections.registered,
  ]);

  return (
    <Card
      className="border-slate-200/80 bg-white shadow-sm xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)]"
      data-testid="migration-review-queue"
    >
      <CardContent className="flex h-full flex-col p-0">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Review Queue</p>
              <p className="text-[14px] font-semibold text-slate-950">검색된 프로젝트 제안</p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {records.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                  selected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`text-[10px] ${selected ? 'border-white/20 bg-white/10 text-white' : statusClass(item.status)}`}>
                        {statusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${selected ? 'border-white/20 text-white' : 'border-slate-200 text-slate-600'}`}>
                        {item.cic}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className={`truncate text-[13px] font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>
                        {item.sourceName}
                      </p>
                      <p className={`truncate text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        {item.sourceClientOrg || '발주기관 미지정'}
                      </p>
                      <p className={`truncate text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        PM 기준: {item.candidate.coreMembers || '담당 정보 없음'}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className={`mt-1 h-4 w-4 shrink-0 ${selected ? 'text-slate-200' : 'text-slate-400'}`} />
                </div>
              </button>
            );
          })}

          {currentOnlyRows.length > 0 ? (
            <div className="pt-3">
              <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                기존 시스템에만 있는 프로젝트
              </p>
              <div className="space-y-2">
                {currentOnlyRows.map((row) => (
                  <button
                    key={`current-only-${row.project.id}`}
                    type="button"
                    onClick={() => onOpenCurrentOnlyProject(row.project.id)}
                    className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge className="border border-slate-200 bg-white text-[10px] text-slate-700">PM 등록 없음</Badge>
                          <Badge variant="outline" className="text-[10px] text-slate-600">
                            {normalizeCicLabel(resolveProjectCic(row.project))}
                          </Badge>
                        </div>
                        <p className="text-[12px] font-semibold text-slate-950">
                          {row.project.officialContractName || row.project.name}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
