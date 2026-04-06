import { ArrowRight, CheckCircle2, FolderPlus, Link2, Loader2 } from 'lucide-react';
import type { Project } from '../../../data/types';
import type { MigrationAuditConsoleRecord } from '../../../platform/project-migration-console';
import { resolveProjectCic } from '../../../platform/project-cic';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { PROJECT_STATUS_LABELS, type ProjectStatus } from '../../../data/types';

interface MigrationAuditDetailPanelProps {
  record: MigrationAuditConsoleRecord | null;
  cicOptions: string[];
  selectedCic: string;
  onSelectedCicChange: (value: string) => void;
  suggestedProjects: Project[];
  selectedProjectId: string;
  onSelectedProjectIdChange: (value: string) => void;
  selectedProjectStatus: ProjectStatus;
  onSelectedProjectStatusChange: (value: ProjectStatus) => void;
  onApplyMatch: () => void;
  quickCreateName: string;
  onQuickCreateNameChange: (value: string) => void;
  onQuickCreate: () => void;
  linking: boolean;
  creating: boolean;
}

export function MigrationAuditDetailPanel({
  record,
  cicOptions,
  selectedCic,
  onSelectedCicChange,
  suggestedProjects,
  selectedProjectId,
  onSelectedProjectIdChange,
  selectedProjectStatus,
  onSelectedProjectStatusChange,
  onApplyMatch,
  quickCreateName,
  onQuickCreateNameChange,
  onQuickCreate,
  linking,
  creating,
}: MigrationAuditDetailPanelProps) {
  const availableCicOptions = Array.from(new Set(cicOptions));

  if (!record) {
    return (
      <Card className="border-slate-200/80 bg-white shadow-sm">
        <CardContent className="py-20 text-center text-[12px] text-muted-foreground">
          좌측 queue에서 행을 하나 선택하면 여기서 바로 연결 또는 새 프로젝트 등록을 처리할 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  const statusTone = record.status === 'MISSING'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : record.status === 'CANDIDATE'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <div className="space-y-4 xl:sticky xl:top-24">
      <Card className="border-slate-200/80 bg-white shadow-sm" data-testid="migration-audit-detail-panel">
        <CardHeader className="border-b border-slate-200 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`border ${statusTone}`}>{record.status === 'MISSING' ? '미등록' : record.status === 'CANDIDATE' ? '후보 있음' : '완료'}</Badge>
                <Badge variant="outline">{selectedCic}</Badge>
              </div>
              <CardTitle className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">
                {record.sourceName}
              </CardTitle>
              <p className="text-[12px] leading-6 text-slate-600">
                {record.sourceDepartment || '담당조직 없음'} · {record.sourceClientOrg || '발주기관 없음'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
              <p className="text-[11px] text-slate-500">현재 매칭</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-950">{record.matchLabel}</p>
              <p className="mt-1 text-[11px] text-slate-500">{record.nextActionLabel}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="border-slate-200 bg-slate-50/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-[14px] font-semibold">기존 프로젝트에 연결</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>등록 조직</Label>
                <Select value={selectedCic} onValueChange={onSelectedCicChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="등록 조직 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCicOptions.map((cic) => (
                      <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>추천 후보 프로젝트</Label>
                <Select value={selectedProjectId} onValueChange={onSelectedProjectIdChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="프로젝트 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {suggestedProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {(project.officialContractName || project.name)} · {resolveProjectCic(project) || '미지정'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>연결 후 상태</Label>
                <Select value={selectedProjectStatus} onValueChange={(value) => onSelectedProjectStatusChange(value as ProjectStatus)}>
                  <SelectTrigger>
                    <SelectValue placeholder="프로젝트 상태" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" className="w-full gap-1.5" onClick={onApplyMatch} disabled={!selectedProjectId || linking}>
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                연결 내용 반영
              </Button>
            </CardContent>
          </Card>

          <Card className="border-sky-200 bg-sky-50/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-[14px] font-semibold">새 프로젝트 빠른 등록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-sky-200 bg-white/80 px-3 py-3 text-[12px] text-slate-600">
                이 row의 계약명은 자동으로 <span className="font-medium text-slate-950">{record.sourceName}</span> 으로 반영됩니다.
              </div>
              <div className="space-y-1.5">
                <Label>프로젝트명</Label>
                <Input
                  value={quickCreateName}
                  onChange={(event) => onQuickCreateNameChange(event.target.value)}
                  placeholder="예: 2026 에코스타트업 운영"
                />
              </div>
              <div className="space-y-1.5">
                <Label>등록 조직</Label>
                <Select value={selectedCic} onValueChange={onSelectedCicChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="등록 조직 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableCicOptions.map((cic) => (
                      <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" className="w-full gap-1.5" onClick={onQuickCreate} disabled={!quickCreateName.trim() || creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                새 프로젝트 등록 후 즉시 연결
              </Button>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-[14px] font-semibold">현재 판단 요약</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[11px] text-slate-500">원본 사업</p>
            <p className="mt-1 text-[13px] font-medium text-slate-950">{record.sourceName}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[11px] text-slate-500">현재 연결 결과</p>
            <p className="mt-1 text-[13px] font-medium text-slate-950">{record.matchLabel}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[11px] text-slate-500">다음 액션</p>
            <div className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-slate-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {record.nextActionLabel}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 md:col-span-3">
            <div className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <ArrowRight className="h-3.5 w-3.5" />
              연결을 반영하면 선택한 프로젝트의 계약명과 CIC가 이 row 기준으로 정리됩니다.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
