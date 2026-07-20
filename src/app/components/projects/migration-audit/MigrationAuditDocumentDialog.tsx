import type { MigrationAuditConsoleRecord } from '../../../platform/project-migration-console';
import { getMigrationAuditStatusLabel } from '../../../platform/project-migration-console';
import { resolveProjectRequestPayload } from '../../../platform/project-change-request';
import {
  buildMigrationReviewDossier,
  resolveMigrationReviewContractDocument,
} from '../../../platform/project-migration-review-dossier';
import {
  getManagementPlanningReview,
  getManagementPlanningReviewLabel,
} from '../../../platform/project-management-planning-review';
import { ContractDocumentPreview } from '../ContractDocumentPreview';
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
  acting: boolean;
  canFinalize: boolean;
  contractDocumentDownloadURL?: string;
  contractDocumentError?: string;
  reviewStage?: 'executive' | 'managementPlanning';
  onOpenChange: (open: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10).replace(/-/g, '.');
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function ApprovalSeal({ name, state }: { name: string; state: 'submitted' | 'approved' | 'rejected' }) {
  const tone = state === 'approved'
    ? 'border-[#174a7c] text-[#174a7c]'
    : state === 'rejected'
      ? 'border-[#b42318] text-[#b42318]'
      : 'border-slate-500 text-slate-700';
  return <div className={`grid h-12 w-12 place-items-center rounded-full border-2 bg-white text-center text-[10px] font-semibold leading-3 ${tone}`}>{name || '-'}</div>;
}

function DocumentCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`grid min-h-11 grid-cols-[112px_minmax(0,1fr)] border-b border-slate-300 last:border-b-0 ${className}`}>
      <dt className="flex items-center border-r border-slate-300 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700">{label}</dt>
      <dd className="flex items-center break-words px-3 py-2 text-[12px] leading-5 text-slate-900">{value || '-'}</dd>
    </div>
  );
}

function ReviewMessage({ label, by, at, message }: { label: string; by: string; at: string; message: string }) {
  return (
    <div className="grid border-b border-slate-300 last:border-b-0 md:grid-cols-[150px_150px_minmax(0,1fr)]">
      <div className="bg-slate-50 px-3 py-3 font-semibold text-slate-700">{label}</div>
      <div className="border-y border-slate-300 px-3 py-3 text-slate-600 md:border-y-0 md:border-r">{by} · {at}</div>
      <p className="whitespace-pre-wrap break-words px-3 py-3 leading-5 text-slate-900">{message}</p>
    </div>
  );
}

