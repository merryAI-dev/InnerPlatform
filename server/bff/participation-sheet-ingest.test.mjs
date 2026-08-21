import { describe, expect, it } from 'vitest';
import {
  analyzeParticipationSheet,
  buildPeopleLinkCandidates,
  buildStintEntries,
  PARTICIPATION_FORMAT_ID,
  parseParticipationSheet,
  personKeyOf,
  resolvePeopleIdentity,
  validateParticipationFormat,
  validatePeriodAgainstProject,
  validateStintRows,
} from './participation-sheet-ingest.mjs';

const PEOPLE = [
  { personId: 'p-kim', name: '김정태', nickname: '에이블' },
  { personId: 'p-yu', name: '유자인', nickname: '유자' },
  { personId: 'p-a', name: '이지현A', nickname: '리사' },
];

/** 2026-01~2026-03 짜리 최소 시트. 필요한 것만 바꿔 쓴다. */
function sheet(overrides = {}) {
  return {
    formatCellValue: PARTICIPATION_FORMAT_ID,
    periodValues: { start: '2026-01', end: '2026-03' },
    headerValues: ['2026-01', '2026-02', '2026-03', '', ''],
    metaValues: [['에이블', '김정태', '총괄책임자', '2026-01', '', '30']],
    cellValues: [['30', '30', '30']],
    ...overrides,
  };
}

describe('셀 3상태', () => {
  it('빈칸은 값이 아니라 상태다 - 키 자체를 만들지 않는다', () => {
    const parsed = parseParticipationSheet(sheet({ cellValues: [['30', '', '30']] }));
    expect(Object.keys(parsed.rows[0].monthlyRates)).toEqual(['2026-01', '2026-03']);
  });

  it('0 은 확인된 미참여이므로 그대로 남는다', () => {
    const parsed = parseParticipationSheet(sheet({ cellValues: [['30', '0', '30']] }));
    expect(parsed.rows[0].monthlyRates['2026-02']).toBe(0);
  });

  it('0 과 빈칸을 같은 것으로 다루지 않는다', () => {
    const zero = parseParticipationSheet(sheet({ cellValues: [['0', '0', '0']] }));
    const blank = parseParticipationSheet(sheet({ cellValues: [['', '', '']] }));
    expect(Object.keys(zero.rows[0].monthlyRates)).toHaveLength(3);
    expect(Object.keys(blank.rows[0].monthlyRates)).toHaveLength(0);
  });

  it('0~100 밖이거나 숫자가 아니면 그 칸만 오류로 보고한다', () => {
    const parsed = parseParticipationSheet(sheet({ cellValues: [['30', '120', '메모']] }));
    expect(parsed.issues.map((entry) => entry.code)).toEqual([
      'participation_rate_invalid', 'participation_rate_invalid',
    ]);
    expect(parsed.rows[0].monthlyRates).toEqual({ '2026-01': 30 });
  });

  it('빈 여유 줄은 행으로 세지 않는다', () => {
    const parsed = parseParticipationSheet(sheet({
      metaValues: [['에이블', '김정태', '총괄책임자', '2026-01', '', '30'], ['', '', '', '', '', '']],
      cellValues: [['30', '30', '30'], ['', '', '']],
    }));
    expect(parsed.rows).toHaveLength(1);
  });
});

