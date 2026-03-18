import { describe, expect, it } from 'vitest';
import { includesProject, normalizeProjectIds, resolvePrimaryProjectId } from './project-assignment';

describe('project assignment helpers', () => {
  it('normalizes and deduplicates project ids', () => {
    expect(normalizeProjectIds([' p001 ', 'p002', 'p001', '', undefined, null])).toEqual(['p001', 'p002']);
  });

  it('resolves primary project with preferred fallback', () => {
    expect(resolvePrimaryProjectId(['p001', 'p002'], 'p002')).toBe('p002');
    expect(resolvePrimaryProjectId(['p001', 'p002'], 'p999')).toBe('p001');
    expect(resolvePrimaryProjectId([], 'p001')).toBeUndefined();
  });

  it('checks membership for a project id', () => {
    expect(includesProject(['p001', 'p002'], 'p002')).toBe(true);
    expect(includesProject(['p001', 'p002'], ' p003 ')).toBe(false);
    expect(includesProject(['p001'], '')).toBe(false);
  });
});
