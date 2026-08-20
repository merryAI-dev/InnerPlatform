import { describe, expect, it } from 'vitest';
import { buildScheduleSteps, formatDeadlineLabel } from './cashflow-schedule-steps';

// 2026-08-20 은 목요일. 주정산 실무자 마감 = 목 자정 = 금 0시 KST = 2026-08-20T15:00Z.
// 조직장 마감 = 금 13:00 KST = 2026-08-21T04:00Z.
const PRACTITIONER = '2026-08-20T15:00:00.000Z';
const APPROVER = '2026-08-21T04:00:00.000Z';
const base = {
  practitionerLabel: '완료 요청',
  approverLabel: '조직장 확정',
  practitionerDeadline: PRACTITIONER,
  approverDeadline: APPROVER,
  practitionerDoneAt: null,
  approverDoneAt: null,
};

describe('formatDeadlineLabel', () => {
  it('calls a midnight deadline by the day it actually ends', () => {
    // 금 0시 마감은 사람에겐 "목요일 자정" 이다.
    expect(formatDeadlineLabel(PRACTITIONER, '2026-08-20T01:00:00Z')).toBe('오늘 자정까지');
    expect(formatDeadlineLabel(PRACTITIONER, '2026-08-19T01:00:00Z')).toBe('내일까지 · 8/20(목) 자정');
    expect(formatDeadlineLabel(PRACTITIONER, '2026-08-17T01:00:00Z')).toBe('8/20(목) 자정까지 · D-3');
    expect(formatDeadlineLabel(PRACTITIONER, '2026-08-21T01:00:00Z')).toBe('8/20(목) 자정 지남');
  });

  it('keeps a wall-clock deadline as it is', () => {
    expect(formatDeadlineLabel(APPROVER, '2026-08-21T01:00:00Z')).toBe('오늘 13:00까지');
    expect(formatDeadlineLabel(APPROVER, '2026-08-20T01:00:00Z')).toBe('내일까지 · 8/21(금) 13:00');
  });

  it('says nothing when it has nothing to say', () => {
    expect(formatDeadlineLabel(null, '2026-08-20T01:00:00Z')).toBe('');
    expect(formatDeadlineLabel('nope', '2026-08-20T01:00:00Z')).toBe('');
  });
});

describe('buildScheduleSteps', () => {
  it('before the deadline: practitioner is current, approver waits', () => {
    const [practitioner, approver] = buildScheduleSteps({ ...base, nowIso: '2026-08-19T02:00:00Z' });
    expect(practitioner).toMatchObject({ state: 'current', detail: '내일까지 · 8/20(목) 자정' });
    expect(approver.state).toBe('upcoming');
  });

  it('past the practitioner deadline with nothing done: that step turns red', () => {
    const [practitioner, approver] = buildScheduleSteps({ ...base, nowIso: '2026-08-21T02:00:00Z' });
    expect(practitioner.state).toBe('overdue');
    // 실무자가 아직인데 조직장 단계를 재촉하지 않는다.
    expect(approver.state).toBe('upcoming');
  });

  it('done on time: completion is kept as completion', () => {
    const [practitioner, approver] = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-19T05:20:00Z', nowIso: '2026-08-20T02:00:00Z',
    });
    expect(practitioner).toMatchObject({ state: 'done', detail: '8/19(수) 14:20' });
    expect(approver).toMatchObject({ state: 'current', detail: '내일까지 · 8/21(금) 13:00' });
  });

  it('done late: still done, with the overrun as a note — not a red step', () => {
    const [practitioner] = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-20T17:10:00Z', practitionerLate: true, nowIso: '2026-08-21T02:00:00Z',
    });
    expect(practitioner.state).toBe('done_late');
    expect(practitioner.detail).toBe('8/21(금) 02:10 · 기한 초과');
  });

  it('approver past deadline is shown, and is judged by when they approved', () => {
    const late = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-19T05:20:00Z', approverDoneAt: '2026-08-21T06:00:00Z', nowIso: '2026-08-22T02:00:00Z',
    })[1];
    expect(late.state).toBe('done_late');
    const onTime = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-19T05:20:00Z', approverDoneAt: '2026-08-21T03:00:00Z', nowIso: '2026-08-22T02:00:00Z',
    })[1];
    expect(onTime.state).toBe('done');
  });

  it('practitioner done but approver window blown: approver turns red, practitioner stays done', () => {
    const [practitioner, approver] = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-19T05:20:00Z', nowIso: '2026-08-21T06:00:00Z',
    });
    expect(practitioner.state).toBe('done');
    expect(approver.state).toBe('overdue');
  });

  it('works for the month cycle too — same shape, different labels', () => {
    const [practitioner, approver] = buildScheduleSteps({
      practitionerLabel: '결산 요청',
      approverLabel: '조직장 승인',
      practitionerDeadline: '2026-09-10T15:00:00.000Z',
      approverDeadline: '2026-09-13T15:00:00.000Z',
      practitionerDoneAt: null,
      approverDoneAt: null,
      nowIso: '2026-09-08T02:00:00Z',
    });
    expect(practitioner).toMatchObject({ label: '결산 요청', state: 'current', detail: '9/10(목) 자정까지 · D-2' });
    expect(approver).toMatchObject({ label: '조직장 승인', state: 'upcoming' });
  });
});

describe('approver step without a timestamp', () => {
  it('says 완료 instead of inventing a time, and does not guess lateness', () => {
    // 주정산 확정은 응답에 시각이 없다 - 확정됐다는 사실만 안다.
    const [, approver] = buildScheduleSteps({
      ...base, practitionerDoneAt: '2026-08-19T05:20:00Z', approverDone: true, nowIso: '2026-08-25T02:00:00Z',
    });
    expect(approver).toMatchObject({ state: 'done', detail: '완료' });
  });
});
