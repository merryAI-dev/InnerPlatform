import { beforeEach, describe, expect, it, vi } from 'vitest';

type DashboardSummary = {
  project: {
    id: string;
    name: string;
    status: string;
    clientOrg: string;
    managerName: string;
    settlementType: string;
    basis: string;
    contractAmount: number;
  };
  summary: {
    payrollRiskCount: number;
    visibleProjects: number;
    hrAlertCount: number;
    currentWeekLabel: string;
  };
  currentWeek: {
    label: string;
    weekStart: string;
    weekEnd: string;
    yearMonth: string;
    weekNo: number;
  } | null;
  surface: {
    currentWeekLabel: string;
    projection: {
      label: string;
      detail: string;
      latestUpdatedAt?: string;
    };
    expense: {
      label: string;
      detail: string;
      tone: 'muted' | 'warning' | 'danger' | 'success';
    };
    visibleIssues: Array<{
      label: string;
      count: number;
      tone: 'neutral' | 'warn' | 'danger';
      to: string;
    }>;
  };
  financeSummaryItems: Array<{ label: string; value: string }>;
  submissionRows: Array<{
    id: string;
    name: string;
    shortName: string;
    projectionInputLabel: string;
    projectionDoneLabel: string;
    expenseLabel: string;
    expenseTone: 'neutral' | 'warning' | 'danger' | 'success';
    latestProjectionUpdatedAt?: string;
  }>;
  notices: {
    payrollAck: {
      runId: string;
      plannedPayDate: string;
      noticeDate: string;
    } | null;
    monthlyCloseAck: {
      closeId: string;
      yearMonth: string;
      doneAt?: string;
    } | null;
    hrAlerts: {
      count: number;
      items: Array<{
        id: string;
        employeeName: string;
        eventType: string;
        effectiveDate: string;
        projectId: string;
      }>;
      overflowCount: number;
    };
  };
  payrollQueue: {
    item: null;
    riskItems: [];
  };
};

type ExpandedNode =
  | string
  | number
  | null
  | undefined
  | { type: unknown; props: Record<string, unknown> & { children?: ExpandedNode[] } }
  | ExpandedNode[];

type RenderedElement = {
  type: unknown;
  props: Record<string, unknown> & { children?: import('react').ReactNode };
};

function toRenderedElement(node: unknown): RenderedElement {
  return node as RenderedElement;
}

function depsChanged(nextDeps: unknown[] | undefined, prevDeps: unknown[] | undefined) {
  if (!nextDeps || !prevDeps) return true;
  if (nextDeps.length !== prevDeps.length) return true;
  return nextDeps.some((value, index) => !Object.is(value, prevDeps[index]));
}

function createReactHookHarness() {
  let stateIndex = 0;
  let effectIndex = 0;
  let memoIndex = 0;
  let refIndex = 0;

  const states: unknown[] = [];
  const effectDeps: Array<unknown[] | undefined> = [];
  const effectCleanups: Array<(() => void) | undefined> = [];
  const memoValues: unknown[] = [];
  const memoDeps: Array<unknown[] | undefined> = [];
  const refs: Array<{ current: unknown }> = [];

  function beginRender() {
    stateIndex = 0;
    effectIndex = 0;
    memoIndex = 0;
    refIndex = 0;
  }

  async function moduleFactory() {
    const React = await vi.importActual<typeof import('react')>('react');
    return {
      ...React,
      useState: <T,>(initialValue: T | (() => T)) => {
        const index = stateIndex++;
        if (!(index in states)) {
          states[index] = typeof initialValue === 'function'
            ? (initialValue as () => T)()
            : initialValue;
        }
        const setState = (nextValue: T | ((prevValue: T) => T)) => {
          const previousValue = states[index] as T;
          states[index] = typeof nextValue === 'function'
            ? (nextValue as (prevValue: T) => T)(previousValue)
            : nextValue;
        };
        return [states[index] as T, setState] as const;
      },
      useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
        const index = effectIndex++;
        const previousDeps = effectDeps[index];
        if (!depsChanged(deps, previousDeps)) return;
        effectCleanups[index]?.();
        effectDeps[index] = deps ? [...deps] : undefined;
        effectCleanups[index] = effect() || undefined;
      },
      useMemo: <T,>(factory: () => T, deps?: unknown[]) => {
        const index = memoIndex++;
        const previousDeps = memoDeps[index];
        if (depsChanged(deps, previousDeps)) {
          memoValues[index] = factory();
          memoDeps[index] = deps ? [...deps] : undefined;
        }
        return memoValues[index] as T;
      },
      useRef: <T,>(initialValue: T) => {
        const index = refIndex++;
        if (!refs[index]) refs[index] = { current: initialValue };
        return refs[index] as { current: T };
      },
    };
  }

  return { beginRender, moduleFactory };
}

