import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalDashboardSource = readFileSync(
  resolve(import.meta.dirname, 'PortalDashboard.tsx'),
  'utf8',
);

describe('PortalDashboard layout compaction', () => {
  it('replaces generic alert rails with current-week accounting status copy', () => {
    expect(portalDashboardSource).toContain('이번 주 정산 상태');
    expect(portalDashboardSource).toContain('최근 Projection 수정');
    expect(portalDashboardSource).not.toContain('운영 알림');
  });

  it('drops the separate operating shortcuts card to keep the page compact', () => {
    expect(portalDashboardSource).not.toContain('운영 바로가기');
  });
});
