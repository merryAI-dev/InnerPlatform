import { describe, expect, it } from 'vitest';
import { pickCashflowMonthCloseNotice } from './cashflow-month-close-notice';

const base = {
  requestStatus: 'PENDING',
  requestedByUid: 'uid-kwon',
  requestedByName: '권혁준',
  approverName: '김조직',
  requestedAt: '2026-08-10T11:18:33.931Z',
  currentUid: 'uid-boram',
  canWithdraw: false,
  withdrawGuide: '본인이 요청한 검토 전 월 결산만 회수할 수 있습니다.',
  canRequestReopen: false,
  reopenGuide: '승인 완료된 월 결산만 재오픈을 요청할 수 있습니다.',
  requestGuide: '이미 진행 중인 월 결산 승인 요청이 있습니다.',
  todayIso: '2026-08-19T08:00:00.000Z',
};

describe('pickCashflowMonthCloseNotice', () => {
  it('pending + someone else requested: one attention line naming who, approver, and days', () => {
    expect(pickCashflowMonthCloseNotice(base)).toEqual({
      tone: 'attention',
      text: '권혁준 님이 요청한 월 결산이에요 · 김조직 님 승인 대기 · 8일째 대기. 회수는 요청한 사람만 할 수 있어요.',
    });
  });

  it('pending + I requested (or can withdraw): nothing, the button speaks', () => {
    expect(pickCashflowMonthCloseNotice({ ...base, canWithdraw: true })).toBeNull();
    expect(pickCashflowMonthCloseNotice({ ...base, currentUid: 'uid-kwon' })).toBeNull();
  });

  it('approved: reopen guide only when reopen is not possible', () => {
    expect(pickCashflowMonthCloseNotice({ ...base, requestStatus: 'APPROVED', canRequestReopen: true })).toBeNull();
    expect(pickCashflowMonthCloseNotice({ ...base, requestStatus: 'APPROVED', reopenGuide: '승인 완료된 최신 월 결산만 재오픈을 요청할 수 있습니다.' }))
      .toEqual({ tone: 'muted', text: '승인 완료된 최신 월 결산만 재오픈을 요청할 수 있습니다.' });
  });

  it('other states fall back to the request guide, muted', () => {
    expect(pickCashflowMonthCloseNotice({ ...base, requestStatus: null, requestGuide: '먼저 시트값을 불러와 주세요.' }))
      .toEqual({ tone: 'muted', text: '먼저 시트값을 불러와 주세요.' });
    expect(pickCashflowMonthCloseNotice({ ...base, requestStatus: 'REJECTED', requestGuide: '' })).toBeNull();
  });

  it('degrades gracefully without names or dates', () => {
    expect(pickCashflowMonthCloseNotice({ ...base, requestedByName: null, approverName: null, requestedAt: null })).toEqual({
      tone: 'attention',
      text: 'uid-kwon 님이 요청한 월 결산이에요. 회수는 요청한 사람만 할 수 있어요.',
    });
    expect(pickCashflowMonthCloseNotice({ ...base, requestedAt: base.todayIso })?.text).toContain('오늘 요청');
  });
});
