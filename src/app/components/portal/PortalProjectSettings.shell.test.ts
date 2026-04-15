import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalProjectSettingsSource = readFileSync(
  resolve(import.meta.dirname, 'PortalProjectSettings.tsx'),
  'utf8',
);

describe('PortalProjectSettings shell contract', () => {
  it('keeps only assignment and primary-project editing while preserving save navigation', () => {
    expect(portalProjectSettingsSource).toContain('선택한 사업 중 주사업만 저장하세요.');
    expect(portalProjectSettingsSource).toContain('주사업 저장');
    expect(portalProjectSettingsSource).toContain("navigate('/portal', { replace: true });");
    expect(portalProjectSettingsSource).toContain('선택한 사업만 보기');
    expect(portalProjectSettingsSource).toContain('주사업으로 지정');
    expect(portalProjectSettingsSource).toContain('사업명, 클라이언트, 담당자로 검색');
    expect(portalProjectSettingsSource).not.toContain('사업명, 클라이언트, 유형, 담당자로 검색');
    expect(portalProjectSettingsSource).not.toContain('최근 사용한 사업');
    expect(portalProjectSettingsSource).not.toContain('증빙 드라이브 연결');
    expect(portalProjectSettingsSource).not.toContain('기본 폴더 자동 생성');
    expect(portalProjectSettingsSource).not.toContain('Google Drive 폴더 링크');
    expect(portalProjectSettingsSource).not.toContain('readRecentPortalProjectIds');
    expect(portalProjectSettingsSource).not.toContain('linkProjectEvidenceDriveRootViaBff');
    expect(portalProjectSettingsSource).not.toContain('provisionProjectEvidenceDriveRootViaBff');
    expect(portalProjectSettingsSource).not.toContain('PlatformApiError');
    expect(portalProjectSettingsSource).not.toContain('resolvePortalHappyPath');
    expect(portalProjectSettingsSource).not.toContain('isValidDriveUrl');
    expect(portalProjectSettingsSource).not.toContain('toast.');
  });
});
