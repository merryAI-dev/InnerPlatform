import { describe, expect, it } from 'vitest';
import { resolvePortalProviderScope } from './portal-route-providers';

describe('portal route provider scope', () => {
  it('keeps canonical cashflow resources inside the cashflow provider scope', () => {
    for (const pathname of [
      '/portal/cashflow/project-a',
      '/portal/cashflow/project-a/sheets-lab',
    ]) {
      expect(resolvePortalProviderScope(pathname)).toMatchObject({
        cashflowWeeks: true,
        board: false,
        careerProfile: false,
        training: false,
      });
    }
  });
});
