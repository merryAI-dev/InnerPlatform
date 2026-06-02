import { describe, expect, it } from 'vitest';
import {
  PROJECT_DEPARTMENT_OPTIONS,
  buildProjectDepartmentSettingsOptions,
  resolveProjectDepartmentSettingsOptions,
} from './project-department-options';

describe('project department settings options', () => {
  it('uses defaults only when the settings document is missing', () => {
    expect(resolveProjectDepartmentSettingsOptions(null)).toEqual([...PROJECT_DEPARTMENT_OPTIONS]);
  });

  it('keeps configured options first while preserving canonical defaults', () => {
    expect(resolveProjectDepartmentSettingsOptions({
      options: [
        { id: 'space', label: '공간플랫폼센터', sortOrder: 1, active: true },
        { id: 'investment', label: '투자센터', sortOrder: 0, active: true },
      ],
    }).slice(0, 2)).toEqual(['투자센터', '공간플랫폼센터']);
  });

  it('falls back to canonical defaults when an existing settings document is empty', () => {
    expect(resolveProjectDepartmentSettingsOptions({ options: [] })).toEqual([...PROJECT_DEPARTMENT_OPTIONS]);
  });

  it('normalizes spaced CIC labels before saving settings options', () => {
    expect(buildProjectDepartmentSettingsOptions(['CIC 2', 'CIC2', '공간플랫폼센터']).map((option) => option.label))
      .toEqual(['CIC2', '공간플랫폼센터']);
  });

  it('keeps generated option ids unique when normalized ids collide', () => {
    expect(buildProjectDepartmentSettingsOptions(['A', 'A!']).map((option) => option.id))
      .toEqual(['a', 'a-2']);
  });
});
