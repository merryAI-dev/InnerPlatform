import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeklyPageSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'),
  'utf8',
);

describe('CashflowWeeklyPage status semantics', () => {
  it('marks 작성완료 from projection updates instead of actual PM submission', () => {
    expect(cashflowWeeklyPageSource).toContain('title="주간 프로젝션 작성 현황(전사)"');
    expect(cashflowWeeklyPageSource).toContain('projectionUpdated: Boolean(w.projectionUpdated)');
    expect(cashflowWeeklyPageSource).toContain('작성완료=Projection 저장');
    expect(cashflowWeeklyPageSource).not.toContain('function hasProjectionInput');
    expect(cashflowWeeklyPageSource).not.toContain('pmSubmitted: Boolean(w.pmSubmitted)');
    expect(cashflowWeeklyPageSource).not.toContain('작성완료=PM 작성완료');
  });
});
