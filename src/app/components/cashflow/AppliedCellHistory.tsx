import { useEffect, useMemo, useState } from 'react';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import {
  fetchCashflowAppliedCellChangesViaBff,
  type ActorLike,
  type CashflowAppliedCellChange,
} from '../../lib/platform-bff-client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PAGE_LIMIT = 50;
const MAX_PAGES = 100;

function cellValue(state: CashflowAppliedCellChange['beforeState'], amount: number | null): string {
  if (state === 'EMPTY') return 'EMPTY';
  if (state === 'ZERO') return '0원 (ZERO)';
  return `${Number(amount).toLocaleString('ko-KR')}원`;
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

export function AppliedCellHistory({ tenantId, actor, projectId }: { tenantId: string; actor: ActorLike; projectId: string }) {
  const [items, setItems] = useState<CashflowAppliedCellChange[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setItems([]);
    setNextCursor('');
    setPageCount(0);
    setError('');
    setLoading(true);
    void fetchCashflowAppliedCellChangesViaBff({ tenantId, actor, projectId, limit: PAGE_LIMIT })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setPageCount(1);
      })
      .catch((loadError) => { if (active) setError(resolveApiErrorMessage(loadError, '실제 반영 이력을 불러오지 못했습니다.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actor, projectId, reloadKey, tenantId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko-KR');
    return needle ? items.filter((item) => `${item.eventId} ${item.cellId} ${item.yearMonth} ${item.weekNo} ${item.mode} ${item.lineId} ${item.actorName || ''} ${item.actorEmail || ''} ${item.reason || ''} ${item.source || ''} ${item.operationType || ''} ${item.operationId || ''} ${item.auditId || ''}`.toLocaleLowerCase('ko-KR').includes(needle)) : items;
  }, [items, query]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    if (pageCount >= MAX_PAGES) {
      setError('안전을 위해 100페이지에서 추가 조회를 중단했습니다.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const page = await fetchCashflowAppliedCellChangesViaBff({ tenantId, actor, projectId, limit: PAGE_LIMIT, cursor: nextCursor });
      if (page.nextCursor && page.nextCursor === nextCursor) throw new Error('이력 페이지가 반복되어 추가 조회를 중단했습니다.');
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setPageCount((count) => count + 1);
    } catch (loadError) {
      setError(resolveApiErrorMessage(loadError, '추가 실제 반영 이력을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-2" aria-label="실제 반영 변경 이력">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h4 className="text-[14px] font-bold">실제 반영 변경 이력</h4><p className="text-[11px] text-slate-500">현재 불러온 {items.length}개 행에서 검색합니다. 더 오래된 이력은 아래에서 추가로 불러올 수 있습니다.</p></div>
        <Input aria-label="실제 반영 이력 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="월·주차·항목·변경자·ID 검색" className="w-full sm:w-[280px]" />
      </div>
      {error ? <div role="alert" className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error} <Button type="button" size="sm" variant="outline" onClick={() => items.length ? void loadMore() : setReloadKey((key) => key + 1)}>다시 시도</Button></div> : null}
      <div className="max-h-[320px] overflow-auto border border-slate-300" role="region" aria-label="프로젝트 실제 반영 전체 이력" tabIndex={0}>
        {loading && items.length === 0 ? <p role="status" className="p-5 text-center text-[12px] text-slate-500">실제 반영 이력을 불러오는 중입니다.</p> : !error && items.length === 0 ? <p className="p-5 text-center text-[12px] text-slate-500">저장된 실제 반영 이력이 없습니다.</p> : (
          <table className="w-full min-w-[1100px] border-collapse text-[11px]"><caption className="sr-only">월, 주차, mode, 항목, 이전 상태와 금액, 변경 상태와 금액, 변경자, 시간, 사유, source, operation과 audit ID</caption><thead className="sticky top-0 bg-slate-100"><tr><th className="px-2 py-2 text-left">월·주차</th><th className="px-2 py-2 text-left">mode·항목</th><th className="px-2 py-2 text-left">이전값 → 변경값</th><th className="px-2 py-2 text-left">변경자·시간</th><th className="px-2 py-2 text-left">사유·source</th><th className="px-2 py-2 text-left">operation·audit</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.cellId} className="border-t border-slate-200"><td className="px-2 py-2">{item.yearMonth}{item.weekNo > 0 ? ` ${item.weekNo}주차` : ' 연간'}</td><td className="px-2 py-2">{item.mode} · {CASHFLOW_SHEET_LINE_LABELS[item.lineId as CashflowSheetLineId] || item.lineId}</td><td className="px-2 py-2 tabular-nums">{cellValue(item.beforeState, item.beforeAmount)} → {cellValue(item.afterState, item.afterAmount)}</td><td className="px-2 py-2">{item.actorName || item.actorEmail || item.actorUid || '-'} · {dateTime(item.createdAt)}</td><td className="px-2 py-2">{item.reason || '미기록'} · {item.source || '-'}</td><td className="px-2 py-2 break-all">{item.operationType || '-'} · {item.operationId || '-'} · audit {item.auditId || '-'}<br />event {item.eventId} · cell {item.cellId}<br />revision {item.sourceRevision || '-'} → {item.targetRevision || '-'}</td></tr>)}</tbody></table>
        )}
      </div>
      {nextCursor ? <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()}>{loading ? '추가 이력 불러오는 중…' : '이전 이력 더 불러오기'}</Button> : items.length ? <p role="status" className="text-[11px] text-slate-500">마지막 이력까지 모두 불러왔습니다.</p> : null}
    </section>
  );
}
