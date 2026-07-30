import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, RefreshCw, WalletCards, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId, type OrgMember } from '../../data/types';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchPendingCashflowMonthCloseRequestsViaBff,
  reviewCashflowMonthCloseRequestViaBff,
  type CashflowMonthCloseRequest,
  type CashflowMonthCloseMonthSnapshot,
} from '../../lib/platform-bff-client';
import { CumulativeSettlementMonthDetails } from './CumulativeSettlementMonthDetails';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';

type ReviewAction = { request: CashflowMonthCloseRequest; decision: 'APPROVE' | 'REJECT' } | null;

type MonthSnapshotMode = CashflowMonthCloseMonthSnapshot['projection'];
type MonthSnapshotWeek = MonthSnapshotMode['weeks'][number];

const DETAIL_LABELS: Record<string, string> = {
  mode: '구분',
  weekNo: '주차',
  cell: '셀',
  sourceCells: '원본 셀',
  amount: '금액',
  deposit: '입금액',
  totalIn: '수입 합계',
  totalOut: '지출 합계',
  balance: '잔액',
  difference: '차이',
  status: '상태',
  detail: '상세',
};

const REQUEST_STATUS_LABELS: Record<CashflowMonthCloseRequest['status'], string> = {
  BUILDING: '문서 저장 중',
  PENDING: '승인 대기',
  APPROVING: '승인 처리 중',
  UNCERTAIN: '서버 결과 확인 필요',
  APPROVED: '승인',
  REJECTED: '반려',
};

