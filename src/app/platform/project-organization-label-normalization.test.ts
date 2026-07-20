import { describe, expect, it } from 'vitest';
import {
  assertNamedCloneDatabase,
  buildOrganizationLabelNormalizationPatches,
  normalizeLegacyOrganizationLabel,
} from '../../../scripts/normalize-project-organization-labels';

describe('normalize-project-organization-labels', () => {
  it('plans only the explicitly approved legacy label variants', () => {
    const patches = buildOrganizationLabelNormalizationPatches('mysc', [
      {
        name: 'projects',
        documents: [
          { docId: 'cic', data: { department: 'CIC 2', cic: 'CIC2' } },
          { docId: 'axr', data: { department: 'AXR Team' } },
          { docId: 'other-team', data: { department: 'DXR Team' } },
        ],
      },
      {
        name: 'project_requests',
        documents: [
          {
            docId: 'request',
            data: {
              payload: { department: 'CIC 3' },
              proposedSnapshot: { department: 'AXR Team' },
              beforeSnapshot: { cic: 'CIC2' },
              approvedSnapshot: { department: 'DXR Team' },
            },
          },
        ],
      },
      {
        name: 'projectRequests',
        documents: [
          { docId: 'legacy-request', data: { approvedSnapshot: { cic: 'CIC 4' } } },
        ],
      },
    ]);

    expect(patches).toEqual([
      expect.objectContaining({
        docPath: 'orgs/mysc/projects/cic',
        fields: { department: 'CIC2' },
      }),
      expect.objectContaining({
        docPath: 'orgs/mysc/projects/axr',
        fields: { department: 'AXR팀' },
      }),
      expect.objectContaining({
        docPath: 'orgs/mysc/project_requests/request',
        fields: { 'payload.department': 'CIC3', 'proposedSnapshot.department': 'AXR팀' },
      }),
      expect.objectContaining({
        docPath: 'orgs/mysc/projectRequests/legacy-request',
        fields: { 'approvedSnapshot.cic': 'CIC4' },
      }),
    ]);
  });

  it('does not broaden the migration beyond exact CIC-space and AXR Team values', () => {
    expect(normalizeLegacyOrganizationLabel('CIC 2')).toBe('CIC2');
    expect(normalizeLegacyOrganizationLabel('AXR Team')).toBe('AXR팀');
    expect(normalizeLegacyOrganizationLabel('CIC2')).toBeNull();
    expect(normalizeLegacyOrganizationLabel('cic 2')).toBeNull();
    expect(normalizeLegacyOrganizationLabel('DXR Team')).toBeNull();
    expect(normalizeLegacyOrganizationLabel('CIC 02')).toBe('CIC02');
  });

  it('rejects the default database even for a dry run', () => {
    expect(() => assertNamedCloneDatabase('(default)')).toThrow(/named clone/i);
    expect(() => assertNamedCloneDatabase('audit2607151400')).not.toThrow();
  });
});