export function MigrationAuditDocumentDialog({
  open,
  record,
  acting,
  canFinalize,
  contractDocumentDownloadURL = '',
  contractDocumentError = '',
  reviewStage = 'executive',
  onOpenChange,
  onApprove,
  onReject,
}: MigrationAuditDocumentDialogProps) {
  if (!record) return null;

  const dossier = buildMigrationReviewDossier(record.project, record.request);
  const requestPayload = resolveProjectRequestPayload(record.request);
  const designatedApproverName = record.project.executiveApproverName || requestPayload?.executiveApproverName || '';
  const isManagementPlanning = reviewStage === 'managementPlanning';
  const organizationReviewStatus = record.project.executiveReviewStatus;
  const organizationDecisionState = organizationReviewStatus === 'APPROVED'
    ? 'approved'
    : organizationReviewStatus === 'REVISION_REJECTED' || organizationReviewStatus === 'DUPLICATE_DISCARDED'
      ? 'rejected'
      : null;
  const latestOrganizationDecision = organizationDecisionState
    ? [...(record.project.executiveReviewHistory || [])].reverse().find((entry) => entry.status === organizationReviewStatus)
    : undefined;
  const organizationReviewedByName = latestOrganizationDecision?.reviewedByName || record.project.executiveReviewedByName || '';
  const organizationReviewedAt = latestOrganizationDecision?.reviewedAt || record.project.executiveReviewedAt || '';
  const managementReview = getManagementPlanningReview(record.project);
  const managementDecisionState = managementReview.status === 'AGREED'
    ? 'approved'
    : managementReview.status === 'REVISION_REJECTED'
      ? 'rejected'
      : null;
  const latestManagementDecision = managementDecisionState
    ? [...managementReview.history].reverse().find((entry) => entry.status === managementReview.status)
    : undefined;
  const managementReviewedByName = latestManagementDecision?.reviewedByName || managementReview.reviewedByName;
  const managementReviewedAt = latestManagementDecision?.reviewedAt || managementReview.reviewedAt;
  const contractDocument = resolveMigrationReviewContractDocument(record.project, record.request);
  const contractDocumentUrl = contractDocumentDownloadURL || contractDocument?.downloadURL || '';
  const attachmentNames = [contractDocument?.name, requestPayload?.quoteDocument?.name, requestPayload?.proposalDocument?.name]
    .filter((name): name is string => Boolean(name?.trim()));
  const reviewMessages = dossier.audit.history.filter((entry) => entry.reviewComment !== '-' && entry.reviewComment !== 'PM 신규 등록');
  const managementMessages = managementReview.history.filter((entry) => Boolean(entry.reviewComment?.trim()));
  const requestReviewComment = String(record.request?.reviewComment || '').trim();
  const hasDistinctRequestReviewComment = Boolean(
    requestReviewComment
    && requestReviewComment !== 'PM 신규 등록'
    && ![...reviewMessages, ...managementMessages].some((entry) => String(entry.reviewComment || '').trim() === requestReviewComment),
  );
  const isActionPending = isManagementPlanning
    ? organizationReviewStatus === 'APPROVED' && managementReview.status === 'PENDING'
    : record.status === 'PENDING';
  const documentStatus = isManagementPlanning
    ? getManagementPlanningReviewLabel(managementReview.status)
    : getMigrationAuditStatusLabel(record.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[1180px] overflow-y-auto rounded-none border border-slate-500 bg-slate-100 p-5 shadow-2xl sm:max-w-[1180px]">
        <DialogHeader className="sr-only"><DialogTitle>프로젝트 등록 및 승인서</DialogTitle><DialogDescription>프로젝트 등록 내용을 결재 문서 형식으로 확인합니다.</DialogDescription></DialogHeader>
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
                  <div className="border-r border-b border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold">조직장 승인</div>
                  <div className="border-b border-slate-400 px-2 py-1.5 text-center text-[11px] font-semibold">경영기획실 합의</div>
                  <div className="flex items-center justify-center border-r border-b border-slate-400 bg-slate-50 text-[10px] text-slate-600">인</div>
                  <div className="flex min-h-[70px] items-center justify-center border-r border-b border-slate-400 px-2 py-2"><ApprovalSeal name={dossier.audit.requestedByName} state="submitted" /></div>
                  <div className="flex min-h-[70px] items-center justify-center border-r border-b border-slate-400 px-2 py-2">
                    {organizationDecisionState ? <ApprovalSeal name={organizationReviewedByName || '미상'} state={organizationDecisionState} /> : <span data-testid="organization-head-approval-pending" className="text-center"><span className="block text-[11px] font-medium text-slate-800">{designatedApproverName || '결재자 미지정'}</span><span className="mt-1 block text-[10px] text-slate-500">검토 대기</span></span>}
                  </div>
                  <div className="flex min-h-[70px] items-center justify-center border-b border-slate-400 px-2 py-2">
                    {managementDecisionState ? <ApprovalSeal name={managementReviewedByName || '미상'} state={managementDecisionState} /> : <span data-testid="management-planning-approval-pending" aria-label="경영기획실 합의 대기" className="text-[10px] text-slate-500">합의 대기</span>}
                  </div>
                  <div className="flex items-center justify-center border-r border-t border-slate-400 bg-slate-50 text-[10px] text-slate-600">일자</div>
                  <div className="border-r border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{formatDateTime(record.requestedAt)}</div>
                  <div className="border-r border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{organizationReviewedAt ? formatDateTime(organizationReviewedAt) : '검토 대기'}</div>
                  <div className="border-t border-slate-400 px-2 py-2 text-center text-[10px] text-slate-700">{managementReviewedAt ? formatDateTime(managementReviewedAt) : '합의 대기'}</div>
                </div>
              </div>
            </div>
          </header>

          <section className="mt-5">
            <h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">의견 및 처리 이력</h3>
            <div className="border border-t-0 border-slate-400 text-[12px]">
              {dossier.audit.requestSummary !== '-' ? <ReviewMessage label="요청 요약" by={dossier.audit.requestedByName} at={dossier.audit.requestedAt} message={dossier.audit.requestSummary} /> : null}
              {dossier.notes.note !== '-' ? <ReviewMessage label="실무자 기안 메모" by={dossier.audit.requestedByName} at={dossier.audit.requestUpdatedAt} message={dossier.notes.note} /> : null}
              {hasDistinctRequestReviewComment ? <ReviewMessage label="실무자 제출/재제출 메모" by={record.request?.requestedByName || dossier.audit.requestedByName} at={record.request?.requestedAt || dossier.audit.requestUpdatedAt} message={requestReviewComment} /> : null}
              {reviewMessages.map((entry, index) => <ReviewMessage key={`${entry.status}-${entry.reviewedAt}-${index}`} label={entry.status === 'PENDING' ? '실무자 제출/재제출 메모' : entry.status === 'APPROVED' ? '조직장 승인 메모' : entry.status === 'REVISION_REJECTED' ? '조직장 반려 메모' : '조직장 폐기 메모'} by={entry.reviewedByName} at={entry.reviewedAt} message={entry.reviewComment} />)}
              {managementMessages.map((entry, index) => <ReviewMessage key={`management-${entry.status}-${entry.reviewedAt}-${index}`} label={entry.status === 'AGREED' ? '경영기획실 합의 메모' : '경영기획실 반려 메모'} by={entry.reviewedByName} at={formatDateTime(entry.reviewedAt)} message={String(entry.reviewComment || '-')} />)}
              {dossier.audit.requestSummary === '-' && dossier.notes.note === '-' && !hasDistinctRequestReviewComment && reviewMessages.length === 0 && managementMessages.length === 0 ? <p className="px-3 py-4 text-slate-500">등록된 의견 또는 처리 메모가 없습니다.</p> : null}
            </div>
          </section>

          <section className="mt-6 border border-slate-400">
            <DocumentCell label="문서 번호" value={record.request?.id || record.id} />
            <DocumentCell label="작성 일자" value={formatDateTime(record.requestedAt)} />
            <DocumentCell label="기안 부서" value={record.cic} />
            <DocumentCell label="기안자" value={dossier.audit.requestedByName} />
            <DocumentCell label="결재 상태" value={documentStatus} />
          </section>

          <section className="mt-6"><h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">기본정보</h3><dl className="border border-t-0 border-slate-400">
            <DocumentCell label="프로젝트명" value={dossier.headerTitle} /><DocumentCell label="공식 계약명" value={dossier.identity.officialContractName} /><DocumentCell label="계약 대상" value={dossier.identity.clientOrg} /><DocumentCell label="담당조직(CIC)" value={dossier.identity.cic} /><DocumentCell label="사업 담당자" value={dossier.identity.pmName} /><DocumentCell label="프로젝트 코드" value={managementReview.projectCode || '부여 대기'} />
          </dl></section>
          <section className="mt-6"><h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">계약 및 정산 정보</h3><dl className="grid border border-t-0 border-slate-400 md:grid-cols-2">
            <DocumentCell label="계약 기간" value={dossier.contract.periodLabel} className="md:border-r md:border-slate-400" /><DocumentCell label="정산 유형" value={dossier.contract.settlementTypeLabel} /><DocumentCell label="계약금액" value={dossier.budget.contractAmountLabel} className="md:border-r md:border-slate-400" /><DocumentCell label="총수익" value={dossier.budget.totalRevenueAmountLabel} /><DocumentCell label="입금 계획" value={dossier.budget.paymentPlanDesc} className="md:col-span-2" />
          </dl></section>
          <section className="mt-6"><h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">등록 내용</h3><dl className="border border-t-0 border-slate-400">
            <DocumentCell label="프로젝트 목적" value={dossier.notes.projectPurpose} /><DocumentCell label="상세 설명" value={dossier.notes.description} /><DocumentCell label="참여 조건" value={dossier.notes.participantCondition} /><DocumentCell label="비고" value={dossier.notes.note} />
          </dl></section>
          <section className="mt-6"><h3 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">첨부자료</h3>
            <div className="border border-t-0 border-slate-400 px-4 py-3 text-[12px] leading-6 text-slate-800">{attachmentNames.length > 0 ? attachmentNames.join(' · ') : '등록된 첨부자료가 없습니다.'}{contractDocumentError ? <p className="mt-1 text-[11px] text-rose-700">{contractDocumentError}</p> : null}</div>
            <ContractDocumentPreview document={contractDocument ? { ...contractDocument, downloadURL: contractDocumentUrl } : null} title="계약서 PDF 원문" description="등록 요청에 첨부된 계약서 원문을 문서 안에서 확인합니다." className="rounded-none border-t-0 border-slate-400" />
          </section>

          {isActionPending && canFinalize ? <footer className="mt-7 flex justify-end gap-2 border-t border-slate-300 pt-4"><Button type="button" variant="outline" className="rounded-none border-slate-500" onClick={onReject} disabled={acting}>반려</Button><Button type="button" className="rounded-none bg-[#174a7c] hover:bg-[#103a63]" onClick={onApprove} disabled={acting}>{isManagementPlanning ? '합의' : '승인'}</Button></footer> : null}
          {isActionPending && !canFinalize ? <p className="mt-7 border-t border-slate-300 pt-4 text-right text-[11px] text-slate-500">{isManagementPlanning ? '경영기획실 담당자만 합의 또는 반려할 수 있습니다.' : '지정된 조직장만 승인 또는 반려할 수 있습니다.'}</p> : null}
        </article>
      </DialogContent>
    </Dialog>
  );
}
