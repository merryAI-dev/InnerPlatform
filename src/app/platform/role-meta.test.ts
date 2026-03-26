import { describe, expect, it } from 'vitest';
import { ROLE_META } from './role-meta';
import type { UserRole } from '../data/types';

const ALL_ROLES: UserRole[] = [
  'admin', 'finance', 'pm', 'viewer',
];

describe('ROLE_META', () => {
  it('has an entry for every UserRole', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_META[role], `ROLE_META missing entry for role: ${role}`).toBeDefined();
    }
  });

  it('every entry has a non-empty label', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_META[role].label.length, `label empty for role: ${role}`).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty badgeClass', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_META[role].badgeClass.length, `badgeClass empty for role: ${role}`).toBeGreaterThan(0);
    }
  });

  it('every entry has an Icon component', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_META[role].Icon, `Icon missing for role: ${role}`).toBeDefined();
    }
  });
});