describe('월 머리글', () => {
  it('기간 밖 열(빈 머리글)에서 멈춘다', () => {
    expect(parseParticipationSheet(sheet()).months).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('1행 연도 표시는 읽지 않는다 - 파서 입력에 아예 없다', () => {
    const source = parseParticipationSheet.toString();
    expect(source).not.toContain('yearRow');
  });
});

describe('양식 검증 - 어긋나면 적응하지 않고 거부한다', () => {
  it('식별자가 다르면 나머지 검사를 하지 않는다', () => {
    const parsed = parseParticipationSheet(sheet({ formatCellValue: 'OTHER-V9' }));
    const issues = validateParticipationFormat(parsed);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('participation_format_mismatch');
  });

  it('기간이 비었거나 뒤집혔으면 거부한다', () => {
    const flipped = parseParticipationSheet(sheet({ periodValues: { start: '2026-03', end: '2026-01' } }));
    expect(validateParticipationFormat(flipped)[0].code).toBe('participation_period_invalid');
  });

  it('머리글이 끊기면 거부한다 - 열을 넣고 지운 흔적이다', () => {
    const gap = parseParticipationSheet(sheet({
      headerValues: ['2026-01', '2026-03', '2026-04'],
      periodValues: { start: '2026-01', end: '2026-04' },
    }));
    expect(validateParticipationFormat(gap)[0].code).toBe('participation_header_gap');
  });

  it('머리글 끝이 종료월과 다르면 거부한다', () => {
    const short = parseParticipationSheet(sheet({ headerValues: ['2026-01', '2026-02'] }));
    expect(validateParticipationFormat(short)[0].code).toBe('participation_header_gap');
  });
});

describe('계약 기간 대조 - 기간 변경의 순서를 강제한다', () => {
  const project = { contractStart: '2026-01-01', contractEnd: '2026-03-31' };

  it('같으면 통과한다', () => {
    expect(validatePeriodAgainstProject({ period: { start: '2026-01', end: '2026-03' }, project })).toBeNull();
  });

  it('시트가 먼저 연장돼 있으면 거부하고 양쪽 기간을 알려준다', () => {
    const result = validatePeriodAgainstProject({ period: { start: '2026-01', end: '2026-06' }, project });
    expect(result.code).toBe('participation_period_mismatch');
    expect(result.message).toContain('2026-01~2026-06');
    expect(result.message).toContain('2026-01~2026-03');
  });

  it('사업에 계약 기간이 없으면 그것부터 알린다', () => {
    const result = validatePeriodAgainstProject({ period: { start: '2026-01', end: '2026-03' }, project: {} });
    expect(result.code).toBe('participation_project_period_missing');
  });
});

describe('신원 해석 - 못 찾는 것은 오류가 아니다', () => {
  const resolve = (rows) => resolvePeopleIdentity({ rows, people: PEOPLE });

  it('닉네임과 이름이 같은 사람을 가리키면 잇는다', () => {
    expect(resolve([{ nickname: '에이블', name: '김정태' }])[0]).toMatchObject({
      personId: 'p-kim', linkState: 'LINKED',
    });
  });

  it('둘 다 적혔는데 엇갈리면 잇지 않는다 - People 에 없는 동명이인일 수 있다', () => {
    expect(resolve([{ nickname: '에이블', name: '유자인' }])[0]).toMatchObject({
      personId: '', linkState: 'PENDING_LINK',
    });
  });

  it('한쪽만 적혔으면 모순될 신호가 없으므로 그 한쪽으로 잇는다', () => {
    expect(resolve([{ nickname: '유자', name: '' }])[0].personId).toBe('p-yu');
    expect(resolve([{ nickname: '', name: '이지현A' }])[0].personId).toBe('p-a');
  });

  it('People 에 없으면 연결 대기다 - 막지 않는다', () => {
    expect(resolve([{ nickname: '테일러', name: '김혜령' }])[0].linkState).toBe('PENDING_LINK');
  });

  it('이름 없는 미정N 은 사람 미정 자리다', () => {
    expect(resolve([{ nickname: '미정1', name: '' }])[0].linkState).toBe('PLACEHOLDER');
    expect(resolve([{ nickname: '채용예정-1', name: '' }])[0].linkState).toBe('PLACEHOLDER');
  });

  // 시트가 플랫폼보다 먼저 만들어지고 매번 갱신되지도 않는다. 닉네임은 미정인 채로
  // 이름만 채워지는 일이 정상이므로, 이름이 붙으면 그때부터 실제 사람으로 다룬다.
  it('미정N 에 이름이 붙으면 실제 사람으로 승격한다', () => {
    expect(resolve([{ nickname: '미정1', name: '김정태' }])[0]).toMatchObject({
      personId: 'p-kim', linkState: 'LINKED',
    });
  });

  it('미정N 에 People 에 없는 이름이 붙으면 연결 대기다 - 막지 않는다', () => {
    expect(resolve([{ nickname: '미정2', name: '김혜령' }])[0]).toMatchObject({
      personId: '', linkState: 'PENDING_LINK',
    });
  });

  it('미정N 이름은 닉네임과 대조하지 않는다 - 닉네임 칸은 아직 자리표시자다', () => {
    // 일반 행이면 닉네임(에이블)과 이름(유자인)이 엇갈려 연결되지 않는 조합.
    expect(resolve([{ nickname: '미정1', name: '유자인' }])[0].personId).toBe('p-yu');
  });
});

describe('행 규칙 - 오류와 미입력을 나눈다', () => {
  const months = ['2026-01', '2026-02', '2026-03'];

  it('투입기간 안의 빈칸은 막지 않고 미입력으로 보고한다', () => {
    const result = validateStintRows({
      rows: [{ rowIndex: 0, nickname: '에이블', name: '', stintStart: '2026-01', stintEnd: '', monthlyRates: { '2026-01': 30 } }],
      months,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.missing.map((entry) => entry.month)).toEqual(['2026-02', '2026-03']);
  });

  it('투입기간 밖의 값은 오류다 - 기간을 바꾼 뒤 남은 고아 값이다', () => {
    const result = validateStintRows({
      rows: [{ rowIndex: 0, nickname: '에이블', name: '', stintStart: '2026-02', stintEnd: '2026-02', monthlyRates: { '2026-01': 30, '2026-02': 30 } }],
      months,
    });
    expect(result.errors[0]).toMatchObject({ code: 'participation_value_outside_stint', month: '2026-01' });
  });

  it('값은 있는데 투입시작월이 없으면 오류다', () => {
    const result = validateStintRows({
      rows: [{ rowIndex: 0, nickname: '에이블', name: '', stintStart: '', stintEnd: '', monthlyRates: { '2026-01': 30 } }],
      months,
    });
    expect(result.errors[0].code).toBe('participation_stint_start_required');
  });

  it('시작월이 종료월보다 뒤면 오류다', () => {
    const result = validateStintRows({
      rows: [{ rowIndex: 0, nickname: '에이블', name: '', stintStart: '2026-03', stintEnd: '2026-01', monthlyRates: {} }],
      months,
    });
    expect(result.errors[0].code).toBe('participation_stint_order');
  });

  it('같은 사람이 두 줄에서 같은 달에 값을 가지면 오류다', () => {
    const result = validateStintRows({
      rows: [
        { rowIndex: 0, nickname: '에이블', name: '', stintStart: '2026-01', stintEnd: '2026-02', monthlyRates: { '2026-02': 30 } },
        { rowIndex: 1, nickname: '에이블', name: '', stintStart: '2026-02', stintEnd: '', monthlyRates: { '2026-02': 40 } },
      ],
      months,
    });
    expect(result.errors[0].code).toBe('participation_duplicate_month');
  });

  it('같은 사람으로 연결됐으면 어떻게 적혔든 중복을 잡는다', () => {
    const result = validateStintRows({
      rows: [
        { rowIndex: 0, nickname: '미정1', name: '김정태', personId: 'p-kim', stintStart: '2026-01', stintEnd: '2026-02', monthlyRates: { '2026-02': 30 } },
        { rowIndex: 1, nickname: '에이블', name: '김정태', personId: 'p-kim', stintStart: '2026-02', stintEnd: '', monthlyRates: { '2026-02': 40 } },
      ],
      months,
    });
    expect(result.errors[0].code).toBe('participation_duplicate_month');
  });

  it('교체는 오류가 아니다 - 달이 겹치지 않으면 통과한다', () => {
    const result = validateStintRows({
      rows: [
        { rowIndex: 0, nickname: '에이블', name: '', stintStart: '2026-01', stintEnd: '2026-01', monthlyRates: { '2026-01': 30 } },
        { rowIndex: 1, nickname: '유자', name: '', stintStart: '2026-02', stintEnd: '', monthlyRates: { '2026-02': 30, '2026-03': 30 } },
      ],
      months,
    });
    expect(result.errors).toHaveLength(0);
  });
});

describe('참여행 생성 - 재실행이 안전해야 한다', () => {
  it('행 정체성은 사람과 투입시작월이라 같은 시트를 두 번 읽어도 같은 문서다', () => {
    const rows = [{ rowIndex: 0, nickname: '에이블', name: '김정태', role: '총괄', stintStart: '2026-01', stintEnd: '', monthlyRates: { '2026-01': 30 }, personId: 'p-kim', linkState: 'LINKED' }];
    const first = buildStintEntries({ tenantId: 'mysc', projectId: 'p1', rows });
    const second = buildStintEntries({ tenantId: 'mysc', projectId: 'p1', rows });
    expect(first[0].id).toBe('pts-p1-에이블-2026-01');
    expect(second[0].id).toBe(first[0].id);
  });

  it('같은 사람의 재투입은 시작월이 달라 다른 줄로 남는다', () => {
    const entries = buildStintEntries({
      projectId: 'p1',
      rows: [
        { nickname: '에이블', name: '', stintStart: '2026-01', stintEnd: '2026-01', monthlyRates: {}, linkState: 'LINKED' },
        { nickname: '에이블', name: '', stintStart: '2026-03', stintEnd: '', monthlyRates: {}, linkState: 'LINKED' },
      ],
    });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('연결 대기 행도 참여행을 만든다 - personId 만 비운다', () => {
    const entries = buildStintEntries({
      projectId: 'p1',
      rows: [{ nickname: '테일러', name: '김혜령', stintStart: '2026-01', stintEnd: '', monthlyRates: {}, personId: '', linkState: 'PENDING_LINK' }],
    });
    expect(entries[0].personId).toBeUndefined();
    expect(entries[0].identity).toEqual({ nickname: '테일러', name: '김혜령' });
  });

  it('이름 없는 미정 자리는 참여행을 만들지 않는다', () => {
    const entries = buildStintEntries({
      projectId: 'p1',
      rows: [{ nickname: '미정1', name: '', stintStart: '2026-01', stintEnd: '', monthlyRates: {}, linkState: 'PLACEHOLDER' }],
    });
    expect(entries).toHaveLength(0);
  });

  it('미정N 의 참여행은 이름으로 묶는다 - 미정1 로 묶으면 서로 다른 사람이 합쳐진다', () => {
    const entries = buildStintEntries({
      projectId: 'p1',
      rows: [
        { nickname: '미정1', name: '김정태', stintStart: '2026-01', stintEnd: '', monthlyRates: {}, linkState: 'LINKED' },
        { nickname: '미정2', name: '유자인', stintStart: '2026-01', stintEnd: '', monthlyRates: {}, linkState: 'LINKED' },
      ],
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      'pts-p1-김정태-2026-01', 'pts-p1-유자인-2026-01',
    ]);
  });

  it('사람 키는 백필과 같은 정규화를 쓴다', () => {
    expect(personKeyOf(' 에이블 ')).toBe('에이블');
    expect(personKeyOf('Lisa A')).toBe('lisa-a');
  });
});

// 사전 등록을 놓치는 일은 늘 생긴다. 그때 이름이 어디에도 모이지 않으면 영영 연결되지 않는다.
describe('People 등록 후보 - 사전 등록을 놓쳤을 때의 되돌아올 길', () => {
  const candidatesOf = (rows) => buildPeopleLinkCandidates({ rows });

  it('연결 대기만 후보로 올린다', () => {
    const result = candidatesOf([
      { rowIndex: 0, nickname: '에이블', name: '김정태', linkState: 'LINKED', monthlyRates: {} },
      { rowIndex: 1, nickname: '테일러', name: '김혜령', linkState: 'PENDING_LINK', monthlyRates: { '2026-01': 30 } },
      { rowIndex: 2, nickname: '미정1', name: '', linkState: 'PLACEHOLDER', monthlyRates: {} },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: '김혜령', nickname: '테일러', monthCount: 1 });
  });

  it('같은 사람이 여러 줄이면 한 후보로 묶고 줄 번호를 모은다', () => {
    const result = candidatesOf([
      { rowIndex: 1, nickname: '테일러', name: '김혜령', linkState: 'PENDING_LINK', monthlyRates: { '2026-01': 30 } },
      { rowIndex: 4, nickname: '테일러', name: '김혜령', linkState: 'PENDING_LINK', monthlyRates: { '2026-05': 30 } },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].rowIndexes).toEqual([1, 4]);
    expect(result[0].monthCount).toBe(2);
  });

  it('미정N 에 이름만 있는 사람도 후보가 된다 - 이것이 fallback 의 핵심이다', () => {
    const result = candidatesOf([
      { rowIndex: 0, nickname: '미정2', name: '강에나', linkState: 'PENDING_LINK', monthlyRates: {} },
    ]);
    expect(result[0]).toMatchObject({ name: '강에나', nickname: '' });
  });

  // People 은 사람이 등록한다. 시트 오타로 유령 인물이 생기면 되돌리기 어렵다.
  it('후보를 돌려줄 뿐 입력을 건드리지 않는다', () => {
    const rows = [{ rowIndex: 0, nickname: '테일러', name: '김혜령', linkState: 'PENDING_LINK', monthlyRates: { '2026-01': 30 } }];
    const snapshot = JSON.parse(JSON.stringify(rows));
    const first = buildPeopleLinkCandidates({ rows });
    const second = buildPeopleLinkCandidates({ rows });
    expect(rows).toEqual(snapshot);
    expect(second).toEqual(first);
    expect(first[0].personId).toBeUndefined();
  });
});

describe('전체 분석', () => {
  const project = { name: 'JLIN IBS', contractStart: '2026-01-01', contractEnd: '2026-03-31' };

  it('정상 시트는 통과하고 요약을 준다', () => {
    const result = analyzeParticipationSheet({ sheet: sheet({ cellValues: [['30', '30', '30']] }), project, people: PEOPLE, projectId: 'p1' });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ rowCount: 1, linkedCount: 1, missingCount: 0, errorCount: 0 });
    expect(result.entries).toHaveLength(1);
  });

  it('양식이 다르면 행을 읽기 전에 멈춘다 - 엉뚱한 달에 값이 들어가는 것이 가장 위험하다', () => {
    const result = analyzeParticipationSheet({ sheet: sheet({ formatCellValue: 'OTHER' }), project, people: PEOPLE });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.blocking[0].code).toBe('participation_format_mismatch');
  });

  it('미입력이 있어도 막지 않고 목록으로 보고한다', () => {
    const result = analyzeParticipationSheet({ sheet: sheet({ cellValues: [['30', '', '']] }), project, people: PEOPLE, projectId: 'p1' });
    expect(result.ok).toBe(true);
    expect(result.summary.missingCount).toBe(2);
  });

  it('연결 대기는 통과시키되 세어 준다', () => {
    const result = analyzeParticipationSheet({
      sheet: sheet({ metaValues: [['테일러', '김혜령', '연구', '2026-01', '', '30']] }),
      project, people: PEOPLE, projectId: 'p1',
    });
    expect(result.ok).toBe(true);
    expect(result.summary.pendingLinkCount).toBe(1);
    expect(result.summary.candidateCount).toBe(1);
    expect(result.candidates[0]).toMatchObject({ name: '김혜령', nickname: '테일러' });
  });
});
