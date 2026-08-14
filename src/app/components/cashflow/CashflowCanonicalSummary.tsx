import type { CashflowProjectionActualSummary } from '../../lib/platform-bff-client';

export function CashflowCanonicalSummary(props: {
  summary?: CashflowProjectionActualSummary;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  if (!props.summary && props.loading) return <span role="status" className="text-muted-foreground">확인 중</span>;
  if (!props.summary?.display) {
    return (
      <span role="alert" className="text-red-700">
        확인 불가
        {props.onRetry ? <button type="button" className="ml-1 underline underline-offset-2" onClick={props.onRetry}>다시 조회</button> : null}
      </span>
    );
  }
  const { display } = props.summary;
  return (
    <span className="space-y-0.5">
      <span className="block text-[10px] text-muted-foreground">
        {display.periodLabel}
      </span>
      <span className={`block font-semibold ${display.statusTone === 'success' ? 'text-teal-700' : 'text-red-700'}`}>
        {display.statusLabel}
      </span>
      <span className="block tabular-nums">{display.differenceLabel}</span>
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
