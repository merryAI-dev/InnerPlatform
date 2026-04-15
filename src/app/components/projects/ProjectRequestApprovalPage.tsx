import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Link2, Loader2, Sparkles, XCircle } from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import { useAuth } from '../../data/auth-store';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Textarea } from '../ui/textarea';
import {
  PROJECT_TYPE_LABELS,
  type ProjectRequest,
} from '../../data/types';
import { getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { buildProjectRequestReviewModel, type ProjectRequestReviewItem, type ProjectRequestReviewGroup, type ProjectRequestReviewAnalysisHighlight } from '../../platform/project-request-review';

const STATUS_BADGES: Record<ProjectRequest['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

interface ProjectRequestApprovalSectionProps {
  compact?: boolean;
}

const REVIEW_BADGE_STYLES: Record<ProjectRequestReviewItem['status'], string> = {
  ready: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  'needs-check': 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  missing: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
};

function getItemStatusLabel(status: ProjectRequestReviewItem['status']): string {
  if (status === 'ready') return '확인됨';
  if (status === 'needs-check') return '확인 필요';
  return '누락';
}

function getConfidenceLabel(confidence: ProjectRequestReviewAnalysisHighlight['confidence']): string {
  if (confidence === 'high') return '고신뢰';
  if (confidence === 'medium') return '중신뢰';
  return '저신뢰';
}

function formatReviewTimestamp(value?: string): string {
  if (!value) return '-';
  return value.replace('T', ' ').slice(0, 16).replace(/-/g, '.');
}

function ReviewFieldRow({ item }: { item: ProjectRequestReviewItem }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{item.label}</p>
          <p className="mt-1 whitespace-pre-line text-[12px] text-slate-900" style={{ fontWeight: 500 }}>
            {item.value}
          </p>
          {item.note && (
            <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{item.note}</p>
          )}
        </div>
        <Badge className={`shrink-0 border-0 text-[9px] h-5 px-1.5 ${REVIEW_BADGE_STYLES[item.status]}`}>
          {getItemStatusLabel(item.status)}
        </Badge>
      </div>
    </div>
  );
}

function ReviewGroupCard({ group }: { group: ProjectRequestReviewGroup }) {
  return (
    <div className="rounded-xl border border-border/60 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px]" style={{ fontWeight: 700 }}>{group.label}</p>
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-5">
          {group.items.filter((item) => item.status !== 'ready').length}건 확인
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {group.items.map((item) => <ReviewFieldRow key={item.key} item={item} />)}
      </div>
    </div>
  );
}

function ReviewAnalysisHighlightCard({ highlight }: { highlight: ProjectRequestReviewAnalysisHighlight }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{highlight.label}</p>
          <p className="mt-1 text-[12px] text-slate-900" style={{ fontWeight: 500 }}>{highlight.value}</p>
          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{highlight.evidence}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className={`border-0 text-[9px] h-5 px-1.5 ${REVIEW_BADGE_STYLES[highlight.status]}`}>
            {getItemStatusLabel(highlight.status)}
          </Badge>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-5">
            {getConfidenceLabel(highlight.confidence)}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ReviewFactCard({ item }: { item: ProjectRequestReviewItem }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-[13px] text-slate-900" style={{ fontWeight: 600 }}>{item.value}</p>
          {item.note && <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{item.note}</p>}
        </div>
        <Badge className={`shrink-0 border-0 text-[9px] h-5 px-1.5 ${REVIEW_BADGE_STYLES[item.status]}`}>
          {getItemStatusLabel(item.status)}
        </Badge>
      </div>
    </div>
  );
}

function useProjectRequests() {
  const { db, orgId, isOnline } = useFirebase();
  const { user } = useAuth();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    mode: 'approve' | 'reject';
    request: ProjectRequest | null;
  }>({ open: false, mode: 'approve', request: null });
  const [reviewComment, setReviewComment] = useState('');
  const [saving, setSaving] = useState(false);

  const canApprove = useMemo(() => {
    const role = user?.role;
    return role === 'admin' || role === 'tenant_admin' || role === 'finance';
  }, [user?.role]);

  useEffect(() => {
    if (!db || !isOnline) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, getOrgCollectionPath(orgId, 'projectRequests')),
      orderBy('requestedAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((requestDoc) => requestDoc.data() as ProjectRequest);
      setRequests(list);
      setLoading(false);
    }, (err) => {
      console.error('[ProjectRequest] listen error:', err);
      setRequests([]);
      setLoading(false);
    });
    return () => unsub();
  }, [db, isOnline, orgId]);

  const openApprove = (request: ProjectRequest) => {
    setConfirmState({ open: true, mode: 'approve', request });
    setReviewComment('');
  };

  const openReject = (request: ProjectRequest) => {
    setConfirmState({ open: true, mode: 'reject', request });
    setReviewComment('');
  };

  const handleConfirm = async () => {
    if (!confirmState.request || !db) return;
    if (!canApprove) {
      console.warn('[ProjectRequest] approve blocked: insufficient role');
      return;
    }
    const req = confirmState.request;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const trimmedReviewComment = reviewComment.trim();
      if (confirmState.mode === 'approve') {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', req.id)),
          {
            status: 'APPROVED',
            reviewedBy: user?.uid || '',
            reviewedByName: user?.name || '',
            reviewedAt: now,
            reviewComment: trimmedReviewComment || null,
            updatedAt: now,
          },
          { merge: true },
        );
      } else {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', req.id)),
          {
            status: 'REJECTED',
            reviewedBy: user?.uid || '',
            reviewedByName: user?.name || '',
            reviewedAt: now,
            reviewComment: trimmedReviewComment || null,
            rejectedReason: trimmedReviewComment || '',
            updatedAt: now,
          },
          { merge: true },
        );
      }
      setConfirmState({ open: false, mode: 'approve', request: null });
      setReviewComment('');
    } catch (err) {
      console.error('[ProjectRequest] action failed:', err);
      const role = user?.role || 'unknown';
      const message = err instanceof Error ? err.message : String(err || 'unknown');
      toast.error(`승인 처리 실패 (${role}): ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return {
    requests,
    loading,
    confirmState,
    reviewComment,
    saving,
    canApprove,
    openApprove,
    openReject,
    setReviewComment,
    setConfirmState,
    handleConfirm,
  };
}

function ProjectRequestApprovalDialog({
  confirmState,
  reviewComment,
  saving,
  setReviewComment,
  setConfirmState,
  handleConfirm,
}: ReturnType<typeof useProjectRequests>) {
  const requiresReviewComment = confirmState.mode === 'reject';
  const confirmDisabled = saving || (requiresReviewComment && reviewComment.trim().length === 0);

  return (
    <AlertDialog open={confirmState.open} onOpenChange={(open) => setConfirmState((prev) => ({ ...prev, open }))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmState.mode === 'approve' ? '사업 등록 요청을 승인할까요?' : '사업 등록 요청을 반려할까요?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmState.request?.payload.name || ''} 요청을 {confirmState.mode === 'approve' ? '승인' : '반려'}합니다.
            승인 시 등록 요청 상태만 갱신되고, 실제 프로젝트 생성은 후속 워크플로에서 이어집니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reviewComment}
          onChange={(event) => setReviewComment(event.target.value)}
          placeholder={confirmState.mode === 'approve' ? '승인 메모를 입력하세요 (선택)' : '반려 사유를 입력하세요 (선택)'}
          className="min-h-[90px]"
        />
        {requiresReviewComment && (
          <p className="text-[11px] text-muted-foreground">반려 시에는 사유를 남겨야 감사 이력이 완성됩니다.</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={confirmDisabled}>
            {saving ? '처리 중...' : '확인'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ReviewRiskTone = 'critical' | 'warning' | 'info';

interface ReviewRiskItem {
  key: string;
  label: string;
  detail: string;
  tone: ReviewRiskTone;
}

const RISK_CARD_STYLES: Record<ReviewRiskTone, string> = {
  critical: 'border-rose-200 bg-rose-50/90',
  warning: 'border-amber-200 bg-amber-50/90',
  info: 'border-sky-200 bg-sky-50/90',
};

const STATUS_STRIP_STYLES: Record<ProjectRequest['status'], string> = {
  PENDING: 'border-amber-200 bg-amber-50/90 text-amber-900',
  APPROVED: 'border-emerald-200 bg-emerald-50/90 text-emerald-900',
  REJECTED: 'border-rose-200 bg-rose-50/90 text-rose-900',
};

function buildReviewHistoryItems(request: ProjectRequest): ProjectRequestReviewItem[] {
  return [
    {
      key: 'requestedBy',
      label: '요청자',
      value: request.requestedByName || request.requestedByEmail || '-',
      status: 'ready',
      note: request.requestedByEmail || undefined,
    },
    {
      key: 'requestedAt',
      label: '접수 시각',
      value: formatReviewTimestamp(request.requestedAt),
      status: 'ready',
    },
    {
      key: 'reviewedBy',
      label: '검토자',
      value: request.reviewedByName || '-',
      status: request.reviewedByName ? 'ready' : 'needs-check',
      note: request.status === 'PENDING' ? '아직 승인/반려 전입니다.' : undefined,
    },
    {
      key: 'reviewedAt',
      label: '검토 시각',
      value: formatReviewTimestamp(request.reviewedAt),
      status: request.reviewedAt ? 'ready' : 'needs-check',
    },
    {
      key: 'reviewComment',
      label: request.status === 'REJECTED' ? '반려 사유' : '검토 메모',
      value: request.reviewComment || request.rejectedReason || '-',
      status: request.reviewComment || request.rejectedReason ? 'ready' : 'needs-check',
      note: request.status === 'PENDING'
        ? '승인 또는 반려 시 검토 메모를 남길 수 있습니다.'
        : request.status === 'APPROVED'
          ? '승인 판단 근거를 메모로 남길 수 있습니다.'
          : undefined,
    },
  ];
}

function buildReviewRisks(
  request: ProjectRequest,
  model: ReturnType<typeof buildProjectRequestReviewModel>,
): ReviewRiskItem[] {
  const risks: ReviewRiskItem[] = [];

  if (model.missingFields.length > 0) {
    risks.push({
      key: 'missing-fields',
      label: '필수 누락',
      detail: model.missingFields.slice(0, 3).map((item) => item.label).join(', '),
      tone: 'critical',
    });
  }

  if (!request.payload.contractDocument) {
    risks.push({
      key: 'missing-contract',
      label: '계약 원문 없음',
      detail: '원문 PDF 없이 승인하면 근거 검증이 약해집니다.',
      tone: 'critical',
    });
  }

  if (model.analysis.warnings.length > 0) {
    risks.push({
      key: 'analysis-warnings',
      label: 'AI 분석 재확인',
      detail: model.analysis.warnings[0],
      tone: 'warning',
    });
  }

  if (model.summary.needsCheckCount > 0) {
    risks.push({
      key: 'needs-check',
      label: '수기 재확인',
      detail: `${model.summary.needsCheckCount}개 항목이 최종 검토 대기입니다.`,
      tone: 'info',
    });
  }

  if (risks.length === 0) {
    risks.push({
      key: 'ready-to-decide',
      label: '결정 가능',
      detail: '핵심 입력값과 증빙이 채워져 있어 승인 판단을 내릴 수 있습니다.',
      tone: 'info',
    });
  }

  return risks.slice(0, 4);
}

function getRequestStatusLabel(status: ProjectRequest['status']): string {
  if (status === 'PENDING') return '대기';
  if (status === 'APPROVED') return '승인';
  return '반려';
}

function ProjectRequestInboxItem({
  request,
  active,
  onSelect,
}: {
  request: ProjectRequest;
  active: boolean;
  onSelect: (requestId: string) => void;
}) {
  const model = useMemo(() => buildProjectRequestReviewModel(request), [request]);

  return (
    <button
      type="button"
      onClick={() => onSelect(request.id)}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
        active
          ? 'border-teal-300 bg-teal-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{model.summary.title}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {PROJECT_TYPE_LABELS[request.payload.type]} · {request.payload.clientOrg || '-'}
          </p>
        </div>
        <Badge className={`border-0 text-[10px] ${STATUS_BADGES[request.status]}`}>
          {getRequestStatusLabel(request.status)}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-lg bg-white/80 px-2 py-1.5">
          <p className="text-slate-500">누락</p>
          <p className="mt-0.5 text-[12px] text-slate-900" style={{ fontWeight: 700 }}>{model.summary.missingCount}</p>
        </div>
        <div className="rounded-lg bg-white/80 px-2 py-1.5">
          <p className="text-slate-500">재확인</p>
          <p className="mt-0.5 text-[12px] text-slate-900" style={{ fontWeight: 700 }}>{model.summary.needsCheckCount}</p>
        </div>
        <div className="rounded-lg bg-white/80 px-2 py-1.5">
          <p className="text-slate-500">접수</p>
          <p className="mt-0.5 text-[12px] text-slate-900" style={{ fontWeight: 700 }}>{formatReviewTimestamp(request.requestedAt).slice(5, 16)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {model.badges.slice(0, 2).map((badge) => (
          <Badge key={badge.label} className="border-0 bg-white/80 text-[10px] text-slate-700">
            {badge.label}
          </Badge>
        ))}
      </div>
    </button>
  );
}

function ProjectRequestDecisionRail({
  request,
  model,
  reviewHistoryItems,
  canApprove,
  onApprove,
  onReject,
}: {
  request: ProjectRequest;
  model: ReturnType<typeof buildProjectRequestReviewModel>;
  reviewHistoryItems: ProjectRequestReviewItem[];
  canApprove: boolean;
  onApprove: (request: ProjectRequest) => void;
  onReject: (request: ProjectRequest) => void;
}) {
  const latestComment = reviewHistoryItems.find((item) => item.key === 'reviewComment')?.value || '-';

  return (
    <aside data-testid="project-request-decision-rail" className="xl:sticky xl:top-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] text-slate-950">결정 패널</CardTitle>
          <CardDescription className="text-[12px]">승인 결정과 감사용 메모를 여기서 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className={`rounded-2xl border p-4 ${STATUS_STRIP_STYLES[request.status]}`}>
            <p className="text-[11px] uppercase tracking-[0.08em]">승인 결정</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge className={`border-0 text-[10px] ${STATUS_BADGES[request.status]}`}>
                {getRequestStatusLabel(request.status)}
              </Badge>
              <Badge className="border-0 bg-white/80 text-[10px] text-slate-700">{model.summary.decisionLabel}</Badge>
            </div>
            <p className="mt-3 text-[12px] leading-6">
              누락 {model.summary.missingCount}건 · 확인 필요 {model.summary.needsCheckCount}건
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">검토 메모</p>
            <p className="mt-2 whitespace-pre-line text-[12px] leading-6 text-slate-900">{latestComment}</p>
          </div>

          <div className="grid gap-2">
            {reviewHistoryItems.slice(0, 4).map((item) => (
              <ReviewFieldRow key={item.key} item={item} />
            ))}
          </div>

          {request.payload.contractDocument?.downloadURL && (
            <a
              href={request.payload.contractDocument.downloadURL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-900 transition-colors hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-slate-500" />
                계약 원문 열기
              </span>
              <span className="truncate text-[11px] text-slate-500">{request.payload.contractDocument.name}</span>
            </a>
          )}

          {request.status === 'PENDING' && (
            <div className="grid gap-2">
              <Button
                className="h-10 justify-center gap-2 rounded-xl bg-emerald-600 text-[12px] hover:bg-emerald-700"
                onClick={() => onApprove(request)}
                disabled={!canApprove}
              >
                <CheckCircle2 className="h-4 w-4" />
                승인
              </Button>
              <Button
                variant="outline"
                className="h-10 justify-center gap-2 rounded-xl border-rose-200 text-[12px] text-rose-600 hover:bg-rose-50"
                onClick={() => onReject(request)}
                disabled={!canApprove}
              >
                <XCircle className="h-4 w-4" />
                반려
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function ProjectRequestDetailSurface({
  request,
  canApprove,
  onApprove,
  onReject,
}: {
  request: ProjectRequest;
  canApprove: boolean;
  onApprove: (request: ProjectRequest) => void;
  onReject: (request: ProjectRequest) => void;
}) {
  const model = useMemo(() => buildProjectRequestReviewModel(request), [request]);
  const reviewHistoryItems = useMemo(() => buildReviewHistoryItems(request), [request]);
  const risks = useMemo(() => buildReviewRisks(request, model), [model, request]);

  return (
    <div data-testid="project-request-detail" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section data-testid="project-request-status-strip" className={`rounded-[28px] border p-5 ${STATUS_STRIP_STYLES[request.status]}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`border-0 text-[10px] ${STATUS_BADGES[request.status]}`}>
                  {getRequestStatusLabel(request.status)}
                </Badge>
                <Badge className="border-0 bg-white/80 text-[10px] text-slate-700">{model.summary.decisionLabel}</Badge>
                <Badge className="border-0 bg-white/80 text-[10px] text-slate-700">{PROJECT_TYPE_LABELS[request.payload.type]}</Badge>
              </div>
              <h3 className="mt-3 text-[24px] tracking-[-0.04em] text-slate-950" style={{ fontWeight: 800 }}>
                {model.summary.title}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-slate-700">
                {request.payload.clientOrg || '클라이언트 미지정'} · {request.payload.department || '조직 미지정'} · 접수 {formatReviewTimestamp(request.requestedAt)}
              </p>
            </div>
            <div className="grid gap-2 rounded-2xl bg-white/70 p-3 text-[11px] text-slate-700">
              <span>요청자 {request.requestedByName || '-'}</span>
              <span>검토자 {request.reviewedByName || '-'}</span>
              <span>검토시각 {formatReviewTimestamp(request.reviewedAt)}</span>
            </div>
          </div>
        </section>

        <section data-testid="project-request-risk-board" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>핵심 리스크</p>
              <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>지금 결정을 막는 항목만 모았습니다</h4>
            </div>
            <Badge className="border-0 bg-slate-100 text-[10px] text-slate-700">대표 검토</Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {risks.map((risk) => (
              <div key={risk.key} className={`rounded-2xl border p-4 ${RISK_CARD_STYLES[risk.tone]}`}>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-slate-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {risk.label}
                </div>
                <p className="mt-2 text-[13px] leading-6 text-slate-900">{risk.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section data-testid="project-request-review-summary" className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>리뷰 요약</p>
              <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>승인 판단 한 줄 요약</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {model.badges.map((badge) => (
                <Badge
                  key={badge.label}
                  className={`border-0 text-[10px] ${badge.tone === 'critical'
                    ? 'bg-rose-100 text-rose-700'
                    : badge.tone === 'warning'
                      ? 'bg-amber-100 text-amber-700'
                      : badge.tone === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-700'}`}
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white px-4 py-3">
              <p className="text-[11px] text-slate-500">누락 항목</p>
              <p className="mt-1 text-[20px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>{model.summary.missingCount}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white px-4 py-3">
              <p className="text-[11px] text-slate-500">재확인 항목</p>
              <p className="mt-1 text-[20px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>{model.summary.needsCheckCount}</p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white px-4 py-3">
              <p className="text-[11px] text-slate-500">결정 상태</p>
              <p className="mt-1 text-[20px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>{model.summary.decisionLabel}</p>
            </div>
          </div>
        </section>

        <section data-testid="project-request-review-analysis" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] text-teal-600" style={{ fontWeight: 700 }}>
                <Sparkles className="h-4 w-4" />
                AI 계약 분석
              </div>
              <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>계약 원문 / AI 추출 비교</h4>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {model.analysis.providerLabel} · {model.analysis.model}
            </Badge>
          </div>
          <div className="mt-4 rounded-2xl border border-teal-200/60 bg-teal-50/70 p-4">
            <p className="text-[13px] leading-6 text-teal-950" style={{ fontWeight: 600 }}>{model.analysis.summary}</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">확인 필요</p>
              <ul className="mt-3 space-y-2 text-[12px] leading-6 text-slate-800">
                {model.analysis.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">다음 행동</p>
              <ul className="mt-3 space-y-2 text-[12px] leading-6 text-slate-800">
                {model.analysis.nextActions.map((action) => (
                  <li key={action}>• {action}</li>
                ))}
              </ul>
            </div>
          </div>
          {model.analysis.highlights.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {model.analysis.highlights.map((highlight) => (
                <ReviewAnalysisHighlightCard key={String(highlight.key)} highlight={highlight} />
              ))}
            </div>
          )}
        </section>

        <section data-testid="project-request-review-facts" className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
          <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>핵심 재무/정산</p>
          <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>결정 전에 숫자와 정책을 한 번 더 확인합니다</h4>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {model.facts.financial.map((item) => <ReviewFactCard key={item.key} item={item} />)}
            {model.facts.settlement.map((item) => <ReviewFactCard key={item.key} item={item} />)}
          </div>
        </section>

        <section data-testid="project-request-review-checklist" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>승인 체크리스트</p>
          <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>세부 근거를 순서대로 검토합니다</h4>
          <div className="mt-4 space-y-3">
            {model.checklistGroups.map((group) => <ReviewGroupCard key={group.key} group={group} />)}
          </div>
        </section>

        <section data-testid="project-request-review-history" className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
          <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>검토 이력</p>
          <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>감사 관점에서 요청과 결정을 다시 읽습니다</h4>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reviewHistoryItems.map((item) => <ReviewFieldRow key={item.key} item={item} />)}
          </div>
        </section>
      </div>

      <ProjectRequestDecisionRail
        request={request}
        model={model}
        reviewHistoryItems={reviewHistoryItems}
        canApprove={canApprove}
        onApprove={onApprove}
        onReject={onReject}
      />
    </div>
  );
}

function ProjectRequestEmptyDetailSurface() {
  return (
    <div data-testid="project-request-detail" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section data-testid="project-request-status-strip" className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
          <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>사업 등록 심사</p>
          <h3 className="mt-2 text-[24px] tracking-[-0.04em] text-slate-950" style={{ fontWeight: 800 }}>검토할 등록 요청이 없습니다</h3>
          <p className="mt-2 text-[13px] leading-6 text-slate-600">새 요청이 들어오면 대기함과 결정 패널에 바로 표시됩니다.</p>
        </section>
        <section data-testid="project-request-risk-board" className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[12px] text-slate-500" style={{ fontWeight: 700 }}>핵심 리스크</p>
          <h4 className="mt-1 text-[18px] tracking-[-0.03em] text-slate-950" style={{ fontWeight: 800 }}>현재 대기 중인 위험 항목이 없습니다</h4>
        </section>
      </div>
      <aside data-testid="project-request-decision-rail" className="xl:sticky xl:top-4">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px] text-slate-950">결정 패널</CardTitle>
            <CardDescription className="text-[12px]">새 요청이 생기면 여기서 승인/반려를 결정합니다.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-[12px] leading-6 text-slate-600">
            아직 선택된 등록 요청이 없습니다.
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

export function ProjectRequestApprovalSection({ compact = false }: ProjectRequestApprovalSectionProps) {
  const state = useProjectRequests();
  const { requests, loading, canApprove, openApprove, openReject } = state;
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'PENDING'),
    [requests],
  );
  const resolvedRequests = useMemo(
    () => requests
      .filter((request) => request.status !== 'PENDING')
      .slice()
      .sort((left, right) => String(right.reviewedAt || right.requestedAt).localeCompare(String(left.reviewedAt || left.requestedAt))),
    [requests],
  );
  const pendingCount = pendingRequests.length;
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (requests.length === 0) {
      setSelectedRequestId(null);
      return;
    }
    const exists = selectedRequestId ? requests.some((request) => request.id === selectedRequestId) : false;
    if (exists) return;
    setSelectedRequestId((pendingRequests[0] || resolvedRequests[0] || requests[0]).id);
  }, [pendingRequests, requests, resolvedRequests, selectedRequestId]);

  const activeRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || pendingRequests[0] || resolvedRequests[0] || null,
    [pendingRequests, requests, resolvedRequests, selectedRequestId],
  );

  return (
    <section className={`space-y-4 ${compact ? '' : 'space-y-5'}`}>
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-teal-600" />
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">사업 등록 심사</h2>
          <p className="text-[12px] text-slate-500">대기함에서 1건을 고르고, 결정 패널에서 바로 승인/반려합니다.</p>
        </div>
        <Badge className="ml-auto bg-teal-100 text-teal-800">{pendingCount}건 대기</Badge>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-2 p-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">사업 등록 요청을 불러오는 중입니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside data-testid="project-request-inbox" className="space-y-4">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-[14px] text-slate-950">대기함</CardTitle>
                <CardDescription className="text-[12px]">지금 결정해야 할 요청부터 위에 보입니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-slate-500">대기 중인 요청</p>
                    <Badge variant="secondary" className="text-[10px]">{pendingRequests.length}건</Badge>
                  </div>
                  <div className="space-y-2">
                    {pendingRequests.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-[12px] text-slate-500">
                        현재 대기 중인 등록 요청이 없습니다.
                      </div>
                    )}
                    {pendingRequests.map((request) => (
                      <ProjectRequestInboxItem
                        key={request.id}
                        request={request}
                        active={request.id === activeRequest.id}
                        onSelect={setSelectedRequestId}
                      />
                    ))}
                  </div>
                </div>
                {resolvedRequests.length > 0 && (
                  <div className="border-t border-slate-200 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-slate-500">처리 완료 이력</p>
                      <Badge variant="secondary" className="text-[10px]">{resolvedRequests.length}건</Badge>
                    </div>
                    <div className="space-y-2">
                      {resolvedRequests.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-[12px] text-slate-500">
                          아직 처리 완료 이력이 없습니다.
                        </div>
                      )}
                      {resolvedRequests.map((request) => (
                        <ProjectRequestInboxItem
                          key={request.id}
                          request={request}
                          active={request.id === activeRequest.id}
                          onSelect={setSelectedRequestId}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>

          {activeRequest ? (
            <ProjectRequestDetailSurface
              request={activeRequest}
              canApprove={canApprove}
              onApprove={openApprove}
              onReject={openReject}
            />
          ) : (
            <ProjectRequestEmptyDetailSurface />
          )}
        </div>
      )}

      <ProjectRequestApprovalDialog {...state} />
    </section>
  );
}

export function ProjectRequestApprovalPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
        title="사업 등록 심사"
        description="계약 근거, 재무/정산, 검토 메모를 한 화면에서 보고 승인/반려를 결정합니다."
        badge="대표 검토"
      />
      <ProjectRequestApprovalSection compact={false} />
    </div>
  );
}

export default ProjectRequestApprovalPage;
