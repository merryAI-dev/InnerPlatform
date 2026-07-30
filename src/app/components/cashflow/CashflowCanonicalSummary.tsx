import type { CashflowProjectionActualSummary } from '../../lib/platform-bff-client';

export function CashflowCanonicalSummary(props: {
  summary?: CashflowProjectionActualSummary;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  if (!props.summary && props.loading) return <span role="status" className="text-muted-foreground">확인 중</span>;
  if (!props.summary) {
    return (
      <span role="alert" className="text-red-700">
        조회 오류
        {props.onRetry ? <button type="button" className="ml-1 underline underline-offset-2" onClick={props.onRetry}>다시 조회</button> : null}
      </span>
    );
  }
  const { summary } = props;
  return (
    <span className="space-y-0.5">
      <span className="block text-[10px] text-muted-foreground">
        누적 {summary.fromMonth}~{summary.comparisonAsOfWeek.yearMonth} {summary.comparisonAsOfWeek.weekNo}주차
      </span>
      <span className={`block font-semibold ${summary.settlementMatches ? 'text-teal-700' : 'text-red-700'}`}>
        {summary.settlementMatches ? '일치 · 100%' : '불일치'}
      </span>
      <span className="block tabular-nums">차액 {summary.settlementDifferenceAmount.toLocaleString('ko-KR')}원</span>
      {props.loading ? <span role="status" className="block text-[10px] text-muted-foreground">다시 확인 중…</span> : null}
      {props.error ? (
        <span className="block text-[10px] text-amber-700">
          최신 조회 실패
          {props.onRetry ? <button type="button" className="ml-1 underline underline-offset-2" onClick={props.onRetry}>다시 조회</button> : null}
        </span>
      ) : null}
    </span>
  );
}
