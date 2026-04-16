import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const adminPayrollSource = readFileSync(
  resolve(import.meta.dirname, 'AdminPayrollPage.tsx'),
  'utf8',
);

describe('AdminPayrollPage review console shell', () => {
  it('keeps admin on final confirmation only after PM review state is visible', () => {
    expect(adminPayrollSource).toContain('PM 검토');
    expect(adminPayrollSource).toContain('후보 없음');
    expect(adminPayrollSource).toContain('최종 확정');
    expect(adminPayrollSource).toContain('PM이 원본 적요를 먼저 검토');
    expect(adminPayrollSource).toContain('지급일 ±3영업일');
    expect(adminPayrollSource).not.toContain('지급일 ±2일');
    expect(adminPayrollSource).not.toContain('LABOR_COST');
    expect(adminPayrollSource).not.toContain('finally(() => setTxDialogProjectId(null))');
  });
});
