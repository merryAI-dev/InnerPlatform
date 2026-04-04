import { describe, expect, it } from 'vitest';
import {
  buildQaFeedbackMemoryFromCsv,
  buildQaPhasePreflightReport,
} from './qa-feedback-memory';

const SAMPLE_CSV = `피드백,세부정보,유형,중요도,제출한 사람,제출한 날짜,상태,참고 이미지,프로젝트 유형
"사업비 입력에서 매입부가세 수정이 되지 않습니다.","저장 후 다시 원래 값으로 돌아옵니다.",기능 오류,높음,tester@mysc.co.kr,26/4/1 오전 9:00,검토중,,사업관리플랫폼
"캐시플로 월 저장 후 값이 사라집니다.","프로젝션 저장이 유지되지 않습니다.",기능 오류,높음,tester2@mysc.co.kr,26/4/1 오전 10:00,완료,,사업관리플랫폼
"회원가입 시 개인정보 동의 절차가 없습니다.","정책 검토가 필요합니다.",기능 오류,높음,legal@mysc.co.kr,26/4/2 오전 11:00,가버넌스(정책차원),,기업육성플랫폼
`;

describe('qa-feedback-memory', () => {
  it('normalizes tracker rows into memory entries and feature tags', () => {
    const memory = buildQaFeedbackMemoryFromCsv(SAMPLE_CSV, 'sample.csv');
    expect(memory.totalEntries).toBe(3);
    expect(memory.counts.byProjectType['사업관리플랫폼']).toBe(2);
    expect(memory.entries[0]?.featureTags).toContain('weekly_expense');
    expect(memory.entries[1]?.featureTags).toContain('cashflow');
    expect(memory.entries[2]?.featureTags).toContain('governance');
  });

  it('returns relevant matches for a phase query', () => {
    const memory = buildQaFeedbackMemoryFromCsv(SAMPLE_CSV, 'sample.csv');
    const report = buildQaPhasePreflightReport(
      memory,
      'PM 주간 사업비 입력과 매입부가세 저장 회귀를 먼저 본다',
      { projectType: '사업관리플랫폼', maxMatches: 5 },
    );

    expect(report.topMatches[0]?.entry.feedback).toContain('매입부가세');
    expect(report.topFeatureAreas.map((area) => area.tag)).toContain('weekly_expense');
  });

  it('falls back to important items when keyword overlap is absent', () => {
    const memory = buildQaFeedbackMemoryFromCsv(SAMPLE_CSV, 'sample.csv');
    const report = buildQaPhasePreflightReport(
      memory,
      '완전히 무관한 검색어',
      { projectType: '기업육성플랫폼', maxMatches: 3 },
    );

    expect(report.topMatches[0]?.reasons[0]).toContain('fallback');
    expect(report.topMatches[0]?.entry.projectType).toBe('기업육성플랫폼');
  });
});
