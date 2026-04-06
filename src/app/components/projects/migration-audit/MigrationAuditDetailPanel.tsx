import {
  ArrowRight,
  CheckCircle2,
  FolderPlus,
  Link2,
  Loader2,
  PencilLine,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Project, ProjectStatus } from '../../../data/types';
import { PROJECT_STATUS_LABELS } from '../../../data/types';
import {
  describeMigrationAuditActionState,
  type MigrationAuditConsoleRecord,
} from '../../../platform/project-migration-console';
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

interface MigrationAuditDetailPanelProps {
  record: MigrationAuditConsoleRecord | null;
  cicOptions: string[];
  selectedCic: string;
  onSelectedCicChange: (value: string) => void;
  suggestedProjects: Project[];
  proposalProjects: Project[];
  duplicateProjects: Project[];
  selectedProjectId: string;
  selectedTargetProject: Project | null;
  onChooseTargetProject: (project: Project) => void;
  selectedProjectStatus: ProjectStatus;
  onSelectedProjectStatusChange: (value: ProjectStatus) => void;
  onApplyMatch: () => void;
  selectedProposalId: string;
  onSelectedProposalIdChange: (value: string) => void;
  proposalDraftName: string;
  onProposalDraftNameChange: (value: string) => void;
  proposalDraftOfficialContractName: string;
  onProposalDraftOfficialContractNameChange: (value: string) => void;
  proposalDraftClientOrg: string;
  onProposalDraftClientOrgChange: (value: string) => void;
  onSaveProposal: () => void;
  onTrashProposal: () => void;
  quickCreateName: string;
  onQuickCreateNameChange: (value: string) => void;
  onQuickCreate: () => void;
  linking: boolean;
  creating: boolean;
  savingProposal: boolean;
  trashingProjectId: string | null;
  onTrashDuplicate: (project: Project) => void;
}

function statusBadgeClass(status: MigrationAuditConsoleRecord['status']): string {
  if (status === 'MISSING') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'CANDIDATE') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function projectLabel(project: Project): string {
  return project.officialContractName || project.name || '이름 없음';
}

