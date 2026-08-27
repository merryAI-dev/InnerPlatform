import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 실무자 포털 마이페이지 계약.
 *
 * 인력 명부(persons)가 단일 진실이고, 대상은 경로가 아니라 로그인 계정의 uid 로 정해진다.
 * 본인이 고칠 수 있는 것과 회사가 관리하는 것의 경계가 이 파일에서 드러나야 한다.
 */

const source = readFileSync(new URL('./CareerProfilePage.tsx', import.meta.url), 'utf8');

describe('마이페이지', () => {
  it('명부를 읽고, 죽은 careerProfiles 컬렉션으로 되돌아가지 않는다', () => {
    expect(source).toContain('useMyHrProfile');
    expect(source).not.toContain('career-profile-store');
    expect(source).not.toContain('useCareerProfile');
  });

  it('본인이 고치는 값과 회사가 관리하는 값을 가른다', () => {
    // 열린 것: 증빙이 필요 없는 값만.
    expect(source).toContain('updateMyPersonProfileViaBff');
    expect(source).toContain('nickname: form.nickname.trim()');
    expect(source).toContain('workLocation: form.workLocation.trim()');
    // 닫힌 것: 소속·직급·직책·입사일은 입력칸을 두지 않는다.
    expect(source).not.toContain("aria-label=\"직급\"");
    expect(source).not.toContain("aria-label=\"소속\"");
    expect(source).not.toContain("aria-label=\"입사일\"");
    expect(source).toContain('소속·직급·직책·입사일은 회사가 관리합니다');
  });

  it('학력·어학·자격은 증빙과 함께 본인이 직접 넣는다', () => {
    expect(source).toContain('<ProfessionalProfileEditor');
    expect(source).toContain('증빙자료가 제출된 건에 한하여 인정됩니다');
    // 명부에 연결되지 않은 계정에는 입력 버튼을 주지 않는다.
    expect(source).toContain('hr?.linked && authUser');
  });

  it('저장하면 화면을 다시 불러온다 — 옛 값이 남으면 본인이 다시 고친다', () => {
    expect(source).toContain('reload()');
  });
});
