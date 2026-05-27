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

  it('uses projection change alerts for 급변 warnings instead of projection-vs-actual variance', () => {
    expect(cashflowWeeklyPageSource).toContain('sheet?.projectionChangeAlert');
    expect(cashflowWeeklyPageSource).toContain('급변');
    expect(cashflowWeeklyPageSource).toContain('주차 시작 7일 이내 Projection 큰 변경');
    expect(cashflowWeeklyPageSource).not.toContain('computeVariance');
    expect(cashflowWeeklyPageSource).not.toContain('편차 20%');
  });
});