function renderProjectMeta(project: Project): string {
  const parts = [
    resolveProjectCic(project) || '미지정',
    PROJECT_STATUS_LABELS[project.status],
    project.clientOrg || '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function MigrationAuditDetailPanel({
  record,
  cicOptions,
  selectedCic,
  onSelectedCicChange,
  suggestedProjects,
  proposalProjects,
  duplicateProjects,
  selectedProjectId,
  selectedTargetProject,
  onChooseTargetProject,
  selectedProjectStatus,
  onSelectedProjectStatusChange,
  onApplyMatch,
  selectedProposalId,
  onSelectedProposalIdChange,
  proposalDraftName,
  onProposalDraftNameChange,
  proposalDraftOfficialContractName,
  onProposalDraftOfficialContractNameChange,
  proposalDraftClientOrg,
  onProposalDraftClientOrgChange,
  onSaveProposal,
  onTrashProposal,
  quickCreateName,
  onQuickCreateNameChange,
  onQuickCreate,
  linking,
  creating,
  savingProposal,
  trashingProjectId,
  onTrashDuplicate,
}: MigrationAuditDetailPanelProps) {
  const availableCicOptions = Array.from(new Set(cicOptions));
  const selectedProposal = proposalProjects.find((project) => project.id === selectedProposalId) || null;

  if (!record) {
    return (
      <Card className="border-slate-200/80 bg-white shadow-sm">
        <CardContent className="py-20 text-center text-[12px] text-muted-foreground">
          좌측 queue에서 행을 하나 선택하면 여기서 등록 제안 검토, 중복 정리, 기존 프로젝트 연결을 한 번에 처리할 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  const actionState = describeMigrationAuditActionState(record);
  const actionToneClass = actionState.tone === 'danger'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : actionState.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <div className="space-y-4 xl:sticky xl:top-24">
      <Card className="border-slate-200/80 bg-white shadow-sm" data-testid="migration-audit-detail-panel">
        <CardHeader className="border-b border-slate-200 pb-4">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`border ${statusBadgeClass(record.status)}`}>
                  {record.status === 'MISSING' ? '연결 필요' : record.status === 'CANDIDATE' ? '후보 검토' : '연결 완료'}
                </Badge>
                <Badge variant="outline">{selectedCic}</Badge>
              </div>
              <CardTitle className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">
                {record.sourceName}
              </CardTitle>
              <p className="text-[12px] leading-6 text-slate-600">
                {record.sourceDepartment || '담당조직 없음'} · {record.sourceClientOrg || '발주기관 없음'}
              </p>
            </div>
            <div className={`rounded-2xl border px-4 py-3 ${actionToneClass}`}>
              <p className="text-[11px]">현재 판단</p>
              <p className="mt-1 text-[14px] font-semibold">{actionState.label}</p>
              <p className="mt-1 text-[11px] opacity-90">{actionState.helper}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
          <div className="space-y-4">
            <Card className="border-slate-200 bg-slate-50/70 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-[14px] font-semibold">원본 사업 기준</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] text-slate-500">원본 사업명</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-950">{record.sourceName}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] text-slate-500">등록 조직</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-950">{selectedCic}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] text-slate-500">현재 연결 결과</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-950">{record.matchLabel}</p>
                </div>
              </CardContent>
            </Card>

            {proposalProjects.length > 0 ? (
              <Card className="border-sky-200 bg-sky-50/70 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[14px] font-semibold">등록 제안 프로젝트 검토</CardTitle>
                    <Badge variant="outline" className="bg-white">{proposalProjects.length}건</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <>
                    <div className="space-y-2">
                      {proposalProjects.map((project) => {
                        const selected = project.id === selectedProposalId;
                        const chosenAsTarget = project.id === selectedProjectId;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => onSelectedProposalIdChange(project.id)}
                            className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                              selected
                                ? 'border-sky-400 bg-white shadow-sm'
                                : 'border-sky-100 bg-white/80 hover:border-sky-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-[12px] font-semibold text-slate-950">{projectLabel(project)}</p>
                                  {chosenAsTarget ? (
                                    <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                                      연결 대상으로 선택됨
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">{renderProjectMeta(project)}</p>
                              </div>
                              <Sparkles className={`h-4 w-4 ${selected ? 'text-sky-600' : 'text-sky-300'}`} />
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedProposal ? (
                      <div className="space-y-3 rounded-2xl border border-sky-200 bg-white px-4 py-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>등록 프로젝트명</Label>
                            <Input value={proposalDraftName} onChange={(event) => onProposalDraftNameChange(event.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>공식 계약명</Label>
                            <Input
                              value={proposalDraftOfficialContractName}
                              onChange={(event) => onProposalDraftOfficialContractNameChange(event.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>발주기관</Label>
                            <Input
                              value={proposalDraftClientOrg}
                              onChange={(event) => onProposalDraftClientOrgChange(event.target.value)}
                              placeholder="예: KOICA"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>등록 조직</Label>
                            <Select value={selectedCic} onValueChange={onSelectedCicChange}>
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="등록 조직 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableCicOptions.map((cic) => (
                                  <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={onSaveProposal} disabled={savingProposal}>
                            {savingProposal ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                            제안 수정 저장
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 gap-1.5"
                            onClick={() => onChooseTargetProject(selectedProposal)}
                          >
                            <Link2 className="h-4 w-4" />
                            이 제안으로 연결
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={onTrashProposal}
                            disabled={trashingProjectId === selectedProposal.id}
                          >
                            {trashingProjectId === selectedProposal.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            제안 폐기
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                </CardContent>
              </Card>
            ) : null}

            {duplicateProjects.length > 0 ? (
              <Card className="border-amber-200 bg-amber-50/70 shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[14px] font-semibold">중복 의심 프로젝트</CardTitle>
                    <Badge variant="outline" className="bg-white">{duplicateProjects.length}건</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {duplicateProjects.map((project) => (
                    <div key={project.id} className="rounded-2xl border border-amber-100 bg-white px-3 py-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12px] font-semibold text-slate-950">{projectLabel(project)}</p>
                            {project.id === selectedProjectId ? (
                              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                                현재 연결 대상
                              </Badge>
                            ) : null}
                            {project.registrationSource === 'pm_portal' ? (
                              <Badge variant="outline">포털 등록</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">{renderProjectMeta(project)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-9 gap-1.5" onClick={() => onChooseTargetProject(project)}>
                            <Link2 className="h-4 w-4" />
                            연결 대상으로 사용
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => onTrashDuplicate(project)}
                            disabled={trashingProjectId === project.id}
                          >
                            {trashingProjectId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            중복 폐기
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            <Card className="border-slate-200 bg-slate-50/70 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-[14px] font-semibold">기존 프로젝트 후보</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {suggestedProjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-[12px] text-slate-600">
                    자동 추천 후보가 없습니다. 등록 제안 프로젝트를 쓰거나 새 프로젝트를 바로 만들면 됩니다.
                  </div>
                ) : suggestedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onChooseTargetProject(project)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      project.id === selectedProjectId
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`text-[12px] font-semibold ${project.id === selectedProjectId ? 'text-white' : 'text-slate-950'}`}>
                            {projectLabel(project)}
                          </p>
                          {project.id === record.match?.project.id ? (
                            <Badge className={project.id === selectedProjectId ? 'border-white/20 bg-white/10 text-white' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}>
                              현재 연결
                            </Badge>
                          ) : null}
                        </div>
                        <p className={`mt-1 text-[11px] ${project.id === selectedProjectId ? 'text-slate-200' : 'text-slate-500'}`}>
                          {renderProjectMeta(project)}
                        </p>
                      </div>
                      <ArrowRight className={`h-4 w-4 ${project.id === selectedProjectId ? 'text-slate-200' : 'text-slate-400'}`} />
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-teal-200 bg-teal-50/70 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-[14px] font-semibold">새 프로젝트 직접 생성</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="등록 조직 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCicOptions.map((cic) => (
                        <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" className="h-9 w-full gap-1.5" onClick={onQuickCreate} disabled={!quickCreateName.trim() || creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                  새 프로젝트 등록 후 바로 선택
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-900 bg-slate-950 text-white shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-[14px] font-semibold text-white">최종 연결 확정</CardTitle>
                    <p className="mt-1 text-[12px] leading-6 text-slate-300">
                      이 row를 어떤 프로젝트로 귀속할지 마지막 한 번만 결정하면 됩니다.
                    </p>
                  </div>
                  <ShieldAlert className="h-5 w-5 text-slate-400" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                  <p className="text-[11px] text-slate-300">현재 선택된 연결 대상</p>
                  <p className="mt-1 text-[13px] font-semibold text-white">
                    {selectedTargetProject ? projectLabel(selectedTargetProject) : '아직 선택되지 않음'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {selectedTargetProject ? renderProjectMeta(selectedTargetProject) : '기존 후보, 등록 제안, 새 프로젝트 중 하나를 먼저 고르세요.'}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-slate-200">등록 조직</Label>
                    <Select value={selectedCic} onValueChange={onSelectedCicChange}>
                      <SelectTrigger className="h-9 border-white/15 bg-white/5 text-white">
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
                    <Label className="text-slate-200">연결 후 상태</Label>
                    <Select value={selectedProjectStatus} onValueChange={(value) => onSelectedProjectStatusChange(value as ProjectStatus)}>
                      <SelectTrigger className="h-9 border-white/15 bg-white/5 text-white">
                        <SelectValue placeholder="프로젝트 상태" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button type="button" className="h-10 w-full gap-1.5 bg-white text-slate-950 hover:bg-slate-100" onClick={onApplyMatch} disabled={!selectedProjectId || linking}>
                  {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  연결 확정
                </Button>

                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[12px] text-slate-300">
                  <div className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>등록 제안은 여기서 바로 수정하거나 폐기할 수 있고, 중복 의심 프로젝트도 정리한 뒤 같은 화면에서 연결을 끝낼 수 있습니다.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
