import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(
  resolve(import.meta.dirname, 'portal-store.tsx'),
  'utf8',
);

const typesSource = readFileSync(
  resolve(import.meta.dirname, 'types.ts'),
  'utf8',
);
const projectStatusLabelsSource = typesSource.slice(
  typesSource.indexOf('export const PROJECT_STATUS_LABELS'),
  typesSource.indexOf('export function normalizeProjectStatus'),
);

describe('portal project status editing contract', () => {
  it('exposes a portal action that writes the project status field directly', () => {
    expect(portalStoreSource).toContain('updateProjectStatus: (projectId: string, status: ProjectStatus) => Promise<boolean>');
    expect(portalStoreSource).toContain('const updateProjectStatus = useCallback');
    expect(portalStoreSource).toContain("doc(db, getOrgDocumentPath(orgId, 'projects', targetProjectId))");
    expect(portalStoreSource).toContain('status: normalizedStatus');
    expect(portalStoreSource).toContain('updateProjectStatus,');
  });

  it('uses PM-facing project status labels', () => {
    expect(projectStatusLabelsSource).toContain("CONTRACT_PENDING: '계약 전'");
    expect(projectStatusLabelsSource).toContain("IN_PROGRESS: '진행 중'");
    expect(projectStatusLabelsSource).toContain("COMPLETED: '완료'");
    expect(projectStatusLabelsSource).toContain("COMPLETED_PENDING_PAYMENT: '완료(잔금 대기)'");
    expect(projectStatusLabelsSource).not.toContain("COMPLETED: '종료'");
  });

  it('uses PM-facing settlement labels instead of X-style wording', () => {
    expect(typesSource).toContain("NONE: '정산 없음'");
    expect(typesSource).toContain("NONE: '정산 기준 없음'");
    expect(typesSource).not.toContain("NONE: '해당없음(정산대상 아님)'");
    expect(typesSource).not.toContain('정산 X');
  });
});
