import { describe, expect, it } from 'vitest';
import {
  ROSTER_PUSH_REASON_LABELS,
  canTriggerRosterPush,
  formatRosterInstant,
  rosterPushReasonLabel,
} from './roster-push-helpers';

describe('rosterPushReasonLabel', () => {
  it('BFF 사유 코드 전부에 사람이 읽을 라벨이 있다', () => {
    // participation-roster-push.mjs 의 refusal reason 목록. 하나라도 빠지면
    // 화면이 영어 코드를 그대로 내보낸다.
    const reasons = [
      'permission_denied', 'format_mismatch', 'tenant_mismatch', 'roster_shrunk',
      'people_empty', 'invalid_link', 'not_found', 'request_rejected', 'api_error',
    ];
    for (const reason of reasons) {
      expect(ROSTER_PUSH_REASON_LABELS[reason], reason).toBeTruthy();
    }
  });

  it('모르는 코드는 코드를 드러내고, 빈 값은 알 수 없는 실패로 말한다', () => {
    expect(rosterPushReasonLabel('brand_new_reason')).toContain('brand_new_reason');
    expect(rosterPushReasonLabel(null)).toBe('알 수 없는 실패');
  });
});

describe('canTriggerRosterPush', () => {
  it('personWrite 역할(admin·tenant_admin·finance)만 실행할 수 있다', () => {
    expect(canTriggerRosterPush('admin')).toBe(true);
    expect(canTriggerRosterPush('tenant_admin')).toBe(true);
    expect(canTriggerRosterPush('finance')).toBe(true);
    expect(canTriggerRosterPush('pm')).toBe(false);
    expect(canTriggerRosterPush('viewer')).toBe(false);
    expect(canTriggerRosterPush(null)).toBe(false);
  });
});

describe('formatRosterInstant', () => {
  it('ISO 시각을 YYYY.MM.DD HH:mm 으로, 없는 값은 - 로', () => {
    expect(formatRosterInstant('2026-08-25T09:05:00.000Z')).toMatch(/^2026\.\d{2}\.\d{2} \d{2}:\d{2}$/);
    expect(formatRosterInstant(null)).toBe('-');
    expect(formatRosterInstant('not-a-date')).toBe('-');
  });
});
