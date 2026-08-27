import { describe, expect, it } from 'vitest';
import {
  buildCashflowWeeklyDigestMessage,
  decodeStoredName,
  formatDigestEntry,
  kstDayWindow,
  kstTimeLabel,
  selectCompletedInWindow,
} from './cashflow-weekly-digest.mjs';

describe('kstDayWindow', () => {
  it('KST 하루는 전날 15:00Z 에서 시작한다', () => {
    expect(kstDayWindow(new Date('2026-08-27T09:30:00.000Z'))).toEqual({
      date: '2026-08-27',
      startAt: '2026-08-26T15:00:00.000Z',
      endAt: '2026-08-27T15:00:00.000Z',
    });
  });

  it('23:59 KST 는 아직 같은 날이다', () => {
    expect(kstDayWindow(new Date('2026-08-27T14:59:00.000Z')).date).toBe('2026-08-27');
  });

  it('00:00 KST 는 다음 날로 넘어간다', () => {
    expect(kstDayWindow(new Date('2026-08-27T15:00:00.000Z')).date).toBe('2026-08-28');
  });
});

describe('kstTimeLabel', () => {
  it.each([
    ['2026-08-27T09:30:00.000Z', '18:30'],
    ['2026-08-27T14:59:00.000Z', '23:59'],
  ])('%s → %s', (at, expected) => {
    expect(kstTimeLabel(new Date(at))).toBe(expected);
  });
});

describe('selectCompletedInWindow', () => {
  const window = kstDayWindow(new Date('2026-08-27T14:59:00.000Z'));

  it('회수된 주차는 완료 목록에서 뺀다', () => {
    const selected = selectCompletedInWindow([
      { status: 'SUBMITTED', completedAt: '2026-08-27T02:27:00Z', projectId: 'a' },
      { status: 'OPEN', completedAt: '2026-08-27T03:00:00Z', projectId: 'b' },
    ], window);
    expect(selected.map((item) => item.projectId)).toEqual(['a']);
  });

  it('완료 순으로 정렬한다', () => {
    const selected = selectCompletedInWindow([
      { status: 'LOCKED', completedAt: '2026-08-27T07:55:00Z', projectId: 'late' },
      { status: 'SUBMITTED', completedAt: '2026-08-27T02:27:00Z', projectId: 'early' },
    ], window);
    expect(selected.map((item) => item.projectId)).toEqual(['early', 'late']);
  });

  it('어제 완료분과 내일 완료분은 들어오지 않는다', () => {
    const selected = selectCompletedInWindow([
      { status: 'SUBMITTED', completedAt: '2026-08-26T14:59:59Z', projectId: 'yesterday' },
      { status: 'SUBMITTED', completedAt: '2026-08-27T15:00:00Z', projectId: 'tomorrow' },
      { status: 'SUBMITTED', completedAt: '2026-08-27T02:27:00Z', projectId: 'today' },
    ], window);
    expect(selected.map((item) => item.projectId)).toEqual(['today']);
  });
});

describe('decodeStoredName', () => {
  it('라이브에 저장된 URL 인코딩 이름을 되돌린다', () => {
    expect(decodeStoredName('%EC%9E%A5%EC%9D%80%ED%9D%AC(%EB%82%98%EB%AC%B4)')).toBe('장은희(나무)');
  });

  it('이미 한글이면 그대로 둔다', () => {
    expect(decodeStoredName('조이수(수)')).toBe('조이수(수)');
  });

  it('깨진 인코딩은 원문을 그대로 돌려준다', () => {
    expect(decodeStoredName('100% 완료')).toBe('100% 완료');
  });
});

describe('formatDigestEntry', () => {
  it('슬랙 아이디가 있으면 멘션으로 건다', () => {
    expect(formatDigestEntry({
      projectName: '25현대모비스CSV',
      completedByName: '박지연(느티)',
      slackUserId: 'U0123456789',
    })).toBe('25현대모비스CSV(<@U0123456789>)');
  });

  it('슬랙 아이디가 없으면 이름으로 떨어진다', () => {
    expect(formatDigestEntry({
      projectName: '25현대모비스CSV',
      completedByName: '장은희(나무)',
      slackUserId: '',
    })).toBe('25현대모비스CSV(장은희(나무))');
  });

  it('슬랙 아이디 모양이 아니면 멘션하지 않는다', () => {
    expect(formatDigestEntry({
      projectName: '사업',
      completedByName: '고인효(베리)',
      slackUserId: 'berry@mysc.co.kr',
    })).toBe('사업(고인효(베리))');
  });

  it('이름도 슬랙 아이디도 없으면 미확인으로 둔다', () => {
    expect(formatDigestEntry({ projectName: '사업' })).toBe('사업(미확인)');
  });
});

describe('buildCashflowWeeklyDigestMessage', () => {
  it('완료 건이 없으면 보내지 않는다', () => {
    expect(buildCashflowWeeklyDigestMessage({ date: '2026-08-27', timeLabel: '18:30', entries: [] })).toBeNull();
  });

  it('사업(@담당자) 를 쉼표로 이어 붙인다', () => {
    const message = buildCashflowWeeklyDigestMessage({
      date: '2026-08-27',
      timeLabel: '18:30',
      entries: [
        { projectName: '25현대모비스CSV', completedByName: '박지연(느티)', slackUserId: 'U0123456789' },
        { projectName: 'KDB넥스트원 광주', completedByName: '장은희(나무)', slackUserId: '' },
      ],
    });
    expect(message.text).toBe('[MYSCube] 주정산 완료 현황 2026-08-27 18:30 기준 · 2건');
    expect(message.blocks[0].text.text).toBe(
      '*[MYSCube] 주정산 완료 현황*\n2026-08-27 18:30 기준 · 2건\n25현대모비스CSV(<@U0123456789>), KDB넥스트원 광주(장은희(나무))',
    );
  });
});
