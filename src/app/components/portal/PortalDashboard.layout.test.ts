import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalDashboardSource = readFileSync(
  resolve(import.meta.dirname, 'PortalDashboard.tsx'),
  'utf8',
);

describe('PortalDashboard closure', () => {
  it('keeps the closed PM project status dashboard off the route without redirecting', () => {
    expect(portalDashboardSource).toContain('PortalProjectSelectPage');
    expect(portalDashboardSource).not.toContain('Navigate');
    expect(portalDashboardSource).not.toContain('프로젝트 상세');
    expect(portalDashboardSource).not.toContain('내 제출 현황');
    expect(portalDashboardSource).not.toContain('사업 상태');
  });
});
