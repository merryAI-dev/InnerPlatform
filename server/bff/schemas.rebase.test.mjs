import { describe, expect, it } from 'vitest';
import { projectInfoDraftRebaseSchema } from './schemas.mjs';

// A single-argument z.record() parses fine while the optional field is absent and only
// throws once a value is present, so the preview call succeeded and every apply call
// returned 500. Both shapes are asserted here.
describe('projectInfoDraftRebaseSchema', () => {
  it('accepts a preview request that omits resolutions', () => {
    expect(projectInfoDraftRebaseSchema.parse({ expectedDraftRevision: 8 }))
      .toEqual({ expectedDraftRevision: 8 });
  });

  it('accepts an apply request carrying resolutions', () => {
    const parsed = projectInfoDraftRebaseSchema.parse({
      expectedDraftRevision: 8,
      resolutions: { teamMembersDetailed: 'MINE', paymentExpectedMonths: 'THEIRS' },
    });
    expect(parsed.resolutions).toEqual({
      teamMembersDetailed: 'MINE',
      paymentExpectedMonths: 'THEIRS',
    });
  });

  it('rejects a resolution value outside MINE and THEIRS', () => {
    expect(() => projectInfoDraftRebaseSchema.parse({
      expectedDraftRevision: 8,
      resolutions: { teamMembersDetailed: 'BOTH' },
    })).toThrow();
  });

  it('rejects an empty field name', () => {
    expect(() => projectInfoDraftRebaseSchema.parse({
      expectedDraftRevision: 8,
      resolutions: { '': 'MINE' },
    })).toThrow();
  });

  it('rejects unknown top-level keys', () => {
    expect(() => projectInfoDraftRebaseSchema.parse({
      expectedDraftRevision: 8,
      unexpected: true,
    })).toThrow();
  });
});
