import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ParticipationPage.tsx'), 'utf8');

describe('ParticipationPage shell contract', () => {
  it('uses the current project-team rollup helper for every admin participation view', () => {
    expect(source).toContain('buildAllProjectTeamParticipationEntries(projects, participationEntries, personDirectory)');
    expect(source).toContain('displayParticipationEntries');
    expect(source).toContain('formalParticipationEntries');
    expect(source).toContain('buildParticipationRiskReport(formalParticipationEntries)');
    expect(source).toContain('formalMember={selectedMember ? formalSummaryMap.get(selectedMember.memberId) || null : null}');
    expect(source).toContain('formalRiskDetails');
  });

  it('shows Salesforce-style origin lanes before list tables', () => {
    expect(source).toContain('Participation Object');
    expect(source).toContain('classificationLanes.map');
    expect(source).toContain("label: 'e나라도움'");
    expect(source).toContain("label: 'KOICA'");
    expect(source).toContain('원천 구분');
    expect(source).toContain('동일 기관 확인');
  });

  it('marks row provenance when formal and project-team rows are mixed', () => {
    expect(source).toContain('participationSourceLabel');
    expect(source).toContain('프로젝트 팀 연동');
    expect(source).toContain('공식 참여율');
  });

  it('keeps participation terminology consistent on the admin rollup surface', () => {
    expect(source).toContain('전체 참여율');
    expect(source).not.toContain('투입율');
    expect(source).not.toContain('투입률');
  });

  it('keeps the monthly document-rate matrix read-only for administrators', () => {
    expect(source).toContain('월별 서류 참여율');
    expect(source).toContain('관리자 조회 전용');
    expect(source).toContain('getMonthlyParticipationRate(entry, yearMonth)');
    expect(source).toContain('MonthlyDocumentRateMatrix entries={displayParticipationEntries}');
    expect(source).toContain('const rows = entries;');
    expect(source).not.toContain('시트 원본을 불러오면');
    expect(source).not.toContain('월별 실제 참여율');
  });
});