export function formatMoney(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}원` : '—';
}

function formatSnapshotAmount(week: MonthSnapshotWeek, lineId: string) {
  const cell = week.cells.find((item) => item.cashflowLine === lineId);
  if (cell?.cellState === 'EMPTY') return '미입력';
  if (cell?.cellState === 'ZERO') return formatMoney(0);
  if (cell?.cellState === 'VALUE' && cell.amount !== null) return formatMoney(cell.amount);
  const amount = week.amounts[lineId];
  return amount === undefined ? '—' : formatMoney(amount);
}

export function formatDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function resolveRequestPartyName(explicitName: string | null | undefined, members: OrgMember[], uid: string) {
  if (explicitName?.trim()) return explicitName.trim();
  const member = members.find((item) => item.uid === uid) as (OrgMember & {
    memberName?: string;
    memberNickname?: string;
  }) | undefined;
  if (!member) return '구성원 이름 확인 불가';
  if (member.name?.trim()) return member.name.trim();
  const name = member.memberName?.trim() || '';
  const nickname = member.memberNickname?.trim() || '';
  return name && nickname ? `${name}(${nickname})` : name || nickname || '구성원 이름 확인 불가';
}

export function buildMonthCloseHistoryEntries(request: CashflowMonthCloseRequest, members: OrgMember[]) {
  const summary = `${request.yearMonth} 월 결산 승인 요청 · ${request.lockRange ? `${request.lockRange.fromMonth} ${request.lockRange.fromWeekNo}주차 ~ ${request.lockRange.throughMonth} ${request.lockRange.throughWeekNo}주차 · ${request.monthCount?.toLocaleString()}개월` : '제출 시점 저장본'}`;
  const entries: Array<{ kind: 'REQUESTED' | 'REVIEWED' | 'RECOVERY'; actorName: string; at: string; detail: string }> = [{
    kind: 'REQUESTED',
    actorName: resolveRequestPartyName(request.requestedByName, members, request.requestedByUid),
    at: request.requestedAt,
    detail: summary,
  }];
  if (request.reviewedAt || request.decisionReason) entries.push({
    kind: 'REVIEWED' as const,
    actorName: resolveRequestPartyName(request.reviewedByName || request.approverName, members, request.reviewedByUid || request.approverUid),
    at: request.reviewedAt || request.requestedAt,
    detail: request.decisionReason || REQUEST_STATUS_LABELS[request.status],
  });
  if (['APPROVING', 'UNCERTAIN'].includes(request.status)) entries.push({
    kind: 'RECOVERY' as const,
    actorName: resolveRequestPartyName(request.approverName, members, request.approverUid),
    at: request.reviewedAt || request.requestedAt,
    detail: request.status === 'UNCERTAIN' ? '서버 결과를 조회해 중복 마감 없이 복구합니다.' : '저장된 승인 작업을 동일한 요청으로 재개합니다.',
  });
  return entries;
}

function getMonthSnapshot(request: CashflowMonthCloseRequest): CashflowMonthCloseMonthSnapshot | null {
  return request.monthSnapshot;
}

function formatDetailValue(key: string, value: unknown) {
  if (typeof value === 'number' && /amount|deposit|total|balance|difference/i.test(key)) return formatMoney(value);
  if (key === 'weekNo' && typeof value === 'number') return `${value}주차`;
  if (key === 'mode' && typeof value === 'string') return value === 'projection' ? 'Projection' : value === 'actual' ? 'Actual' : value;
  if (typeof value === 'boolean') return value ? '일치' : '불일치';
  return String(value ?? '-');
}

function WarningDetail({ value, label }: { value: unknown; label?: string }) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, index) => <WarningDetail key={index} value={item} label={value.length > 1 ? `${label || '항목'} ${index + 1}` : label} />)}
      </div>
    );
  }
  if (value && typeof value === 'object') {
    return (
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[110px_1fr]">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="contents">
            <dt className="font-medium text-amber-950">{DETAIL_LABELS[key] || key}</dt>
            <dd className="min-w-0 break-words"><WarningDetail value={item} label={key} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{formatDetailValue(label || '', value)}</span>;
}

function MonthModeTable({ title, mode }: { title: 'Projection' | 'Actual'; mode: MonthSnapshotMode }) {
  const weeks = [...mode.weeks].sort((left, right) => left.weekNo - right.weekNo);
  const lineIds = Array.from(new Set([
    ...Object.keys(mode.rowTotals),
    ...weeks.flatMap((week) => Object.keys(week.amounts)),
    ...weeks.flatMap((week) => week.cells.map((cell) => cell.cashflowLine)),
  ]));

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <h4 className="text-[14px] font-bold text-[#001e46]">{title}</h4>
        <span className="text-[10px] text-slate-500">제출 시점 저장본</span>
      </div>
      <div className="overflow-x-auto border border-slate-300">
        <table className="w-full min-w-[720px] border-collapse text-[11px]">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="border-b border-r border-slate-300 px-3 py-2 text-left">항목</th>
              {weeks.map((week) => <th key={week.weekNo} className="border-b border-r border-slate-300 px-3 py-2 text-right">{week.weekNo}주차</th>)}
              <th className="border-b border-slate-300 px-3 py-2 text-right">월 합계</th>
            </tr>
          </thead>
          <tbody>
            {lineIds.map((lineId) => (
              <tr key={lineId}>
                <th className="border-b border-r border-slate-200 px-3 py-2 text-left font-medium text-slate-700">
                  {CASHFLOW_SHEET_LINE_LABELS[lineId as CashflowSheetLineId] || lineId}
                </th>
                {weeks.map((week) => <td key={week.weekNo} className="border-b border-r border-slate-200 px-3 py-2 text-right tabular-nums">{formatSnapshotAmount(week, lineId)}</td>)}
                <td className="border-b border-slate-200 px-3 py-2 text-right font-semibold tabular-nums">{mode.rowTotals[lineId] === undefined ? '—' : formatMoney(mode.rowTotals[lineId])}</td>
              </tr>
            ))}
            {[
              ['수입 합계', 'totalIn', mode.totalIn],
              ['지출 합계', 'totalOut', mode.totalOut],
              ['잔액', 'net', mode.balance],
            ].map(([label, key, total]) => (
              <tr key={String(key)} className="bg-slate-50 font-semibold">
                <th className="border-b border-r border-slate-300 px-3 py-2 text-left">{label}</th>
                {weeks.map((week) => <td key={week.weekNo} className="border-b border-r border-slate-300 px-3 py-2 text-right tabular-nums">{formatMoney(week[key as 'totalIn' | 'totalOut' | 'net'])}</td>)}
                <td className="border-b border-slate-300 px-3 py-2 text-right tabular-nums">{formatMoney(Number(total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MonthlySettlementApprovalSection({
  onPendingCountChange,
}: {
  onPendingCountChange?: (count: number) => void;
}) {
  const { projects, members } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [requests, setRequests] = useState<CashflowMonthCloseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<CashflowMonthCloseRequest | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [action, setAction] = useState<ReviewAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [cumulativeEvidenceReady, setCumulativeEvidenceReady] = useState(false);

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectCics = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cic || project.department || '-'])),
    [projects],
  );

  const load = useCallback(async () => {
    if (!user?.uid || !user.idToken) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const items = await fetchPendingCashflowMonthCloseRequestsViaBff({ tenantId: orgId, actor: user });
      const monthlyCloseItems = items.filter((request) => request.documentType === 'MONTHLY_CLOSE');
      setRequests(monthlyCloseItems);
      onPendingCountChange?.(monthlyCloseItems.length);
    } catch (loadError) {
      setError(resolveApiErrorMessage(loadError, '월 결산 승인 요청을 불러오지 못했습니다.'));
      setRequests([]);
      onPendingCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange, orgId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void load(), 100);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(refreshTimer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  function startReview(request: CashflowMonthCloseRequest, decision: 'APPROVE' | 'REJECT') {
    setSelectedRequest(null);
    setWarningsAcknowledged(false);
    setAction({ request, decision });
    setReason('');
    setActionError('');
  }

  async function submitReview() {
    if (!action || !user?.idToken) return;
    if (action.decision === 'REJECT' && !reason.trim()) return;
    setBusy(true);
    try {
      const expectedRevision = action.request.contractVersion !== 'cashflow-cumulative-close-v2' && action.request.status === 'APPROVING'
        ? Math.max(0, action.request.revision - 1)
        : action.request.revision;
      await reviewCashflowMonthCloseRequestViaBff({
        tenantId: orgId,
        actor: user,
        projectId: action.request.projectId,
        requestId: action.request.requestId,
        payload: {
          decision: action.decision,
          expectedRevision,
          expectedManifestHash: action.request.manifestHash,
          reason: reason.trim() || undefined,
        },
        idempotencyKey: `cashflow-month-close-review:${action.request.requestId}:${expectedRevision}:${action.decision}`,
      });
      toast.success(action.decision === 'APPROVE' ? '월 결산을 승인했습니다.' : '월 결산을 반려했습니다.');
      setAction(null);
      setReason('');
      await load();
    } catch (reviewError) {
      const message = resolveApiErrorMessage(reviewError, '월 결산 검토를 완료하지 못했습니다.');
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const snapshot = selectedRequest ? getMonthSnapshot(selectedRequest) : null;
  const warnings = selectedRequest?.reviewWarnings ?? [];
  const cumulative = selectedRequest?.contractVersion === 'cashflow-cumulative-close-v2';
  const selectedSource = selectedRequest?.source || snapshot?.source;
  const approvalBlocked = cumulative
    ? !selectedRequest?.manifestHash || !cumulativeEvidenceReady || (warnings.length > 0 && !warningsAcknowledged)
    : !snapshot || (warnings.length > 0 && !warningsAcknowledged);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-[#001e46]" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">월 결산 승인 대기</h2>
            <p className="text-[11px] text-slate-500">내가 지정 조직장인 요청만 표시합니다</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-[11px]" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          새로고침
        </Button>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-[12px] text-red-700">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>다시 시도</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card className="border-slate-200 bg-white">
          <CardContent className="flex min-h-[120px] items-center justify-center gap-2 p-6 text-[12px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 월 결산 요청을 불러오고 있습니다.
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card className="border-dashed border-slate-200 bg-slate-50">
          <CardContent className="flex min-h-[140px] flex-col items-center justify-center gap-2 p-6 text-center">
            <WalletCards className="h-5 w-5 text-slate-400" />
            <p className="text-[14px] font-semibold text-slate-900">월 결산 승인 대기 항목이 없습니다</p>
            <p className="text-[12px] text-slate-600">지정된 프로젝트의 결산 요청이 들어오면 여기에 표시됩니다.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-slate-300 bg-white shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto" role="region" aria-label="월 결산 승인 대기 문서" tabIndex={0}>
              <table className="w-full min-w-[1040px] border-collapse text-left">
                <thead className="border-b border-slate-300 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">문서 유형</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3">담당조직(CIC)</th>
                    <th className="px-4 py-3">프로젝트명</th>
                    <th className="px-4 py-3">결산월</th>
                    <th className="px-4 py-3">요청자</th>
                    <th className="px-4 py-3">요청 시각</th>
                    <th className="px-4 py-3">승인자</th>
                    <th className="px-4 py-3 text-right">문서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {requests.map((request) => (
                    <tr key={request.requestId} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><Badge className="border border-slate-300 bg-white text-[#001e46]">{request.documentType === 'MONTHLY_CLOSE' ? '월 결산' : request.documentType}</Badge></td>
                      <td className="px-4 py-3"><Badge className="border border-amber-300 bg-white text-amber-800">{REQUEST_STATUS_LABELS[request.status]}</Badge></td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{projectCics.get(request.projectId) || '-'}</td>
                      <td className="max-w-[300px] px-4 py-3"><p className="truncate text-[13px] font-semibold text-slate-950">{projectNames.get(request.projectId) || request.projectId}</p></td>
                      <td className="px-4 py-3 text-[12px] font-medium text-slate-800">{request.yearMonth}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{resolveRequestPartyName(request.requestedByName, members, request.requestedByUid)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-slate-600">{formatDateTime(request.requestedAt)}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{resolveRequestPartyName(request.approverName, members, request.approverUid)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button type="button" variant="outline" size="sm" className="h-8 rounded-none border-slate-400 text-[11px]" onClick={() => { setSelectedRequest(request); setWarningsAcknowledged(false); setCumulativeEvidenceReady(false); }}>
                          <FileCheck2 className="mr-1 h-3.5 w-3.5" />문서 열기
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => { if (!open) { setSelectedRequest(null); setWarningsAcknowledged(false); setCumulativeEvidenceReady(false); } }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[1180px] overflow-y-auto rounded-none border border-slate-300 bg-slate-100 p-3 sm:p-6">
          <DialogHeader className="sr-only">
            <DialogTitle>월 결산 승인서</DialogTitle>
            <DialogDescription>제출 당시 저장된 월 결산 자료를 검토하고 승인 또는 반려합니다.</DialogDescription>
          </DialogHeader>
          {selectedRequest ? (
            <article className="mx-auto w-full max-w-[1080px] border border-slate-300 bg-white p-5 shadow-sm sm:p-8">
              <header className="border-b-2 border-slate-700 pb-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="flex min-h-[138px] flex-col justify-center">
                    <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">MYSCube · MONTHLY CLOSE</p>
                    <h3 className="mt-3 text-center text-[25px] font-bold tracking-[0.08em]">월 결산 승인서</h3>
                    <p className="mt-2 text-center text-[11px] text-slate-500">요청 시점에 저장된 문서이며 현재 시트와 다시 계산하지 않습니다.</p>
                  </div>
                  <div className="border border-slate-400 text-center text-[11px]">
                    <div className="grid grid-cols-[48px_repeat(2,minmax(0,1fr))]">
                      <div className="flex items-center justify-center border-r border-b border-slate-400 bg-slate-50 font-semibold">결재</div>
                      <div className="border-r border-b border-slate-400 px-2 py-2 font-semibold">기안</div>
                      <div className="border-b border-slate-400 px-2 py-2 font-semibold">조직장 승인</div>
                      <div className="flex items-center justify-center border-r border-b border-slate-400 bg-slate-50 text-[10px] text-slate-600">인</div>
                      <div className="flex min-h-[70px] items-center justify-center break-all border-r border-b border-slate-400 px-2 py-3">{resolveRequestPartyName(selectedRequest.requestedByName, members, selectedRequest.requestedByUid)}</div>
                      <div className="flex min-h-[70px] items-center justify-center break-all border-b border-slate-400 px-2 py-3">{resolveRequestPartyName(selectedRequest.approverName, members, selectedRequest.approverUid)}</div>
                      <div className="flex items-center justify-center border-r border-slate-400 bg-slate-50 text-[10px] text-slate-600">일자</div>
                      <div className="border-r border-slate-400 px-2 py-2">{formatDateTime(selectedRequest.requestedAt)}</div>
                      <div className="px-2 py-2">{selectedRequest.reviewedAt ? formatDateTime(selectedRequest.reviewedAt) : '검토 대기'}</div>
                    </div>
                  </div>
                </div>
              </header>

              <section className="mt-5">
                <h4 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">의견 및 처리 이력</h4>
                <div className="border border-t-0 border-slate-400 text-[12px]">
                  {buildMonthCloseHistoryEntries(selectedRequest, members).map((entry) => (
                    <div key={`${entry.kind}:${entry.at}`} className="grid gap-1 border-t border-slate-300 px-3 py-3 first:border-t-0 sm:grid-cols-[120px_1fr]">
                      <strong>{entry.kind === 'REQUESTED' ? '요청' : entry.kind === 'REVIEWED' ? '검토' : '복구 상태'}</strong>
                      <span><span className="font-semibold">{entry.actorName}</span> · {formatDateTime(entry.at)}<br />{entry.detail}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mt-6 grid border-l border-t border-slate-300 text-[11px] sm:grid-cols-2">
                {[
                  ['문서 번호', selectedRequest.requestId],
                  ['문서 유형', '월 결산'],
                  ['기안자', resolveRequestPartyName(selectedRequest.requestedByName, members, selectedRequest.requestedByUid)],
                  ['결재 상태', REQUEST_STATUS_LABELS[selectedRequest.status]],
                  ['프로젝트', projectNames.get(selectedRequest.projectId) || snapshot?.projectId || selectedRequest.projectId],
                  ['결산월', selectedRequest.yearMonth],
                  ['요청 시각', formatDateTime(selectedRequest.requestedAt)],
                  ['문서 저장 시각', formatDateTime(selectedSource?.capturedAt || null)],
                  ['원본 revision', selectedSource?.sourceRevision || '-'],
                  ['결산 revision', selectedSource?.targetRevision || '-'],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[110px_1fr] border-b border-r border-slate-300">
                    <strong className="bg-slate-100 px-3 py-2.5 text-slate-700">{label}</strong>
                    <span className="break-all px-3 py-2.5 text-slate-900">{value}</span>
                  </div>
                ))}
              </section>

              {selectedSource ? (
                <section className="mt-6">
                  <h4 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">저장 시트</h4>
                  <div className="grid border border-t-0 border-slate-400 text-[11px] sm:grid-cols-[150px_minmax(0,1fr)_150px]">
                    <strong className="bg-slate-100 px-3 py-3 text-slate-700">{selectedSource.spreadsheetTitle || '제목 없음'}</strong>
                    <span className="break-all border-y border-slate-300 px-3 py-3 text-slate-700 sm:border-x sm:border-y-0">{selectedSource.selectedSheetName || '시트명 없음'}</span>
                    {selectedSource.spreadsheetUrl ? (
                      <a className="px-3 py-3 text-center font-semibold text-[#174a7c] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#174a7c]" href={selectedSource.spreadsheetUrl} target="_blank" rel="noreferrer">저장 시트 열기</a>
                    ) : <span className="px-3 py-3 text-center text-slate-500">저장 시트 링크 없음</span>}
                  </div>
                </section>
              ) : null}

              {cumulative && selectedRequest.lockRange && selectedRequest.totals ? (
                <div className="mt-7 space-y-7">
                  <section className="border-2 border-[#174a7c] bg-[#eef4f8] p-4" aria-label="누적 결산 고정 범위">
                    <p className="text-[11px] font-semibold text-[#174a7c]">IMMUTABLE CUMULATIVE RANGE</p>
                    <p className="mt-1 text-[18px] font-bold text-slate-950">
                      {selectedRequest.lockRange.fromMonth} {selectedRequest.lockRange.fromWeekNo}주차 ~ {selectedRequest.lockRange.throughMonth} {selectedRequest.lockRange.throughWeekNo}주차
                    </p>
                    <p className="mt-2 text-[12px] text-slate-700">
                      {selectedRequest.monthCount?.toLocaleString()}개월 · {selectedRequest.weekCount?.toLocaleString()}주 · Projection/Actual {selectedRequest.cellCount?.toLocaleString()}셀
                    </p>
                    <p className="mt-1 text-[12px] font-semibold text-slate-800">승인하면 이 범위의 모든 주차가 수정 불가 상태가 됩니다.</p>
                    <p className="mt-2 break-all text-[10px] text-slate-500">manifest {selectedRequest.manifestHash}</p>
                  </section>

                  <section>
                    <h4 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">전체 요약</h4>
                    <div className="grid border-l border-t border-slate-300 sm:grid-cols-3">
                      {(['projection', 'actual', 'difference'] as const).map((mode) => (
                        <div key={mode} className="border-b border-r border-slate-300 p-3">
                          <p className="text-[11px] font-bold text-[#001e46]">{mode === 'projection' ? 'Projection' : mode === 'actual' ? 'Actual' : '차이'}</p>
                          <p className="mt-2 text-right text-[14px] font-semibold tabular-nums">{formatMoney(selectedRequest.totals?.[mode])}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h4 className="border-b-2 border-slate-700 pb-2 text-[14px] font-bold">연도별 요약</h4>
                    <div className="overflow-x-auto border border-t-0 border-slate-300" role="region" aria-label="누적 결산 연도별 요약" tabIndex={0}>
                      <table className="w-full min-w-[1080px] border-collapse text-[11px]">
                        <caption className="sr-only">연도별 Projection, Actual, 차이의 셀 금액 합계</caption>
                        <thead className="bg-slate-100"><tr><th className="px-3 py-2 text-left">연도</th><th className="px-3 py-2 text-right">포함 월</th>{(['Projection 합계', 'Actual 합계', '차이'] as const).map((label) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}</tr></thead>
                        <tbody>{(selectedRequest.annualSummaries || []).map((annual) => (
                          <tr key={annual.year} className="border-t border-slate-200"><th className="px-3 py-2 text-left">{annual.year}년</th><td className="px-3 py-2 text-right">{annual.monthCount}개월</td>{(['projection', 'actual', 'difference'] as const).map((mode) => <td key={mode} className="px-3 py-2 text-right tabular-nums">{formatMoney(annual[mode])}</td>)}</tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 border-b-2 border-slate-700 pb-2 text-[14px] font-bold">월·주차·항목 상세</h4>
                    <CumulativeSettlementMonthDetails tenantId={orgId} actor={user!} request={selectedRequest} onReadyChange={setCumulativeEvidenceReady} />
                  </section>

                </div>
              ) : snapshot ? (
                <div className="mt-7 space-y-7">
                  <MonthModeTable title="Projection" mode={snapshot.projection} />
                  <MonthModeTable title="Actual" mode={snapshot.actual} />
                  <section>
                    <h4 className="mb-2 text-[14px] font-bold text-[#001e46]">Projection 대비 Actual 차이</h4>
                    <div className="grid border-l border-t border-slate-300 sm:grid-cols-3">
                      {[
                        ['수입 차이', snapshot.difference.totalIn],
                        ['지출 차이', snapshot.difference.totalOut],
                        ['잔액 차이', snapshot.difference.balance],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="border-b border-r border-slate-300 px-4 py-3">
                          <p className="text-[10px] text-slate-500">{label}</p>
                          <p className="mt-1 text-right text-[14px] font-bold tabular-nums text-slate-900">{formatMoney(Number(value))}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="mt-7 border border-red-200 bg-red-50 p-4 text-[12px] text-red-800">
                  제출 당시 저장된 월 결산 문서가 없습니다. 원본 시트를 대신 조회하지 않으며 승인할 수 없습니다.
                </div>
              )}

              {warnings.length > 0 ? (
                <section className="mt-7 border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-950">
                    <AlertTriangle className="h-4 w-4" />
                    <h4 className="text-[13px] font-bold">결재 전 확인사항 {warnings.length}건</h4>
                  </div>
                  <div className="mt-3 space-y-3">
                    {warnings.map((warning, index) => (
                      <div key={`${warning.code}:${index}`} className="border border-amber-200 bg-white p-3 text-[11px] text-amber-900">
                        <p className="font-semibold"><code className="mr-2 text-[10px]">{warning.code}</code>{warning.message}</p>
                        {warning.details !== undefined ? <div className="mt-2 border-t border-amber-100 pt-2"><WarningDetail value={warning.details} /></div> : null}
                      </div>
                    ))}
                  </div>
                  <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-amber-200 pt-3 text-[12px] font-semibold text-amber-950">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#001e46]" checked={warningsAcknowledged} onChange={(event) => setWarningsAcknowledged(event.target.checked)} />
                    위 경고와 셀·주차·금액 상세를 확인했습니다.
                  </label>
                </section>
              ) : null}

              <footer className="mt-8 flex flex-wrap justify-end gap-2 border-t border-slate-300 pt-5">
                <Button variant="outline" size="sm" onClick={() => { setSelectedRequest(null); setWarningsAcknowledged(false); }}>닫기</Button>
                {selectedRequest.status === 'PENDING' ? (
                  <Button variant="outline" size="sm" className="gap-1 border-red-300 text-red-700" onClick={() => startReview(selectedRequest, 'REJECT')}>
                    <XCircle className="h-3.5 w-3.5" /> 반려
                  </Button>
                ) : null}
                <Button size="sm" className="gap-1 bg-[#001e46] hover:bg-[#001735]" disabled={approvalBlocked} onClick={() => startReview(selectedRequest, 'APPROVE')}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> {selectedRequest.status === 'UNCERTAIN' ? '결과 확인 후 재개' : selectedRequest.status === 'APPROVING' ? '처리 재개' : '승인'}
                </Button>
              </footer>
            </article>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">{action?.decision === 'APPROVE' ? '월 결산 승인' : '월 결산 반려'}</DialogTitle>
            <DialogDescription className="text-[11px]">검토한 저장 문서에 대한 처리 의견을 남깁니다.</DialogDescription>
          </DialogHeader>
          {actionError ? <div role="alert" className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">{actionError}</div> : null}
          <Textarea value={reason} onChange={(event) => { setReason(event.target.value); setActionError(''); }} maxLength={2000} aria-label={action?.decision === 'APPROVE' ? '승인 코멘트' : '반려 사유'} className="min-h-[88px] text-[12px]" placeholder={action?.decision === 'APPROVE' ? '승인 코멘트 (선택)' : '반려 사유 (필수)'} />
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setAction(null)}>취소</Button>
            <Button
              size="sm"
              disabled={busy || (action?.decision === 'REJECT' && !reason.trim())}
              className={action?.decision === 'APPROVE' ? 'bg-[#001e46] hover:bg-[#001735]' : 'bg-red-700 hover:bg-red-800'}
              onClick={() => void submitReview()}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {action?.decision === 'APPROVE' ? '승인' : '반려'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
