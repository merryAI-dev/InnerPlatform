import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalDashboardSource = readFileSync(
  resolve(import.meta.dirname, 'PortalDashboard.tsx'),
  'utf8',
);

describe('PortalDashboard closure', () => {
  it('redirects the closed PM project status dashboard to project selection', () => {
    expect(portalDashboardSource).toContain('Navigate');
    expect(portalDashboardSource).toContain('to="/portal/project-select"');
    expect(portalDashboardSource).not.toContain('프로젝트 상세');
    expect(portalDashboardSource).not.toContain('내 제출 현황');
    expect(portalDashboardSource).not.toContain('사업 상태');
  });
});
