import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import type {
  MigrationAuditConsoleRecord,
  MigrationAuditConsoleStatus,
} from '../../../platform/project-migration-console';
import { getMigrationAuditStatusLabel } from '../../../platform/project-migration-console';

interface MigrationAuditQueueRailProps {
  records: MigrationAuditConsoleRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function statusClass(status: MigrationAuditConsoleStatus) {
  if (status === 'APPROVED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'REVISION_REJECTED') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'DUPLICATE_DISCARDED') return 'border-slate-300 bg-slate-100 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function formatRequestedAt(value: string) {
  return String(value || '').slice(0, 10).replace(/-/g, '.');
}

export function MigrationAuditQueueRail({
  records,
  selectedId,
  onSelect,
}: MigrationAuditQueueRailProps) {
  return (
    <Card
      className="border-slate-200/80 bg-white shadow-sm xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)]"
      data-testid="migration-review-queue"
    >
      <CardContent className="flex h-full flex-col p-0">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <ClipboardCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">PM Registration Queue</p>
              <p className="text-[14px] font-semibold text-slate-950">임원 검토 대기함</p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {records.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-[12px] text-slate-500">
              현재 필터에 맞는 PM 등록 프로젝트가 없습니다.
            </div>
          ) : null}

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
                        {getMigrationAuditStatusLabel(item.status)}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${selected ? 'border-white/20 text-white' : 'border-slate-200 text-slate-600'}`}>
                        {item.cic}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className={`truncate text-[13px] font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>
                        {item.title}
                      </p>
                      <p className={`truncate text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        {item.clientOrg || '발주기관 미지정'}
                      </p>
                      <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                        <span>PM {item.managerName || '미지정'}</span>
                        <span>접수 {formatRequestedAt(item.requestedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <ArrowRight className={`mt-1 h-4 w-4 shrink-0 ${selected ? 'text-slate-200' : 'text-slate-400'}`} />
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
