import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'SettlementSheetPolicyFields.tsx'), 'utf8');

describe('SettlementSheetPolicyFields copy', () => {
  it('keeps the existing adjustment row copy until wording is approved', () => {
    expect(source).toContain('조정행 허용');
    expect(source).toContain('잔액 보정이 필요한 사업이면 켜고');
  });
});
