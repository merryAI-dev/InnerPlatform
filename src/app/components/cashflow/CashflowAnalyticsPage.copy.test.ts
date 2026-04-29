import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CashflowAnalyticsPage.tsx', import.meta.url), 'utf8');

describe('CashflowAnalyticsPage copy', () => {
  it('uses bank transaction analysis wording for the report title', () => {
    expect(source).toContain('입출금 분석');
    expect(source).not.toContain('캐시플로 분석');
  });

  it('orders filters from organization to project type to project name', () => {
    const organizationIndex = source.indexOf('FilterLabel label="조직 구분"');
    const typeIndex = source.indexOf('FilterLabel label="사업 유형"');
    const projectIndex = source.indexOf('FilterLabel label="사업명"');

    expect(organizationIndex).toBeGreaterThan(-1);
    expect(typeIndex).toBeGreaterThan(organizationIndex);
    expect(projectIndex).toBeGreaterThan(typeIndex);
  });

  it('removes the bank guide label from the report header', () => {
    expect(source).not.toContain('MYSC Bank Use Guide');
  });

  it('renders the monthly bank usage trend as a line chart', () => {
    expect(source).toContain('<LineChart data={analytics.monthlyRows}>');
    expect(source).not.toContain('<AreaChart data={analytics.monthlyRows}>');
  });
});
