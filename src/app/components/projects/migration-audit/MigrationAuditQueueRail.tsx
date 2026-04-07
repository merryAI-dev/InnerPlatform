import { ArrowRight, Sparkles } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import type { MigrationAuditConsoleRecord, MigrationAuditConsoleSections } from '../../../platform/project-migration-console';
import type { ProjectMigrationStatus } from '../../../platform/project-migration-audit';
import type { ProjectMigrationCurrentRow } from '../../../platform/project-migration-audit';

const SECTION_META: Record<ProjectMigrationStatus, { title: string; empty: string; badgeClass: string }> = {
  MISSING: {
    title: '미등록',
    empty: '새 프로젝트 등록 또는 기존 프로젝트 연결이 필요한 행이 없습니다.',
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  CANDIDATE: {
    title: '후보 있음',
    empty: '사람 확인이 필요한 후보 행이 없습니다.',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  REGISTERED: {
    title: '완료',
    empty: '완료된 행이 없습니다.',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

interface MigrationAuditQueueRailProps {
  sections: MigrationAuditConsoleSections;
  currentOnlyRows: ProjectMigrationCurrentRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCurrentOnlyProject: (projectId: string) => void;
}

function renderSection(
  status: ProjectMigrationStatus,
  items: MigrationAuditConsoleRecord[],
  selectedId: string | null,
  onSelect: (id: string) => void,
) {
  const meta = SECTION_META[status];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{meta.title}</p>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <Card className="border-slate-200 bg-slate-50/80 shadow-none">
          <CardContent className="p-3 text-[11px] leading-5 text-slate-500">{meta.empty}</CardContent>
        </Card>
      ) : items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`migration-audit-queue-item-${item.id}`}
            onClick={() => onSelect(item.id)}
            className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
              selected
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`text-[10px] ${selected ? 'border-white/20 bg-white/10 text-white' : meta.badgeClass}`}>
                    {meta.title}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${selected ? 'border-white/20 text-white' : 'border-slate-200 text-slate-600'}`}>
                    {item.cic}
                  </Badge>
                </div>
                <div>
                  <p className={`text-[12px] font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>
                    {item.sourceName}
                  </p>
                  <p className={`text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {item.matchLabel}
                  </p>
                </div>
              </div>
              <ArrowRight className={`h-4 w-4 ${selected ? 'text-slate-200' : 'text-slate-400'}`} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function MigrationAuditQueueRail({
  sections,
  currentOnlyRows,
  selectedId,
  onSelect,
  onOpenCurrentOnlyProject,
}: MigrationAuditQueueRailProps) {
  return (
    <Card className="border-slate-200/80 bg-white shadow-sm xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
      <CardContent className="space-y-4 p-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">작업 Queue</p>
              <p className="text-[13px] font-semibold text-slate-950">먼저 처리할 행부터 선택</p>
            </div>
          </div>
        </div>
        {renderSection('MISSING', sections.missing, selectedId, onSelect)}
        {currentOnlyRows.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">현재 프로젝트만 존재</p>
              <Badge variant="outline" className="text-[10px]">{currentOnlyRows.length}</Badge>
            </div>
            {currentOnlyRows.map((row) => (
              <button
                key={`current-only-${row.project.id}`}
                type="button"
                onClick={() => onOpenCurrentOnlyProject(row.project.id)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-left transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="border border-rose-200 bg-rose-50 text-rose-700 text-[10px]">미등록</Badge>
                      <Badge variant="outline" className="text-[10px] text-slate-600">{row.project.cic || row.project.department || '미지정'}</Badge>
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-slate-950">
                        {row.project.officialContractName || row.project.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        비교 기준 원본 없음 · 프로젝트 상세에서 정리
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        ) : null}
        {renderSection('CANDIDATE', sections.candidate, selectedId, onSelect)}
        {renderSection('REGISTERED', sections.registered, selectedId, onSelect)}
      </CardContent>
    </Card>
  );
}
