import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'CashflowPage.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');
const exportSource = readFileSync(resolve(import.meta.dirname, 'CashflowExportPage.tsx'), 'utf8');

describe('Cashflow entry routes', () => {
  it('opens weekly history and keeps cashflow download under management planning', () => {
    expect(pageSource).toContain('<CashflowWeeklyPage />');
    expect(pageSource).not.toContain('CashflowMonitorPage');
    expect(routesSource).toContain("{ path: 'cashflow/export', element: <S C={CashflowExportPage} /> }");
    expect(exportSource).toContain('title="경영기획실 통합 관리"');
    expect(exportSource).toContain('현금흐름 엑셀을 다운로드합니다.');
  });
});
