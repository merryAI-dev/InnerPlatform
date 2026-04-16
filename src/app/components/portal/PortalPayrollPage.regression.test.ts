import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateSpy = vi.fn();

vi.mock('react-router', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../layout/PageHeader', () => ({
  PageHeader: ({ title, badge }: { title: string; badge?: string }) => `<header>${title}:${badge || ''}</header>`,
}));

vi.mock('../ui/card', () => ({
  Card: ({ children }: { children: unknown }) => children,
  CardContent: ({ children }: { children: unknown }) => children,
}));

vi.mock('../ui/badge', () => ({
  Badge: ({ children }: { children: unknown }) => children,
}));

vi.mock('../ui/button', () => ({
  Button: ({ children }: { children: unknown }) => children,
}));

vi.mock('../ui/input', () => ({
  Input: () => null,
}));

vi.mock('../ui/label', () => ({
  Label: ({ children }: { children: unknown }) => children,
}));

vi.mock('../../data/auth-store', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

vi.mock('../../data/portal-store', () => ({
  usePortalStore: () => ({
    activeProjectId: 'project-1',
    myProject: { id: 'project-1', shortName: 'Fallback Project' },
    transactions: [],
  }),
}));

vi.mock('../../data/payroll-store', () => ({
  usePayroll: () => ({
    schedules: [],
    runs: [],
    monthlyCloses: [],
    upsertSchedule: vi.fn(),
    acknowledgePayrollRun: vi.fn(),
    acknowledgeMonthlyClose: vi.fn(),
  }),
}));

vi.mock('../../lib/firebase-context', () => ({
  useFirebase: () => ({ orgId: 'org-1' }),
}));

vi.mock('../../lib/platform-bff-client', () => ({
  createPlatformApiClient: vi.fn(() => ({})),
  fetchPortalPayrollSummaryViaBff: vi.fn(),
}));

vi.mock('../../platform/business-days', () => ({
  addMonthsToYearMonth: vi.fn(() => '2026-03'),
  computePlannedPayDate: vi.fn(() => '2026-04-25'),
  getSeoulTodayIso: vi.fn(() => '2026-04-16'),
  subtractBusinessDays: vi.fn(() => '2026-04-22'),
}));

vi.mock('../../data/budget-data', () => ({
  fmtShort: vi.fn((value: unknown) => String(value ?? '')),
}));

vi.mock('../../platform/payroll-liquidity', () => ({
  resolveProjectPayrollLiquidity: vi.fn(() => []),
}));

vi.mock('./portal-read-model', () => ({
  resolvePortalProjectReadModel: vi.fn(() => ({
    projectName: 'Fallback Project',
    projectMetaLabel: null,
    statusLabel: null,
  })),
}));

describe('PortalPayrollPage regression', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
  });

  it('renders when payrollSummary exists without a project payload', async () => {
    vi.resetModules();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      let useStateCallCount = 0;

      return {
        ...actual,
        useState: (initialValue: unknown) => {
          useStateCallCount += 1;
          if (useStateCallCount === 1) {
            return [{ queue: [], schedule: null, currentRun: null }, vi.fn()] as const;
          }

          return [initialValue, vi.fn()] as const;
        },
      };
    });

    const React = await import('react');
    const { PortalPayrollPage } = await import('./PortalPayrollPage');

    expect(() => renderToStaticMarkup(React.createElement(PortalPayrollPage))).not.toThrow();
  });
});
