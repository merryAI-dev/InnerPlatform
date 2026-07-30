import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import {
  fetchCashflowMonthCloseRequestMonthsViaBff,
  type CashflowMonthCloseMonthShard,
  type CashflowMonthCloseRequest,
} from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { CASHFLOW_ALL_LINES } from '../../platform/cashflow-sheet';
import { Button } from '../ui/button';

type Actor = { uid: string; idToken?: string; role?: string };

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

  const load = useCallback(async (cursor?: string) => {
    if (!actor.idToken || !request.manifestHash) return;
    setLoading(true);
    setError('');
    try {
      const page = await fetchCashflowMonthCloseRequestMonthsViaBff({
        tenantId,
        actor,
        projectId: request.projectId,
        requestId: request.requestId,
        requestRevision: request.revision,
        cursor,
      });
      if (page.requestRevision !== request.revision || page.manifestHash !== request.manifestHash || page.monthCount !== request.monthCount) {
        throw new Error('저장된 누적 결산 문서의 manifest가 요청 header와 일치하지 않습니다.');
      }
      setMonths((current) => cursor ? [...current, ...page.months] : page.months);
      setNextCursor(page.nextCursor);
      onReadyChange?.(true);
    } catch (loadError) {
      setError(resolveApiErrorMessage(loadError, '월별 저장 문서를 불러오지 못했습니다.'));
      onReadyChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [actor, onReadyChange, request, tenantId]);

  useEffect(() => {
    setMonths([]);
    setNextCursor(null);
    onReadyChange?.(false);
    void load();
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
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1 h-3.5 w-3.5" />다시 시도</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
      {error ? <div role="alert" className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">{error} <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void load(nextCursor || undefined)}>다시 시도</Button></div> : null}
      {nextCursor ? (
        <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => void load(nextCursor)}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}다음 월별 저장 문서 불러오기
        </Button>
      ) : (
        <p className="text-center text-[11px] text-slate-500" aria-live="polite">월별 저장 문서 {months.length.toLocaleString()}건을 모두 불러왔습니다.</p>
      )}
    </div>
  );
}
