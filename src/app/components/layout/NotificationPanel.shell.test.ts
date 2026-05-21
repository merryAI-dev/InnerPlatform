import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'NotificationPanel.tsx'), 'utf8');

describe('NotificationPanel LAB shell contract', () => {
  it('filters LAB-hidden notification links before rendering or navigating', () => {
    expect(source).toContain('useShellLabEnabled');
    expect(source).toContain('shouldShowShellRoute');
    expect(source).toContain('policyRoute');
    expect(source).toContain('visibleNotifications');
    expect(source).toContain('showApprovalTab');
    expect(source).toContain('w-[calc(100vw-1rem)]');
    expect(source).toContain('알림 센터 열기');
    expect(source).toContain("'admin', 'command'");
  });
});
