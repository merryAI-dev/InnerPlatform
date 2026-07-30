import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import {
  fetchCashflowMonthCloseRequestMonthsViaBff,
  type CashflowMonthCloseMonthShard,
  type CashflowMonthCloseMonthShardPage,
  type CashflowMonthCloseRequest,
} from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import { Button } from '../ui/button';

type Actor = { uid: string; idToken?: string; role?: string };

type CumulativeMonthLoadState = {
  months: CashflowMonthCloseMonthShard[];
  nextCursor: string | null;
  ready: boolean;
};

function monthsBetween(fromMonth: string, throughMonth: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(throughMonth)) {
    throw new Error('누적 결산 문서의 월 범위가 올바르지 않습니다.');
  }
  const [fromYear, from] = fromMonth.split('-').map(Number);
  const [throughYear, through] = throughMonth.split('-').map(Number);
  const fromIndex = fromYear * 12 + from - 1;
  const throughIndex = throughYear * 12 + through - 1;
  if (fromIndex > throughIndex) throw new Error('누적 결산 문서의 월 범위가 올바르지 않습니다.');
  return Array.from({ length: throughIndex - fromIndex + 1 }, (_, offset) => {
    const index = fromIndex + offset;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

function expectedRequestMonths(request: CashflowMonthCloseRequest) {
  if (
    !request.fromMonth
    || !request.lockRange
    || request.lockRange.fromMonth !== request.fromMonth
    || request.lockRange.throughMonth !== request.yearMonth
    || request.lockRange.fromWeekNo !== 1
    || request.lockRange.throughWeekNo !== 5
    || !Number.isSafeInteger(request.monthCount)
  ) throw new Error('누적 결산 문서의 고정 범위가 요청 header와 일치하지 않습니다.');
  const expected = monthsBetween(request.fromMonth, request.yearMonth);
  if (expected.length !== request.monthCount) throw new Error('누적 결산 문서의 월 수가 요청 header와 일치하지 않습니다.');
  return expected;
}

function assertShardIdentity(request: CashflowMonthCloseRequest, shard: CashflowMonthCloseMonthShard) {
  if (
    shard.contractVersion !== 'cashflow-cumulative-close-v2'
    || shard.requestId !== request.requestId
    || shard.projectId !== request.projectId
  ) throw new Error('월별 저장 문서가 다른 누적 결산 요청에 속합니다.');
}

export function validateCumulativeSettlementMonthPage(
  request: CashflowMonthCloseRequest,
  loadedMonths: CashflowMonthCloseMonthShard[],
  page: CashflowMonthCloseMonthShardPage,
): CumulativeMonthLoadState {
  const expected = expectedRequestMonths(request);
  if (
    page.requestId !== request.requestId
    || page.requestRevision !== request.revision
    || page.manifestHash !== request.manifestHash
    || page.monthCount !== request.monthCount
  ) throw new Error('저장된 누적 결산 문서의 manifest가 요청 header와 일치하지 않습니다.');
  if (!Array.isArray(page.months) || page.months.length < 1 || page.months.length > 12) {
    throw new Error('월별 저장 문서 페이지 크기가 올바르지 않습니다.');
  }

  const combined = [...loadedMonths, ...page.months];
  if (combined.length > expected.length) throw new Error('월별 저장 문서 수가 요청 범위를 초과합니다.');
  combined.forEach((shard, index) => {
    assertShardIdentity(request, shard);
    if (shard.yearMonth !== expected[index]) throw new Error('월별 저장 문서에 중복되거나 누락된 월이 있습니다.');
  });

  const expectedNextCursor = expected[combined.length] || null;
  if (page.nextCursor !== expectedNextCursor) {
    throw new Error(page.nextCursor === null
      ? '월별 저장 문서가 요청한 전체 월 수보다 일찍 끝났습니다.'
      : '월별 저장 문서의 다음 페이지 위치가 연속되지 않습니다.');
  }
  return { months: combined, nextCursor: page.nextCursor, ready: combined.length === expected.length && page.nextCursor === null };
}

export async function loadCumulativeSettlementMonthPages({
  request,
  fetchPage,
  onProgress,
  startMonths = [],
  startCursor,
}: {
  request: CashflowMonthCloseRequest;
  fetchPage: (params: { cursor?: string; limit: number }) => Promise<CashflowMonthCloseMonthShardPage>;
  onProgress?: (state: CumulativeMonthLoadState) => void;
  startMonths?: CashflowMonthCloseMonthShard[];
  startCursor?: string;
}) {
  const expected = expectedRequestMonths(request);
  startMonths.forEach((shard, index) => {
    assertShardIdentity(request, shard);
    if (shard.yearMonth !== expected[index]) throw new Error('이미 불러온 월별 저장 문서에 중복되거나 누락된 월이 있습니다.');
  });
  const expectedStartCursor = startMonths.length === 0 ? undefined : expected[startMonths.length];
  if (expectedStartCursor !== startCursor) {
    throw new Error('월별 저장 문서 재시도 위치가 연속되지 않습니다.');
  }

  let months = startMonths;
  let cursor = startCursor;
  const requestedCursors = new Set<string>();
  while (true) {
    const cursorKey = cursor || '__first__';
    if (requestedCursors.has(cursorKey)) throw new Error('월별 저장 문서의 다음 페이지 위치가 반복됩니다.');
    requestedCursors.add(cursorKey);
    const page = await fetchPage({ cursor, limit: 12 });
    const state = validateCumulativeSettlementMonthPage(request, months, page);
    months = state.months;
    cursor = state.nextCursor || undefined;
    onProgress?.(state);
    if (state.ready) return state;
  }
}

function formatMoney(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function cellLabel(shard: CashflowMonthCloseMonthShard, mode: 'projection' | 'actual', weekNo: number, lineId: string) {
  const cell = shard.cells.find((item) => item.mode === mode && item.weekNo === weekNo && item.cashflowLine === lineId);
  if (!cell || cell.cellState === 'EMPTY') return '미입력';
  if (cell.cellState === 'ZERO') return formatMoney(0);
  return cell.amount == null ? '미입력' : formatMoney(cell.amount);
}

function MonthTable({ shard, mode }: { shard: CashflowMonthCloseMonthShard; mode: 'projection' | 'actual' }) {
  const lineIds = CASHFLOW_ALL_LINES.filter((lineId) => shard.cells.some((cell) => cell.mode === mode && cell.cashflowLine === lineId));
  return (
    <section className="mt-3" aria-label={`${shard.yearMonth} ${mode === 'projection' ? 'Projection' : 'Actual'}`}>
      <h6 className="mb-1 text-[12px] font-bold text-[#001e46]">{mode === 'projection' ? 'Projection' : 'Actual'}</h6>
      <div className="overflow-x-auto rounded-sm border border-slate-300" role="region" aria-label={`${shard.yearMonth} ${mode} 주차별 금액`} tabIndex={0}>
        <table className="w-full min-w-[720px] border-collapse text-[11px]">
          <caption className="sr-only">{shard.yearMonth} {mode} 1주차부터 5주차까지의 항목별 저장 금액</caption>
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="border-b border-r border-slate-300 px-3 py-2 text-left">항목</th>
              {[1, 2, 3, 4, 5].map((weekNo) => <th key={weekNo} className="border-b border-r border-slate-300 px-3 py-2 text-right">{weekNo}주차</th>)}
            </tr>
          </thead>
          <tbody>
            {lineIds.map((lineId) => (
              <tr key={lineId}>
                <th className="border-b border-r border-slate-200 px-3 py-2 text-left font-medium text-slate-700">
                  {CASHFLOW_SHEET_LINE_LABELS[lineId as CashflowSheetLineId] || lineId}
                </th>
                {[1, 2, 3, 4, 5].map((weekNo) => (
                  <td key={weekNo} className="border-b border-r border-slate-200 px-3 py-2 text-right tabular-nums">
                    {cellLabel(shard, mode, weekNo, lineId)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CumulativeSettlementMonthDetails({
  tenantId,
  actor,
  request,
  onReadyChange,
}: {
  tenantId: string;
  actor: Actor;
  request: CashflowMonthCloseRequest;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [months, setMonths] = useState<CashflowMonthCloseMonthShard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generationRef = useRef(0);

  const load = useCallback(async (
    cursor: string | undefined,
    loadedMonths: CashflowMonthCloseMonthShard[],
    generation: number,
  ) => {
    if (!actor.idToken || !request.manifestHash) {
      setLoading(false);
      setError('로그인 세션 또는 누적 결산 manifest를 확인할 수 없습니다.');
      onReadyChange?.(false);
      return;
    }
    setLoading(true);
    setError('');
    onReadyChange?.(false);
    try {
      await loadCumulativeSettlementMonthPages({
        request,
        startMonths: loadedMonths,
        startCursor: cursor,
        fetchPage: ({ cursor: pageCursor, limit }) => fetchCashflowMonthCloseRequestMonthsViaBff({
          tenantId,
          actor,
          projectId: request.projectId,
          requestId: request.requestId,
          requestRevision: request.revision,
          cursor: pageCursor,
          limit,
        }),
        onProgress: (state) => {
          if (generationRef.current !== generation) return;
          setMonths(state.months);
          setNextCursor(state.nextCursor);
          onReadyChange?.(state.ready);
        },
      });
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      setError(resolveApiErrorMessage(loadError, '월별 저장 문서를 불러오지 못했습니다.'));
      onReadyChange?.(false);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [actor, onReadyChange, request, tenantId]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setMonths([]);
    setNextCursor(null);
    onReadyChange?.(false);
    void load(undefined, [], generation);
    return () => { generationRef.current += 1; };
  }, [load, onReadyChange]);

  const years = useMemo(() => {
    const groups = new Map<string, CashflowMonthCloseMonthShard[]>();
    months.forEach((month) => {
      const year = month.yearMonth.slice(0, 4);
      groups.set(year, [...(groups.get(year) || []), month]);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [months]);

  if (loading && months.length === 0) {
    return <div className="flex min-h-[120px] items-center justify-center gap-2 border border-slate-300 text-[12px] text-slate-500" aria-busy="true"><Loader2 className="h-4 w-4 animate-spin" />월별 저장 문서를 불러오고 있습니다.</div>;
  }

  if (error && months.length === 0) {
    const permission = /403|권한/.test(error);
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-red-200 bg-red-50 p-4 text-[12px] text-red-800">
        <span>{permission ? '지정된 조직장만 이 누적 결산 문서를 열 수 있습니다.' : error}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(undefined, [], generationRef.current)}><RefreshCw className="mr-1 h-3.5 w-3.5" />다시 시도</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="flex items-center justify-center gap-2 border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600" aria-live="polite" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />월별 저장 문서 검증 중 · {months.length.toLocaleString()}/{request.monthCount?.toLocaleString()}개월
        </p>
      ) : null}
      {years.map(([year, yearMonths]) => (
        <details key={year} className="border border-slate-300 bg-white" open={years.length === 1}>
          <summary className="cursor-pointer bg-slate-100 px-4 py-3 text-[13px] font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#174a7c]">
            {year}년 · {yearMonths.length}개월 불러옴
          </summary>
          <div className="space-y-3 p-3">
            {yearMonths.map((month) => (
              <details key={month.yearMonth} className="border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#174a7c]">
                  {month.yearMonth} · 제출 시점 저장본
                </summary>
                <div className="border-t border-slate-200 p-3">
                  <MonthTable shard={month} mode="projection" />
                  <MonthTable shard={month} mode="actual" />
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
      {error ? <div role="alert" className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">{error} <span className="font-semibold">검증 완료 {months.length.toLocaleString()}/{request.monthCount?.toLocaleString()}개월</span> <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void load(nextCursor || undefined, months, generationRef.current)}><RefreshCw className="mr-1 h-3.5 w-3.5" />다시 시도</Button></div> : null}
      {!loading && !error && nextCursor === null && months.length === request.monthCount ? (
        <p className="text-center text-[11px] text-slate-500" aria-live="polite">월별 저장 문서 {months.length.toLocaleString()}건을 모두 불러왔습니다.</p>
      ) : null}
    </div>
  );
}
