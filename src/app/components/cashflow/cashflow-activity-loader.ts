import type { CashflowActivitySource } from '../../lib/platform-bff-client';

export const CASHFLOW_ACTIVITY_SOURCES = ['legacy', 'sheet_refresh', 'audit'] as const satisfies readonly CashflowActivitySource[];

export async function loadCashflowActivitySourcesSequentially<T>(
  loadSource: (source: CashflowActivitySource) => Promise<T>,
  onSuccess: (source: CashflowActivitySource, result: T) => void = () => undefined,
  onError: (source: CashflowActivitySource, error: unknown) => void = () => undefined,
): Promise<void> {
  for (const source of CASHFLOW_ACTIVITY_SOURCES) {
    try {
      onSuccess(source, await loadSource(source));
    } catch (error) {
      onError(source, error);
    }
  }
}