function createSummary(overrides?: Partial<DashboardSummary['notices']> & { projectId?: string; projectName?: string }): DashboardSummary {
  return {
    project: {
      id: overrides?.projectId || 'project-1',
      name: overrides?.projectName || '프로젝트 1',
      status: 'active',
      clientOrg: '기관 A',
      managerName: '담당자 A',
      settlementType: 'monthly',
      basis: 'cost',
      contractAmount: 1000000,
    },
    summary: {
      payrollRiskCount: 0,
      visibleProjects: 1,
      hrAlertCount: 0,
      currentWeekLabel: '2026-04 3주차',
    },
    currentWeek: {
      label: '2026-04 3주차',
      weekStart: '2026-04-13',
      weekEnd: '2026-04-19',
      yearMonth: '2026-04',
      weekNo: 3,
    },
    surface: {
      currentWeekLabel: '2026-04 3주차',
      projection: {
        label: '입력됨',
        detail: '정상 제출',
        latestUpdatedAt: '2026-04-16T01:00:00.000Z',
      },
      expense: {
        label: '정상',
        detail: '문제 없음',
        tone: 'success',
      },
      visibleIssues: [],
    },
    financeSummaryItems: [
      { label: '총 입금', value: '10,000원' },
      { label: '총 출금', value: '5,000원' },
      { label: '잔액', value: '5,000원' },
      { label: '소진율', value: '50%' },
    ],
    submissionRows: [],
    notices: {
      payrollAck: overrides?.payrollAck ?? null,
      monthlyCloseAck: overrides?.monthlyCloseAck ?? null,
      hrAlerts: overrides?.hrAlerts ?? {
        count: 0,
        items: [],
        overflowCount: 0,
      },
    },
    payrollQueue: {
      item: null,
      riskItems: [],
    },
  };
}

function flattenText(node: ExpandedNode): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  return flattenText(node.props.children || []);
}

