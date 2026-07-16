import type { MigrationAuditConsoleRecord } from '../../../platform/project-migration-console';
import {
  getMigrationAuditStatusLabel,
} from '../../../platform/project-migration-console';
import { resolveProjectRequestPayload } from '../../../platform/project-change-request';
import { buildMigrationReviewDossier } from '../../../platform/project-migration-review-dossier';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Button } from '../../ui/button';

interface MigrationAuditDocumentDialogProps {
  open: boolean;
  record: MigrationAuditConsoleRecord | null;
  reviewerName: string;
  acting: boolean;
  workflowStage: 'planning' | 'approval';
  canFinalize: boolean;
  contractDocumentDownloadURL?: string;
  contractDocumentError?: string;
  onOpenChange: (open: boolean) => void;
  onAgree: () => void;
  onApprove: () => void;
  onReject: () => void;
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10).replace(/-/g, '.');
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function ApprovalSeal({ name, state }: { name: string; state: 'submitted' | 'pending' | 'approved' | 'rejected' }) {
  const tone = state === 'approved'
    ? 'border-[#174a7c] text-[#174a7c]'
    : state === 'rejected'
      ? 'border-[#b42318] text-[#b42318]'
      : state === 'pending'
        ? 'border-slate-400 text-slate-500'
        : 'border-slate-500 text-slate-700';
  return (
    <div className={`grid h-12 w-12 place-items-center rounded-full border-2 bg-white text-center text-[10px] font-semibold leading-3 ${tone}`}>
      {name || '-'}
    </div>
  );
}

function DocumentCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`grid min-h-11 grid-cols-[112px_minmax(0,1fr)] border-b border-slate-300 last:border-b-0 ${className}`}>
      <dt className="flex items-center border-r border-slate-300 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700">{label}</dt>
      <dd className="flex items-center break-words px-3 py-2 text-[12px] leading-5 text-slate-900">{value || '-'}</dd>
    </div>
  );
}

