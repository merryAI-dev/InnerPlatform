import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'WorkspaceSelectPage.tsx'), 'utf8');

describe('WorkspaceSelectPage shell contract', () => {
  it('shows the post-login workspace choice as brand-neutral admin and PM entry maps', () => {
    expect(source).toContain('MyscWordmark');
    expect(source).toContain('ADMIN_WORKSPACE_FEATURES');
    expect(source).toContain('PM_WORKSPACE_FEATURES');
    expect(source).toContain('어느 공간에서 시작할까요?');
    expect(source).toContain('bg-[#001e46]');
    expect(source).toContain('border-slate-200 bg-white');
    expect(source).toContain('mx-auto w-full max-w-6xl');
    expect(source).not.toContain('border-emerald-200');
    expect(source).not.toContain('backdrop-blur-2xl');
    expect(source).toContain('관리자 공간으로 계속');
    expect(source).toContain('PM 포털로 계속');
    expect(source).not.toContain('CardContent');
  });
});
