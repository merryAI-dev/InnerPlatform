import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PeopleDirectoryPage.tsx'), 'utf8');

/**
 * 근로형태는 이름 옆에 붙으면 신분 표시가 된다. 명부 목록에서는 가리고, 계약을 바꾸는
 * 자리에서만 보여준다. 인턴은 같은 표에 섞지 않는다 - 근로형태 열을 지워도 한 표에
 * 두면 순서와 빈칸으로 드러난다.
 */
describe('PeopleDirectoryPage 근로형태 노출 계약', () => {
  it('목록 표에 근로형태 열이 없다', () => {
    const table = source.slice(source.indexOf('function PeopleTable'), source.indexOf('export function PeopleDirectoryPage'));
    expect(table).not.toContain('근로형태');
    expect(table).not.toContain('TYPE_TONE');
    expect(table).not.toContain('EMPLOYMENT_TYPE_LABELS');
  });

  it('근로형태별 필터 버튼이 없다 — 누르는 것만으로 누가 어느 형태인지 드러난다', () => {
    expect(source).not.toContain("['FULL_TIME', `정규직");
    expect(source).not.toContain("['INTERN', `인턴");
    expect(source).not.toContain("['PARTNER', `파트너");
    expect(source).not.toContain("['PLACEHOLDER', `미채용");
  });

  it('인턴은 별도 표로 뗀다', () => {
    expect(source).toContain("row.current?.type !== 'INTERN'");
    expect(source).toContain("row.current?.type === 'INTERN'");
    expect(source).toContain('const mainRows');
    expect(source).toContain('const internRows');
    // 두 표가 같은 컴포넌트를 쓴다 - 한쪽만 조용히 달라지지 않게.
    expect(source.match(/<PeopleTable/g)).toHaveLength(2);
  });

  it('계약 관리에서는 근로형태를 그대로 보여준다 — 바꾸려면 보여야 한다', () => {
    const dialog = source.slice(source.indexOf('계약 이력'));
    expect(dialog).toContain('EMPLOYMENT_TYPE_LABELS');
  });

  it('목록에는 이름·재직상태·소속·직급·입사일·근속만 둔다', () => {
    const table = source.slice(source.indexOf('function PeopleTable'), source.indexOf('export function PeopleDirectoryPage'));
    ['이름', '재직상태', '소속', '직급', '입사일', '근속'].forEach((column) => {
      expect(table).toContain(`>${column}</TableHead>`);
    });
  });
});