export function MigrationAuditDocumentDialog({
  open,
  record,
  reviewerName,
  acting,
  workflowStage,
  canFinalize,
  contractDocumentDownloadURL = '',
  contractDocumentError = '',
  onOpenChange,
  onAgree,
  onApprove,
  onReject,
}: MigrationAuditDocumentDialogProps) {
  if (!record) return null;

  const dossier = buildMigrationReviewDossier(record.project, record.request);
  const requestPayload = resolveProjectRequestPayload(record.request);
  const designatedApproverName = requestPayload?.executiveApproverName
    || record.project.executiveApproverName
    || '';
  const history = record.project.executiveReviewHistory || [];
  const planningAgreement = [...history].reverse().find((entry) => entry.status === 'PLANNING_AGREED');
  const finalReview = [...history].reverse().find((entry) => (
    entry.status === 'APPROVED' || entry.status === 'REVISION_REJECTED' || entry.status === 'DUPLICATE_DISCARDED'
  ));
  const reviewedByName = finalReview?.reviewedByName
    || record.project.executiveReviewedByName
    || record.request?.reviewedByName
    || reviewerName;
  const reviewedAt = finalReview?.reviewedAt
    || record.project.executiveReviewedAt
    || record.request?.reviewedAt;
  const approvalState = record.status === 'APPROVED'
    ? 'approved'
    : record.status === 'REVISION_REJECTED'
      ? 'rejected'
      : 'pending';
  const attachmentNames = [
    requestPayload?.contractDocument?.name,
    requestPayload?.quoteDocument?.name,
    requestPayload?.proposalDocument?.name,
  ].filter((name): name is string => !!name?.trim());
  const contractDocumentUrl = contractDocumentDownloadURL || requestPayload?.contractDocument?.downloadURL || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[1180px] overflow-y-auto rounded-none border border-slate-500 bg-slate-100 p-5 shadow-2xl sm:max-w-[1180px]">
        <DialogHeader className="sr-only">
          <DialogTitle>프로젝트 등록 및 승인서</DialogTitle>
          <DialogDescription>프로젝트 등록 내용을 결재 문서 형식으로 확인합니다.</DialogDescription>
        </DialogHeader>

        <article className="mx-auto w-full max-w-[1020px] border border-slate-400 bg-white px-8 py-9 text-slate-900" data-testid="migration-review-document">
          <header className="border-b-2 border-slate-700 pb-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_410px]">
              <div className="flex min-h-[138px] flex-col justify-center">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">MYSCube · PROJECT REGISTRATION</p>
                <h2 className="mt-3 text-center text-[25px] font-bold tracking-[0.08em]">프로젝트 등록 및 승인서</h2>
              </div>
              <div className="border border-slate-400">
                  <div className="grid grid-cols-[48px_repeat(3,minmax(0,1fr))]">
                  <div className="flex items-center justify-center border-r border-b border-slate-400 bg-slate-50 text-[11px] font-semibold">결재</div>
                  <div className="border-r border-b border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold">기안</div>
                  <div className="border-r border-b border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold">경영기획실 합의</div>
                  <div className="border-b border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold">조직장 승인</div>
                  <div className="flex items-center justify-center border-r border-slate-400 bg-slate-50 text-[10px] text-slate-600">인</div>
                  <div className="flex min-h-[70px] flex-col items-center justify-center gap-1 border-r border-slate-400 px-2 py-2">
                    <ApprovalSeal name={dossier.audit.requestedByName} state="submitted" />
                  </div>
                  <div className="flex min-h-[70px] flex-col items-center justify-center gap-1 border-r border-slate-400 px-2 py-2">
                    {planningAgreement ? (
                      <ApprovalSeal name={planningAgreement.reviewedByName} state="approved" />
                    ) : (
                      <span className="text-center text-[10px] text-slate-500">합의 대기</span>
                    )}
                  </div>
                  <div className="flex min-h-[70px] flex-col items-center justify-center gap-1 px-2 py-2">
                    {approvalState === 'pending' ? (
                      <span className="text-center" aria-label="조직장 승인 대기">
                        <span className="block text-[11px] font-medium text-slate-800">{designatedApproverName || '결재자 미지정'}</span>
                        <span className="mt-1 block text-[10px] text-slate-500">검토 대기</span>
                      </span>
                    ) : (
                      <ApprovalSeal name={reviewedByName} state={approvalState} />
                    )}
                  </div>
                  <div className="flex items-center justify-center border-r border-t border-slate-400 bg-slate-50 text-[10px] text-slate-600">일자</div>
                  <div className="border-r border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{formatDateTime(record.requestedAt)}</div>
                  <div className="border-r border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{planningAgreement ? formatDateTime(planningAgreement.reviewedAt) : '합의 대기'}</div>
                  <div className="border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{reviewedAt ? formatDateTime(reviewedAt) : '검토 대기'}</div>
                </div>
              </div>
            </div>
          </header>

          <section className="mt-6 border border-slate-400">
            <DocumentCell label="문서 번호" value={record.request?.id || record.id} />
            <DocumentCell label="프로젝트 코드" value={record.project.projectCode || ''} />
            <DocumentCell label="작성 일자" value={formatDateTime(record.requestedAt)} />
            <DocumentCell label="기안 부서" value={record.cic} />
            <DocumentCell label="기안자" value={dossier.audit.requestedByName} />
            <DocumentCell label="결재 상태" value={getMigrationAuditStatusLabel(record.status)} />
          </section>

          <section className="mt-6">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">처리 의견</h3>
            <div className="border border-t-0 border-slate-400">
              {history.map((entry, index) => (
                <div key={`${entry.reviewedAt}-${index}`} className="border-b border-slate-300 px-4 py-3 last:border-b-0">
                  <p className="text-[11px] font-semibold text-slate-800">
                    {entry.status === 'PLANNING_AGREED' ? '경영기획실 합의' : getMigrationAuditStatusLabel(entry.status)} · {entry.reviewedByName} · {formatDateTime(entry.reviewedAt)}
                    {entry.projectCode ? ` · ${entry.projectCode}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-slate-700">{entry.reviewComment || '-'}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">기본정보</h3>
            <dl className="border border-t-0 border-slate-400">
              <DocumentCell label="프로젝트명" value={dossier.headerTitle} />
              <DocumentCell label="공식 계약명" value={dossier.identity.officialContractName} />
              <DocumentCell label="계약 대상" value={dossier.identity.clientOrg} />
              <DocumentCell label="담당조직(CIC)" value={dossier.identity.cic} />
              <DocumentCell label="사업 담당자" value={dossier.identity.pmName} />
            </dl>
          </section>

          <section className="mt-6">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">계약 및 정산 정보</h3>
            <dl className="grid border border-t-0 border-slate-400 md:grid-cols-2">
              <DocumentCell label="계약 기간" value={dossier.contract.periodLabel} className="md:border-r md:border-slate-400" />
              <DocumentCell label="정산 유형" value={dossier.contract.settlementTypeLabel} />
              <DocumentCell label="계약금액" value={dossier.budget.contractAmountLabel} className="md:border-r md:border-slate-400" />
              <DocumentCell label="총수익" value={dossier.budget.totalRevenueAmountLabel} />
              <DocumentCell label="입금 계획" value={dossier.budget.paymentPlanDesc} className="md:col-span-2" />
            </dl>
          </section>

          <section className="mt-6">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">등록 내용</h3>
            <dl className="border border-t-0 border-slate-400">
              <DocumentCell label="프로젝트 목적" value={dossier.notes.projectPurpose} />
              <DocumentCell label="상세 설명" value={dossier.notes.description} />
              <DocumentCell label="참여 조건" value={dossier.notes.participantCondition} />
              <DocumentCell label="비고" value={dossier.notes.note} />
            </dl>
          </section>

          <section className="mt-6">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">첨부자료</h3>
            <div className="border border-t-0 border-slate-400 px-4 py-3 text-[12px] leading-6 text-slate-800">
              {attachmentNames.length > 0 ? attachmentNames.join(' · ') : '등록된 첨부자료가 없습니다.'}
              {contractDocumentUrl ? (
                <a className="ml-3 font-semibold text-[#174a7c] underline underline-offset-2" href={contractDocumentUrl} target="_blank" rel="noreferrer">계약서 원문 열기</a>
              ) : null}
              {contractDocumentError ? <p className="mt-1 text-[11px] text-rose-700">{contractDocumentError}</p> : null}
              {contractDocumentUrl ? (
                <iframe title="계약서 미리보기" src={contractDocumentUrl} className="mt-3 h-[520px] w-full border border-slate-300 bg-slate-50" />
              ) : null}
            </div>
          </section>

          {workflowStage === 'planning' && record.status === 'PENDING' ? (
            <footer className="mt-7 flex justify-end gap-2 border-t border-slate-300 pt-4">
              <Button type="button" className="rounded-none bg-[#174a7c] hover:bg-[#103a63]" onClick={onAgree} disabled={acting}>합의</Button>
            </footer>
          ) : null}
          {workflowStage === 'approval' && record.status === 'PLANNING_AGREED' && canFinalize ? (
            <footer className="mt-7 flex justify-end gap-2 border-t border-slate-300 pt-4">
              <Button type="button" variant="outline" className="rounded-none border-slate-500" onClick={onReject} disabled={acting}>반려</Button>
              <Button type="button" className="rounded-none bg-[#174a7c] hover:bg-[#103a63]" onClick={onApprove} disabled={acting}>승인</Button>
            </footer>
          ) : null}
          {workflowStage === 'approval' && record.status === 'PLANNING_AGREED' && !canFinalize ? (
            <p className="mt-7 border-t border-slate-300 pt-4 text-right text-[11px] text-slate-500">지정된 조직장만 최종 승인 또는 반려할 수 있습니다.</p>
          ) : null}
        </article>
      </DialogContent>
    </Dialog>
  );
}
