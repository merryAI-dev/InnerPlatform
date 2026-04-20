import {
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import type { MigrationAuditConsoleRecord } from '../../../platform/project-migration-console';
import {
  describeMigrationAuditActionState,
  getMigrationAuditStatusLabel,
} from '../../../platform/project-migration-console';
import { buildMigrationReviewDossier } from '../../../platform/project-migration-review-dossier';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

interface MigrationAuditDetailPanelProps {
  record: MigrationAuditConsoleRecord | null;
  acting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDiscard: () => void;
}

function statusStripClass(tone: 'warning' | 'success' | 'danger' | 'neutral') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50/90 text-emerald-900';
  if (tone === 'danger') return 'border-rose-200 bg-rose-50/90 text-rose-900';
  if (tone === 'neutral') return 'border-slate-300 bg-slate-100 text-slate-900';
  return 'border-amber-200 bg-amber-50/90 text-amber-900';
}

function DetailFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 font-medium text-slate-950">{value}</p>
    </div>
  );
}

export function MigrationAuditDetailPanel({
  record,
  acting,
  onApprove,
  onReject,
  onDiscard,
}: MigrationAuditDetailPanelProps) {
  if (!record) {
    return (
      <Card className="border-slate-200/80 bg-white shadow-sm" data-testid="migration-review-dossier">
        <CardContent className="py-24 text-center text-[12px] text-muted-foreground">
          좌측 대기함에서 PM 등록 프로젝트 하나를 고르면, 여기서 포털 원문과 예산·인력을 바로 읽고 임원 결정을 끝낼 수 있습니다.
        </CardContent>
      </Card>
    );
  }

  const dossier = buildMigrationReviewDossier(record.project, record.request);
  const actionState = describeMigrationAuditActionState(record);
  const isPmPortalProject = record.project.registrationSource === 'pm_portal';

  return (
    <Card
      className="border-slate-200/80 bg-white shadow-sm xl:h-[calc(100vh-8rem)]"
      data-testid="migration-review-dossier"
    >
      <CardHeader className="border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
              {getMigrationAuditStatusLabel(record.status)}
            </Badge>
            <Badge variant="outline">{record.cic}</Badge>
            <Badge variant="outline">{record.clientOrg || '발주기관 미지정'}</Badge>
            <Badge variant="outline">{isPmPortalProject ? 'PM 등록' : '기존 등록'}</Badge>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-[24px] font-semibold tracking-[-0.03em] text-slate-950">
                {record.title}
              </CardTitle>
              <p className="mt-1 text-[12px] leading-6 text-slate-600">
                {isPmPortalProject
                  ? 'PM이 포털에서 입력한 내용을 그대로 펼쳐서 보여줍니다. 임원은 우측 원문을 읽고 승인, 수정 요청 후 반려, 중복·폐기만 결정하면 됩니다.'
                  : '이미 등록된 기존 프로젝트입니다. 같은 화면에서 기존 프로젝트 정보와 예산·인력을 다시 읽을 수 있지만, 임원 승인 액션은 필요하지 않습니다.'}
              </p>
            </div>

            <div className={`rounded-2xl border px-4 py-3 ${statusStripClass(actionState.tone)}`}>
              <p className="text-[11px] uppercase tracking-[0.08em]">현재 판단</p>
              <p className="mt-1 text-[14px] font-semibold">{actionState.label}</p>
              <p className="mt-1 text-[11px] leading-5">{actionState.helper}</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex h-[calc(100%-124px)] flex-col p-0">
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">PM 등록 원문</p>
              <p className="mt-1 text-[15px] font-semibold text-slate-950">PM 포털 프로젝트 수정 화면 내용</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <DetailFact label="프로젝트명" value={dossier.headerTitle} />
              <DetailFact label="정식 계약명" value={dossier.identity.officialContractName} />
              <DetailFact label="발주기관" value={dossier.identity.clientOrg} />
              <DetailFact label="등록 조직(CIC)" value={dossier.identity.cic} />
              <DetailFact label="담당 PM" value={dossier.identity.pmName} />
              <DetailFact label="담당조직" value={dossier.identity.department} />
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">계약 및 운영 정보</p>
              <p className="mt-1 text-[14px] font-semibold text-slate-950">프로젝트 수정 화면 기준 핵심 항목</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <DetailFact label="사업 유형" value={dossier.contract.projectTypeLabel} />
              <DetailFact label="사업 기간" value={dossier.contract.periodLabel} />
              <DetailFact label="정산 유형" value={dossier.contract.settlementTypeLabel} />
              <DetailFact label="정산 기준" value={dossier.contract.basisLabel} />
              <DetailFact label="통장 유형" value={dossier.contract.accountTypeLabel} />
              <DetailFact label="자금 입력 방식" value={dossier.contract.fundInputModeLabel} />
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">예산</p>
              <p className="mt-1 text-[14px] font-semibold text-slate-950">PM이 입력한 예산과 재무 기준</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <DetailFact label="총사업비" value={dossier.budget.contractAmountLabel} />
              <DetailFact label="매출부가세" value={dossier.budget.salesVatAmountLabel} />
              <DetailFact label="총수익" value={dossier.budget.totalRevenueAmountLabel} />
              <DetailFact label="지원금" value={dossier.budget.supportAmountLabel} />
              <DetailFact label="입금 계획" value={dossier.budget.paymentPlanDesc} />
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
                  <p className="mt-1 text-[13px] font-semibold text-slate-950">{dossier.people.teamName}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">등록 인력</p>
                  {dossier.people.members.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {dossier.people.members.map((member) => (
                        <Badge key={member} variant="outline" className="h-auto rounded-full px-3 py-1 text-[11px]">
                          {member}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-slate-500">등록 인력 정보 없음</p>
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
              <DetailFact label="프로젝트 목적" value={dossier.notes.projectPurpose} />
              <DetailFact label="참여 조건" value={dossier.notes.participantCondition} />
              <DetailFact label="상세 설명" value={dossier.notes.description} />
              <DetailFact label="비고" value={dossier.notes.note} />
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">첨부 계약서</p>
              <p className="mt-1 text-[14px] font-semibold text-slate-950">PM이 붙인 계약서 파일과 업로드 시점을 그대로 보여줍니다</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-center">
                <div>
                  <p className="text-[11px] text-slate-500">파일명</p>
                  <p className="mt-1 text-[13px] font-semibold text-slate-950">{dossier.contractDocument.name}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">업로드일</p>
                  <p className="mt-1 text-[13px] font-medium text-slate-900">{dossier.contractDocument.uploadedAt}</p>
                </div>
                {dossier.contractDocument.downloadURL !== '-' ? (
                  <div className="xl:justify-self-end">
                    <Button asChild variant="outline" className="h-10 rounded-full px-4">
                      <a href={dossier.contractDocument.downloadURL} target="_blank" rel="noreferrer">
                        계약서 보기
                      </a>
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">접수 및 검토 이력</p>
              <p className="mt-1 text-[14px] font-semibold text-slate-950">누가 언제 올렸고, 누가 어떤 메모를 남겼는지 봅니다</p>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <DetailFact label="요청자" value={dossier.audit.requestedByName} />
              <DetailFact label="접수일" value={dossier.audit.requestedAt} />
            </div>
            {dossier.audit.history.length > 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-[11px] text-slate-500">검토 이력</p>
                <div className="mt-3 space-y-3">
                  {dossier.audit.history.map((entry, index) => (
                    <div key={`${entry.statusLabel}-${entry.reviewedAt}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{entry.statusLabel}</Badge>
                        <span className="text-[12px] font-medium text-slate-900">{entry.reviewedByName}</span>
                        <span className="text-[11px] text-slate-500">{entry.reviewedAt}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[12px] leading-6 text-slate-700">{entry.reviewComment}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {(dossier.analysis.summary !== '-' || dossier.analysis.warnings.length > 0 || dossier.analysis.nextActions.length > 0) && (
            <section className="space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">계약 분석 보조 정보</p>
                <p className="mt-1 text-[14px] font-semibold text-slate-950">계약 원문 분석이 있으면 같이 봅니다</p>
              </div>
              <div className="grid gap-3">
                <DetailFact label="AI/휴리스틱 요약" value={dossier.analysis.summary} />
                {dossier.analysis.warnings.length > 0 && (
                  <DetailFact label="주의 사항" value={dossier.analysis.warnings.map((warning) => `• ${warning}`).join('\n')} />
                )}
                {dossier.analysis.nextActions.length > 0 && (
                  <DetailFact label="다음 행동" value={dossier.analysis.nextActions.map((action) => `• ${action}`).join('\n')} />
                )}
              </div>
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
                상단이나 좌측이 아니라 여기서만 승인, 수정 요청 후 반려, 중복·폐기를 결정합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-10 gap-1.5" onClick={onApprove} disabled={acting}>
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                승인
              </Button>
              <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={onReject} disabled={acting}>
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                수정 요청 후 반려
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                onClick={onDiscard}
                disabled={acting}
              >
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                중복·폐기
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
