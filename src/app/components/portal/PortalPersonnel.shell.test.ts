import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalPersonnel.tsx'), 'utf8');

describe('PortalPersonnel shell contract', () => {
  it('uses the BFF project snapshot and the participation-rate term', () => {
    expect(source).toContain('fetchProjectParticipationViaBff');
    expect(source).toContain('평균 참여율');
    expect(source).toContain('참여율 {member.totalRate}%');
    expect(source).not.toContain('평균 투입율');
    expect(source).not.toContain('투입율 {m.totalRate}%');
  });
});