function findNode(node: ExpandedNode, predicate: (candidate: Exclude<ExpandedNode, string | number | null | undefined | ExpandedNode[]>) => boolean):
  Exclude<ExpandedNode, string | number | null | undefined | ExpandedNode[]> | null {
  if (node == null || typeof node === 'string' || typeof node === 'number') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  return findNode(node.props.children || [], predicate);
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('PortalDashboard regression', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('refetches dashboard summary after payroll acknowledgement so the stale notice disappears', async () => {
    const hookHarness = createReactHookHarness();
    const navigateSpy = vi.fn();
    const toastSuccessSpy = vi.fn();
    const acknowledgePayrollRun = vi.fn().mockResolvedValue(undefined);
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-1' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const fetchDashboardSummary = vi.fn()
      .mockResolvedValueOnce(createSummary({
        payrollAck: {
          runId: 'run-1',
          plannedPayDate: '2026-04-25',
          noticeDate: '2026-04-22',
        },
      }))
      .mockResolvedValueOnce(createSummary());

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => navigateSpy }));
    vi.doMock('sonner', () => ({
      toast: {
        success: toastSuccessSpy,
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun,
        acknowledgeMonthlyClose: vi.fn(),
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderTree = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    renderTree();
    await flushAsyncWork();
    let tree = renderTree();

    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(flattenText(tree)).toContain('인건비 지급 예정: 2026-04-25');

    const acknowledgeButton = findNode(
      tree,
      (candidate) => candidate.type === 'button' && flattenText(candidate).includes('확인했습니다'),
    );

    expect(acknowledgeButton).not.toBeNull();

    await (acknowledgeButton?.props.onClick as () => Promise<void>)();
    await flushAsyncWork();
    tree = renderTree();

    expect(acknowledgePayrollRun).toHaveBeenCalledWith('run-1');
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(flattenText(tree)).not.toContain('인건비 지급 예정: 2026-04-25');
    expect(toastSuccessSpy).toHaveBeenCalled();
  });

  it('refetches dashboard summary after monthly close acknowledgement so the stale notice disappears', async () => {
    const hookHarness = createReactHookHarness();
    const acknowledgeMonthlyClose = vi.fn().mockResolvedValue(undefined);
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-1' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const fetchDashboardSummary = vi.fn()
      .mockResolvedValueOnce(createSummary({
        monthlyCloseAck: {
          closeId: 'close-1',
          yearMonth: '2026-03',
          doneAt: '2026-04-01T00:00:00.000Z',
        },
      }))
      .mockResolvedValueOnce(createSummary());

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => vi.fn() }));
    vi.doMock('sonner', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun: vi.fn(),
        acknowledgeMonthlyClose,
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderTree = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    renderTree();
    await flushAsyncWork();
    let tree = renderTree();

    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(flattenText(tree)).toContain('월간 정산 완료 확인: 2026-03');

    const acknowledgeButton = findNode(
      tree,
      (candidate) => candidate.type === 'button' && flattenText(candidate).includes('확인했습니다'),
    );

    expect(acknowledgeButton).not.toBeNull();

    await (acknowledgeButton?.props.onClick as () => Promise<void>)();
    await flushAsyncWork();
    tree = renderTree();

    expect(acknowledgeMonthlyClose).toHaveBeenCalledWith('close-1');
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(flattenText(tree)).not.toContain('월간 정산 완료 확인: 2026-03');
  });

  it('shows explicit loading and unavailable states while the active project summary is pending or failed', async () => {
    const hookHarness = createReactHookHarness();
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-1' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const deferredProject2Summary = createDeferred<DashboardSummary>();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchDashboardSummary = vi.fn()
      .mockResolvedValueOnce(createSummary({
        projectId: 'project-1',
        projectName: '프로젝트 1',
      }))
      .mockImplementationOnce(() => deferredProject2Summary.promise);

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => vi.fn() }));
    vi.doMock('sonner', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun: vi.fn(),
        acknowledgeMonthlyClose: vi.fn(),
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderDashboard = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    renderDashboard();
    await flushAsyncWork();
    let tree = renderDashboard();

    expect(flattenText(tree)).toContain('프로젝트 1');
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'project-1',
    }));

    portalState.myProject = { id: 'project-2' };

    renderDashboard();
    tree = renderDashboard();

    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(2, expect.objectContaining({
      projectId: 'project-2',
    }));
    expect(flattenText(tree)).toContain('대시보드 요약을 불러오는 중입니다.');
    expect(flattenText(tree)).not.toContain('프로젝트 1');
    expect(flattenText(tree)).not.toContain('내 제출 현황');

    deferredProject2Summary.reject(new Error('project-2 summary failed'));
    await flushAsyncWork();
    tree = renderDashboard();

    expect(flattenText(tree)).toContain('대시보드 요약을 지금 불러올 수 없습니다.');
    expect(flattenText(tree)).not.toContain('내 제출 현황');
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it('keeps the dashboard in a loading state before the first summary resolves for the current project', async () => {
    const hookHarness = createReactHookHarness();
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-2' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const deferredSummary = createDeferred<DashboardSummary>();
    const fetchDashboardSummary = vi.fn().mockImplementation(() => deferredSummary.promise);

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => vi.fn() }));
    vi.doMock('sonner', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun: vi.fn(),
        acknowledgeMonthlyClose: vi.fn(),
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderDashboard = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    let tree = renderDashboard();

    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'project-2',
    }));
    expect(flattenText(tree)).toContain('대시보드 요약을 불러오는 중입니다.');
    expect(flattenText(tree)).not.toContain('내 사업');
    expect(flattenText(tree)).not.toContain('내 제출 현황');

    deferredSummary.resolve(createSummary({
      projectId: 'project-2',
      projectName: '프로젝트 2',
    }));
    await flushAsyncWork();
    tree = renderDashboard();

    expect(flattenText(tree)).toContain('프로젝트 2');
  });

  it('does not clear project B payroll notice when project A acknowledgement resolves after a switch', async () => {
    const hookHarness = createReactHookHarness();
    const acknowledgePayrollRun = vi.fn();
    const deferredAcknowledge = createDeferred<void>();
    const deferredRefreshAfterAck = createDeferred<DashboardSummary>();
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-1' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const fetchDashboardSummary = vi.fn()
      .mockResolvedValueOnce(createSummary({
        projectId: 'project-1',
        projectName: '프로젝트 1',
        payrollAck: {
          runId: 'run-1',
          plannedPayDate: '2026-04-25',
          noticeDate: '2026-04-22',
        },
      }))
      .mockResolvedValueOnce(createSummary({
        projectId: 'project-2',
        projectName: '프로젝트 2',
        payrollAck: {
          runId: 'run-2',
          plannedPayDate: '2026-04-30',
          noticeDate: '2026-04-27',
        },
      }))
      .mockImplementationOnce(() => deferredRefreshAfterAck.promise);

    acknowledgePayrollRun.mockImplementation(() => deferredAcknowledge.promise);

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => vi.fn() }));
    vi.doMock('sonner', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun,
        acknowledgeMonthlyClose: vi.fn(),
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderDashboard = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    renderDashboard();
    await flushAsyncWork();
    let tree = renderDashboard();

    expect(flattenText(tree)).toContain('인건비 지급 예정: 2026-04-25');

    const acknowledgeButton = findNode(
      tree,
      (candidate) => candidate.type === 'button' && flattenText(candidate).includes('확인했습니다'),
    );

    expect(acknowledgeButton).not.toBeNull();

    const acknowledgePromise = (acknowledgeButton?.props.onClick as () => Promise<void>)();

    portalState.myProject = { id: 'project-2' };

    renderDashboard();
    await flushAsyncWork();
    tree = renderDashboard();

    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(2, expect.objectContaining({
      projectId: 'project-2',
    }));
    expect(flattenText(tree)).toContain('인건비 지급 예정: 2026-04-30');
    expect(flattenText(tree)).not.toContain('인건비 지급 예정: 2026-04-25');

    deferredAcknowledge.resolve(undefined);
    await flushAsyncWork();
    tree = renderDashboard();

    expect(acknowledgePayrollRun).toHaveBeenCalledWith('run-1');
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(3);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(3, expect.objectContaining({
      projectId: 'project-2',
    }));
    expect(flattenText(tree)).toContain('인건비 지급 예정: 2026-04-30');

    deferredRefreshAfterAck.resolve(createSummary({
      projectId: 'project-2',
      projectName: '프로젝트 2',
      payrollAck: {
        runId: 'run-2',
        plannedPayDate: '2026-04-30',
        noticeDate: '2026-04-27',
      },
    }));
    await acknowledgePromise;
  });

  it('suppresses stale project summary and actions immediately when the current project changes, even if refetch fails', async () => {
    const hookHarness = createReactHookHarness();
    const portalState = {
      isLoading: false,
      portalUser: { id: 'portal-user-1' },
      myProject: { id: 'project-1' },
    };
    const authState = { user: { uid: 'user-1' } };
    const firebaseState = { orgId: 'org-1' };
    const deferredProject2Summary = createDeferred<DashboardSummary>();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchDashboardSummary = vi.fn()
      .mockResolvedValueOnce(createSummary({
        projectId: 'project-1',
        projectName: '프로젝트 1',
        payrollAck: {
          runId: 'run-1',
          plannedPayDate: '2026-04-25',
          noticeDate: '2026-04-22',
        },
      }))
      .mockImplementationOnce(() => deferredProject2Summary.promise);

    vi.doMock('react', hookHarness.moduleFactory);
    vi.doMock('react-router', () => ({ useNavigate: () => vi.fn() }));
    vi.doMock('sonner', () => ({
      toast: {
        success: vi.fn(),
        error: vi.fn(),
      },
    }));
    vi.doMock('../ui/card', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Card: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardContent: ({ children, ...props }: any) => React.createElement('div', props, children),
        CardHeader: ({ children, ...props }: any) => React.createElement('div', props, children),
      };
    });
    vi.doMock('../ui/badge', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Badge: ({ children, ...props }: any) => React.createElement('span', props, children),
      };
    });
    vi.doMock('../ui/button', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      return {
        Button: ({ children, ...props }: any) => React.createElement('button', props, children),
      };
    });
    vi.doMock('../../data/portal-store', () => ({
      usePortalStore: () => portalState,
    }));
    vi.doMock('../../data/auth-store', () => ({
      useAuth: () => authState,
    }));
    vi.doMock('../../data/payroll-store', () => ({
      usePayroll: () => ({
        acknowledgePayrollRun: vi.fn(),
        acknowledgeMonthlyClose: vi.fn(),
      }),
    }));
    vi.doMock('../../data/budget-data', () => ({
      fmtShort: (value: number) => String(value),
    }));
    vi.doMock('../../data/hr-announcements-store', () => ({
      HR_EVENT_COLORS: {},
      HR_EVENT_LABELS: {},
    }));
    vi.doMock('../../data/types', () => ({
      PROJECT_STATUS_LABELS: { active: '진행 중' },
      SETTLEMENT_TYPE_SHORT: { monthly: '월 정산' },
      BASIS_LABELS: { cost: '원가' },
    }));
    vi.doMock('../../lib/firebase-context', () => ({
      useFirebase: () => firebaseState,
    }));
    vi.doMock('../../lib/platform-bff-client', () => ({
      createPlatformApiClient: vi.fn(() => ({ name: 'api-client' })),
      fetchPortalDashboardSummaryViaBff: fetchDashboardSummary,
    }));
    vi.doMock('lucide-react', async () => {
      const React = await vi.importActual<typeof import('react')>('react');
      const Icon = () => React.createElement('span');
      return {
        AlertTriangle: Icon,
        CheckCircle2: Icon,
        CircleDollarSign: Icon,
        Loader2: Icon,
        ShieldCheck: Icon,
      };
    });

    const React = await vi.importActual<typeof import('react')>('react');
    const { PortalDashboard } = await import('./PortalDashboard');

    const expandNode = (node: unknown): ExpandedNode => {
      if (node == null || typeof node === 'string' || typeof node === 'number') return node;
      if (Array.isArray(node)) return node.map(expandNode);
      if (!React.isValidElement(node)) return null;
      const element = toRenderedElement(node);
      if (typeof element.type === 'function') {
        const Component = element.type as (props: typeof element.props) => unknown;
        return expandNode(Component(element.props));
      }
      return {
        type: element.type,
        props: {
          ...element.props,
          children: React.Children.toArray(element.props.children).map(expandNode),
        },
      };
    };

    const renderDashboard = () => {
      hookHarness.beginRender();
      return expandNode(PortalDashboard());
    };

    renderDashboard();
    await flushAsyncWork();
    let tree = renderDashboard();
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'project-1',
    }));
    expect(flattenText(tree)).toContain('프로젝트 1');
    expect(flattenText(tree)).toContain('인건비 지급 예정: 2026-04-25');

    renderDashboard();
    await flushAsyncWork();
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(1);

    portalState.myProject = { id: 'project-2' };

    tree = renderDashboard();
    expect(flattenText(tree)).not.toContain('프로젝트 1');
    expect(flattenText(tree)).not.toContain('인건비 지급 예정: 2026-04-25');

    await flushAsyncWork();
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
    expect(fetchDashboardSummary).toHaveBeenNthCalledWith(2, expect.objectContaining({
      projectId: 'project-2',
    }));

    deferredProject2Summary.reject(new Error('project-2 summary failed'));
    await flushAsyncWork();

    tree = renderDashboard();
    expect(flattenText(tree)).not.toContain('프로젝트 1');
    expect(flattenText(tree)).not.toContain('인건비 지급 예정: 2026-04-25');
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});
