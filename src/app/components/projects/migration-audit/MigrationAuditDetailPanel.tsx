import {
  CheckCircle2,
  Loader2,
  PencilLine,
  Trash2,
} from 'lucide-react';
import type { Project } from '../../../data/types';
import {
  PROJECT_STATUS_LABELS,
} from '../../../data/types';
import {
  describeMigrationAuditActionState,
  type MigrationAuditConsoleRecord,
} from '../../../platform/project-migration-console';
import { buildMigrationReviewDossier } from '../../../platform/project-migration-review-dossier';
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
  proposalProjects: Project[];
  selectedProjectId: string;
  selectedTargetProject: Project | null;
  onApplyMatch: () => void;
  selectedProposalId: string;
  proposalDraftName: string;
  onProposalDraftNameChange: (value: string) => void;
  proposalDraftOfficialContractName: string;
  onProposalDraftOfficialContractNameChange: (value: string) => void;
  proposalDraftClientOrg: string;
  onProposalDraftClientOrgChange: (value: string) => void;
  onSaveProposal: () => void;
  onTrashProposal: () => void;
  linking: boolean;
  savingProposal: boolean;
  trashingProjectId: string | null;
  onTrashDuplicate: (project: Project) => void;
}

export function MigrationAuditDetailPanel({
  record,
  cicOptions,
  selectedCic,
  onSelectedCicChange,
  proposalProjects,
  selectedProjectId,
  selectedTargetProject,
  onApplyMatch,
  selectedProposalId,
  proposalDraftName,
  onProposalDraftNameChange,
  proposalDraftOfficialContractName,
  onProposalDraftOfficialContractNameChange,
  proposalDraftClientOrg,
  onProposalDraftClientOrgChange,
  onSaveProposal,
  onTrashProposal,
  linking,
  savingProposal,
  trashingProjectId,
  onTrashDuplicate,
}: MigrationAuditDetailPanelProps) {
  const availableCicOptions = Array.from(new Set(cicOptions));
  const selectedProposal = proposalProjects.find((project) => project.id === selectedProposalId) || null;
  const reviewProject = selectedProposal || selectedTargetProject || record?.match?.project || null;
  const dossier = record ? buildMigrationReviewDossier(record, reviewProject) : null;
  const actionState = record ? describeMigrationAuditActionState(record) : null;

  if (!record) {
    return (
      <Card className="border-slate-200/80 bg-white shadow-sm" data-testid="migration-review-dossier">
        <CardContent className="py-24 text-center text-[12px] text-muted-foreground">
          좌측 리스트에서 프로젝트 하나를 고르면, 여기서 PM 원문과 예산/인력을 읽고 임원 결정을 끝낼 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-slate-200/80 bg-white shadow-sm xl:h-[calc(100vh-8rem)]"
      data-testid="migration-review-dossier"
    >
      <CardHeader className="border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
              {record.status === 'MISSING' ? '연결 필요' : record.status === 'CANDIDATE' ? '검토중' : '완료'}
            </Badge>
            <Badge variant="outline">{selectedCic}</Badge>
            <Badge variant="outline">{record.sourceClientOrg || '발주기관 미지정'}</Badge>
          </div>
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-[24px] font-semibold tracking-[-0.03em] text-slate-950">
                {record.sourceName}
              </CardTitle>
              <p className="mt-1 text-[12px] leading-6 text-slate-600">
                PM이 포털에서 입력한 프로젝트 수정 원문, 예산, 등록 인력을 기준으로 심사합니다.
              </p>
            </div>
            {actionState ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] text-slate-500">현재 판단</p>
                <p className="mt-1 text-[14px] font-semibold text-slate-950">{actionState.label}</p>
                <p className="mt-1 text-[11px] text-slate-600">{actionState.helper}</p>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex h-[calc(100%-116px)] flex-col p-0">
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {dossier ? (
            <>
              <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">PM 등록 원문</p>
                    <p className="mt-1 text-[15px] font-semibold text-slate-950">
                      {selectedProposal ? '포털 프로젝트 수정 내용' : 'PM이 입력한 등록 원문'}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {reviewProject ? (PROJECT_STATUS_LABELS[reviewProject.status] || '상태 미지정') : '연결 전'}
                  </Badge>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>프로젝트명</Label>
                    <Input
                      value={selectedProposal ? proposalDraftName : dossier?.headerTitle || ''}
                      onChange={(event) => onProposalDraftNameChange(event.target.value)}
                      readOnly={!selectedProposal}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>정식 계약명</Label>
                    <Input
                      value={selectedProposal ? proposalDraftOfficialContractName : dossier?.identity.officialContractName || ''}
                      onChange={(event) => onProposalDraftOfficialContractNameChange(event.target.value)}
                      readOnly={!selectedProposal}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>발주기관</Label>
                    <Input
                      value={selectedProposal ? proposalDraftClientOrg : dossier?.identity.clientOrg || ''}
                      onChange={(event) => onProposalDraftClientOrgChange(event.target.value)}
                      readOnly={!selectedProposal}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>등록 조직</Label>
                    <Select value={selectedCic} onValueChange={onSelectedCicChange}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="CIC 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCicOptions.map((cic) => (
                          <SelectItem key={cic} value={cic}>{cic}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>담당 PM</Label>
                    <Input value={dossier?.identity.pmName || '-'} readOnly />
                  </div>
                  <div className="space-y-1.5">
                    <Label>담당조직</Label>
                    <Input value={dossier?.identity.department || '-'} readOnly />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">계약 및 운영 정보</p>
                  <p className="mt-1 text-[14px] font-semibold text-slate-950">프로젝트 수정 화면 기준 핵심 항목</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">사업 유형</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.projectTypeLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">사업 기간</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.periodLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">정산 유형</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.settlementTypeLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">정산 기준</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.basisLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">통장 유형</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.accountTypeLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">자금 입력 방식</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.contract.fundInputModeLabel || '-'}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">예산</p>
                  <p className="mt-1 text-[14px] font-semibold text-slate-950">PM이 입력한 재무 기준을 그대로 확인</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">총사업비</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.budget.contractAmountLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">매출부가세</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.budget.salesVatAmountLabel || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 xl:col-span-1">
                    <p className="text-[11px] text-slate-500">입금 계획</p>
                    <p className="mt-1 text-[13px] font-medium text-slate-950">{dossier?.budget.paymentPlanDesc || '-'}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">등록 인력</p>
                  <p className="mt-1 text-[14px] font-semibold text-slate-950">PM이 등록한 팀과 참여 인력</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                    <div>
                      <p className="text-[11px] text-slate-500">팀명</p>
                      <p className="mt-1 text-[13px] font-semibold text-slate-950">{dossier?.people.teamName || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">등록 인력</p>
                      {dossier?.people.members.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {dossier.people.members.map((member) => (
                            <Badge key={member} variant="outline" className="h-auto rounded-full px-3 py-1 text-[11px]">
                              {member}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-[12px] text-slate-500">등록 인력 정보 없음</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">목적 및 메모</p>
                  <p className="mt-1 text-[14px] font-semibold text-slate-950">임원이 판단할 때 필요한 원문 설명</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">프로젝트 목적</p>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-900">{dossier?.notes.projectPurpose || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] text-slate-500">참여 조건 / 비고</p>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-900">{dossier?.notes.participantCondition || '-'}</p>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <p className="text-[12px] text-slate-500">
                아직 심사할 프로젝트 원문이 없습니다. 좌측에서 PM 등록 제안이나 연결 대상을 고르면 상세 정보가 표시됩니다.
              </p>
            </section>
          )}
        </div>

        <div
          className="border-t border-slate-200 bg-white/95 px-6 py-4"
          data-testid="migration-review-decision-footer"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">임원 결정</p>
              <p className="mt-1 text-[12px] text-slate-600">
                우측 원문을 충분히 읽은 뒤 이 제안을 우리 사업으로 승인하거나, 수정 요청 후 반려하거나, 중복으로 폐기합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-10 gap-1.5"
                onClick={onApplyMatch}
                disabled={!selectedProjectId || linking}
              >
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                우리 사업으로 승인
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5"
                onClick={onSaveProposal}
                disabled={!selectedProposal || savingProposal}
              >
                {savingProposal ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                수정 요청 후 반려
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                onClick={() => {
                  if (selectedProposal) {
                    onTrashProposal();
                    return;
                  }
                  if (selectedTargetProject) {
                    onTrashDuplicate(selectedTargetProject);
                  }
                }}
                disabled={(!selectedProposal && !selectedTargetProject) || (!!selectedProposal && trashingProjectId === selectedProposal.id)}
              >
                {trashingProjectId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                중복·폐기
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
