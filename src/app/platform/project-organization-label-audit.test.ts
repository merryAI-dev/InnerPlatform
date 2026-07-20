import { describe, expect, it } from 'vitest';
import { buildOrganizationLabelAuditRows, canonicalizeOrganizationLabel } from '../../../scripts/audit-project-organization-labels';

describe('audit-project-organization-labels', () => {
  it('reports only noncanonical organization labels across projects and both request collections', () => {
    const rows = buildOrganizationLabelAuditRows('mysc', [
      {
        name: 'projects',
        documents: [
          { docId: 'project-cic', data: { department: 'CIC 2', cic: 'CIC2' } },
          { docId: 'project-axr', data: { department: 'AXR Team' } },
        ],
      },
      {
        name: 'project_requests',
        documents: [
          { docId: 'request-current', data: { payload: { department: 'CIC 2' }, proposedSnapshot: { department: 'AXR팀' } } },
        ],
      },
      {
        name: 'projectRequests',
        documents: [
          { docId: 'request-legacy', data: { approvedSnapshot: { department: 'AXR Team' } } },
        ],
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ docPath: 'orgs/mysc/projects/project-cic', fieldPath: 'department', actualValue: 'CIC 2', canonicalValue: 'CIC2' }),
      expect.objectContaining({ docPath: 'orgs/mysc/projects/project-axr', fieldPath: 'department', actualValue: 'AXR Team', canonicalValue: 'AXR팀' }),
      expect.objectContaining({ docPath: 'orgs/mysc/project_requests/request-current', fieldPath: 'payload.department', actualValue: 'CIC 2', canonicalValue: 'CIC2' }),
      expect.objectContaining({ docPath: 'orgs/mysc/projectRequests/request-legacy', fieldPath: 'approvedSnapshot.department', actualValue: 'AXR Team', canonicalValue: 'AXR팀' }),
    ]);
  });

  it('keeps canonical labels unchanged', () => {
    expect(canonicalizeOrganizationLabel('CIC2')).toBe('CIC2');
    expect(canonicalizeOrganizationLabel('AXR팀')).toBe('AXR팀');
    expect(canonicalizeOrganizationLabel('개발협력센터')).toBe('개발협력센터');
  });
});
