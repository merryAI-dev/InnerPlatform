import { describe, expect, it } from 'vitest';
import { deriveProjectCicFromDepartment, getProjectRegistrationCicOptions, normalizeStoredCic, resolveProjectCic } from './project-cic';

describe('project-cic', () => {
  it('normalizes stored cic values', () => {
    expect(normalizeStoredCic('CIC1')).toBe('CIC1');
    expect(normalizeStoredCic('미지정')).toBeUndefined();
    expect(normalizeStoredCic('')).toBeUndefined();
  });

  it('derives cic from department-like values used in project registration', () => {
    expect(deriveProjectCicFromDepartment('CIC2')).toBe('CIC2');
    expect(deriveProjectCicFromDepartment('cic 3')).toBe('CIC3');
    expect(deriveProjectCicFromDepartment('C-스템CIC')).toBe('C-스템CIC');
    expect(deriveProjectCicFromDepartment('개발협력센터')).toBe('개발협력센터');
    expect(deriveProjectCicFromDepartment('투자센터')).toBe('투자센터');
  });

  it('prefers explicit cic and falls back to department-derived cic', () => {
    expect(resolveProjectCic({ cic: 'CIC4', department: '개발협력센터' })).toBe('CIC4');
    expect(resolveProjectCic({ cic: '', department: 'CIC1' })).toBe('CIC1');
    expect(resolveProjectCic({ department: '미지정' })).toBeUndefined();
  });

  it('exposes registration organization options from the project registration source list', () => {
    expect(getProjectRegistrationCicOptions()).toEqual([
      '개발협력센터',
      '글로벌센터',
      '조인트액션',
      '투자센터',
      'AXR팀',
      'CI그룹',
      'CIC1',
      'CIC2',
      'CIC3',
      'CIC4',
      'DXR팀',
    ]);
  });
});
