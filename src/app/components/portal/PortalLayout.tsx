import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, Calculator,
  LogOut,
  FolderKanban, Menu,
  Plus, Pencil,
  CircleDollarSign,
  BarChart3,
  Loader2,
  Settings2,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  Upload,
  Shield,
  ChevronLeft,
  ChevronRight,
  Search,
  Bell,
  UserCircle2,
  User,
} from 'lucide-react';
import { PortalProvider, usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { useHrAnnouncements } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '../ui/command';
import { DarkModeToggle } from '../layout/DarkModeToggle';
import { PageTransition } from '../layout/PageTransition';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { MyscWordmark } from '../brand/MyscWordmark';
import {
  canChooseWorkspace,
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  shouldForcePortalOnboarding,
} from '../../platform/navigation';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { normalizeProjectFundInputMode } from '../../data/types';
import { rememberRecentPortalProject } from '../../platform/portal-recent-projects';
import { buildPortalShellCommandItems, buildPortalShellNotificationItems } from '../../platform/portal-shell-actions';

// ═══════════════════════════════════════════════════════════════
// PortalLayout — 사용자(PM) 전용 레이아웃
// 하나의 사업만 볼 수 있는 간소화된 UI
// ═══════════════════════════════════════════════════════════════

const NAV_SECTIONS = [
  {
    title: '마이메뉴',
    items: [
      { to: '/portal', icon: LayoutDashboard, label: '내 사업 현황', exact: true },
      { to: '/portal/payroll', icon: CircleDollarSign, label: '인건비/공지', accent: true, hidden: true },
    ],
  },
  {
    title: '사업비관리',
    items: [
      { to: '/portal/budget', icon: Calculator, label: '예산 편집' },
      { to: '/portal/bank-statements', icon: FileSpreadsheet, label: '통장내역' },
      { to: '/portal/weekly-expenses', icon: FileSpreadsheet, label: '사업비 입력(주간)' },
      { to: '/portal/cashflow', icon: BarChart3, label: '캐시플로(주간)' },
    ],
  },
  {
    title: '사업 배정 및 등록',
    items: [
      { to: '/portal/project-settings', icon: Settings2, label: '사업 배정 수정', exact: true },
      { to: '/portal/edit-project', icon: Pencil, label: '프로젝트 정보 수정' },
      { to: '/portal/register-project', icon: Plus, label: '사업 등록 제안', accent: true },
    ],
  },
];

type PortalNavigationAttempt = {
  path: string;
  label: string;
};

type PortalNavigationGuardValue = {
  registerNavigationHandler: (handler: ((attempt: PortalNavigationAttempt) => boolean) | null) => void;
};

const PortalNavigationGuardContext = createContext<PortalNavigationGuardValue>({
  registerNavigationHandler: () => {},
});

const PORTAL_SIDEBAR_STORAGE_KEY = 'mysc-portal-sidebar-collapsed';

function readPortalSidebarCollapsed(uid?: string | null): boolean {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(`${PORTAL_SIDEBAR_STORAGE_KEY}:${normalizedUid}`) === 'true';
  } catch {
    return false;
  }
}

function writePortalSidebarCollapsed(uid: string | null | undefined, collapsed: boolean) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${PORTAL_SIDEBAR_STORAGE_KEY}:${normalizedUid}`, collapsed ? 'true' : 'false');
  } catch {
    // ignore localStorage failures
  }
}

export function usePortalNavigationGuard() {
  return useContext(PortalNavigationGuardContext);
}

function PortalContent() {
  const {
    isRegistered,
    isLoading: portalLoading,
    portalUser,
    myProject,
    logout: portalLogout,
    changeRequests,
    projects,
    setActiveProject,
  } = usePortalStore();
  const {
    isAuthenticated,
    isLoading: authLoading,
    user: authUser,
    logout: authLogout,
    setWorkspacePreference,
  } = useAuth();
  const { getUnacknowledgedCount } = useHrAnnouncements();
  const { runs, monthlyCloses } = usePayroll();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const navigationHandlerRef = useRef<((attempt: PortalNavigationAttempt) => boolean) | null>(null);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const registerNavigationHandler = useCallback((handler: ((attempt: PortalNavigationAttempt) => boolean) | null) => {
    navigationHandlerRef.current = handler;
  }, []);
  const requestPortalNavigation = useCallback((path: string, label: string) => {
    if (navigationHandlerRef.current?.({ path, label })) return;
    navigate(path);
  }, [navigate]);
  const requestAdminNavigation = useCallback(() => {
    if (navigationHandlerRef.current?.({ path: '/', label: '관리자 공간' })) return;
    void setWorkspacePreference('admin', { persistDefault: false })
      .finally(() => navigate('/'));
  }, [navigate, setWorkspacePreference]);
  const handleLogout = useCallback(() => {
    portalLogout();
    authLogout();
    navigate('/login');
  }, [authLogout, navigate, portalLogout]);

  // ── 모든 hooks는 early return 전에 호출 ──
  const assignedProjects = useMemo(() => {
    if (!portalUser) return [];
    if (!Array.isArray(portalUser.projectIds) || portalUser.projectIds.length === 0) {
      return myProject ? [myProject] : [];
    }
    const pool = projects.length ? projects : [];
    const mapped = portalUser.projectIds
      .map((id) => pool.find((project) => project.id === id) || null)
      .filter((project): project is NonNullable<typeof project> => !!project);
    if (mapped.length > 0) return mapped;
    return myProject ? [myProject] : [];
  }, [portalUser, projects, myProject]);

  const projectOptions = useMemo(() => {
    if (!portalUser) return [];
    const ids = Array.isArray(portalUser.projectIds) && portalUser.projectIds.length
      ? portalUser.projectIds
      : portalUser.projectId ? [portalUser.projectId] : [];
    return ids
      .map((id) => {
        const project = projects.find((p) => p.id === id) || null;
        if (project && project.status !== 'CONTRACT_PENDING') return null;
        const fallbackName = portalUser.projectNames?.[id];
        if (!project && !fallbackName) return null;
        return { id, name: project?.name || fallbackName || id };
      })
      .filter((item): item is { id: string; name: string } => item !== null);
  }, [portalUser, projects]);

  const selectedProjectOptionValue = useMemo(() => {
    if (!portalUser?.projectId) return '';
    return projectOptions.some((item) => item.id === portalUser.projectId) ? portalUser.projectId : '';
  }, [portalUser?.projectId, projectOptions]);

  const currentProject = useMemo(() => {
    if (!portalUser) return myProject;
    return assignedProjects.find((project) => project.id === portalUser.projectId) || myProject;
  }, [assignedProjects, portalUser, myProject]);

  useEffect(() => {
    if (!currentProject?.id) return;
    rememberRecentPortalProject(currentProject.id);
  }, [currentProject?.id]);

  useEffect(() => {
    setCollapsed(readPortalSidebarCollapsed(authUser?.uid));
  }, [authUser?.uid]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writePortalSidebarCollapsed(authUser?.uid, next);
      return next;
    });
  }, [authUser?.uid]);

  const currentProjectName = useMemo(() => {
    if (!portalUser?.projectId) return myProject?.name;
    const fromOptions = projectOptions.find((opt) => opt.id === portalUser.projectId)?.name;
    return fromOptions || myProject?.name;
  }, [portalUser?.projectId, projectOptions, myProject?.name]);
  const currentFundInputMode = normalizeProjectFundInputMode(currentProject?.fundInputMode);
  const navSections = useMemo(() => (
    NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if ('hidden' in item && item.hidden) return false;
        if (item.to === '/portal/bank-statements' && currentFundInputMode === 'DIRECT_ENTRY') return false;
        return true;
      }),
    }))
  ), [currentFundInputMode]);
  const topNavItems = useMemo(() => navSections.flatMap((section) => section.items), [navSections]);
  const currentSectionLabel = useMemo(() => {
    const current = topNavItems.find((item) => isActive(item.to, item.exact));
    return current?.label || '내 사업 현황';
  }, [topNavItems, location.pathname]);
  const shellCommandItems = useMemo(() => buildPortalShellCommandItems({
    role: authUser?.role,
    currentProject: currentProject ? { id: currentProject.id, name: currentProject.name } : null,
    assignedProjects: assignedProjects.map((project) => ({ id: project.id, name: project.name })),
    topNavItems: topNavItems.map((item) => ({ to: item.to, label: item.label })),
  }), [assignedProjects, authUser?.role, currentProject, topNavItems]);


  // 미인증 시 로그인으로
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: currentPath } });
    }
  }, [authLoading, currentPath, isAuthenticated, navigate]);

  useEffect(() => {
    if (authLoading) return;
    const role = authUser?.role;
    if (!isAuthenticated || !role) return;
    if (!canEnterPortalWorkspace(role)) {
      if (location.pathname.startsWith('/portal/board')) {
        const suffix = location.pathname.slice('/portal'.length);
        navigate(suffix, { replace: true });
        return;
      }

      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, authUser, location.pathname, navigate]);

  useEffect(() => {
    if (authLoading) return;
    const role = authUser?.role;
    if (!isAuthenticated || !role || !canChooseWorkspace(role)) return;
    // admin/finance가 portal을 잠깐 방문할 때 workspace를 덮어쓰지 않음
    if (isAdminSpaceRole(role)) return;
    if (authUser?.lastWorkspace === 'portal') return;
    void setWorkspacePreference('portal', { persistDefault: false });
  }, [authLoading, authUser?.lastWorkspace, authUser?.role, isAuthenticated, setWorkspacePreference]);

  // 포털 미등록 시 온보딩으로 (인증은 되었지만 포털 사업 미선택)
  useEffect(() => {
    if (authLoading || portalLoading) return;
    if (shouldForcePortalOnboarding({
      isAuthenticated,
      role: authUser?.role,
      isRegistered,
      pathname: location.pathname,
    }) && location.pathname !== '/portal/project-settings') {
      navigate('/portal/project-settings', { replace: true });
    }
  }, [authLoading, portalLoading, isAuthenticated, authUser?.role, isRegistered, location.pathname, navigate]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditable = !!target && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      );
      if (isEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (authLoading || portalLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">포털 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const standaloneOnboarding = (
    (location.pathname.includes('/portal/onboarding')
      || location.pathname.includes('/portal/project-settings')
      || location.pathname.includes('/portal/weekly-expenses')) &&
    !isRegistered &&
    canEnterPortalWorkspace(authUser?.role)
  );
  if (standaloneOnboarding) {
    return <Outlet />;
  }

  if (!isRegistered || !portalUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-teal-950/20 flex items-center justify-center px-6">
        <div className="max-w-lg w-full">
          {/* 환영 헤더 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-500/20 mb-4">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              환영합니다!
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              사업관리를 시작하려면 아래에서 선택해 주세요
            </p>
          </div>

          {/* 선택 카드 */}
          <div className="grid gap-3">
            <button
              onClick={() => navigate('/portal/project-settings')}
              className="group relative flex items-center gap-4 p-5 rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm hover:border-teal-300 hover:shadow-md hover:shadow-teal-500/5 transition-all duration-200 text-left"
            >
              <div className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform">
                <FolderKanban className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">기존 사업 선택</p>
                <p className="text-xs text-muted-foreground mt-0.5">이미 등록된 사업에서 선택하여 시작합니다</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-teal-500 group-hover:translate-x-0.5 transition-all" />
            </button>

            <button
              onClick={() => navigate('/portal/weekly-expenses')}
              className="group relative flex items-center gap-4 p-5 rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm hover:border-violet-300 hover:shadow-md hover:shadow-violet-500/5 transition-all duration-200 text-left"
            >
              <div className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400 group-hover:scale-105 transition-transform">
                <Upload className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">증빙 업로드만 할게요</p>
                <p className="text-xs text-muted-foreground mt-0.5">사업 선택 없이 바로 PDF/영수증을 업로드합니다</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-violet-500 group-hover:translate-x-0.5 transition-all" />
            </button>

            <button
              onClick={() => navigate('/portal/register-project')}
              className="group relative flex items-center gap-4 p-5 rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm hover:border-emerald-300 hover:shadow-md hover:shadow-emerald-500/5 transition-all duration-200 text-left"
            >
              <div className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform">
                <Plus className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">새 사업 등록</p>
                <p className="text-xs text-muted-foreground mt-0.5">새로운 사업을 제안하고 등록을 시작합니다</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all" />
            </button>

            {isAdminSpaceRole(authUser?.role) && (
              <button
                onClick={requestAdminNavigation}
                className="group relative flex items-center gap-4 p-5 rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-800/60 backdrop-blur-sm hover:border-slate-300 hover:shadow-md hover:shadow-slate-500/5 transition-all duration-200 text-left"
              >
                <div className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 group-hover:scale-105 transition-transform">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">관리자 공간으로 이동</p>
                  <p className="text-xs text-muted-foreground mt-0.5">조직 운영, 사용자 관리, 전사 설정 화면으로 이동합니다</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
          </div>

          {/* 로그아웃 */}
          <div className="mt-6 text-center">
            <button
              onClick={() => { portalLogout(); authLogout(); navigate('/login'); }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              다른 계정으로 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 배지 카운트
  const pendingChanges = changeRequests.filter(r => r.state === 'SUBMITTED').length;
  const hrAlertCount = getUnacknowledgedCount();
  const payrollPendingCount = (() => {
    const today = getSeoulTodayIso();
    const yearMonth = today.slice(0, 7);
    const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);
    const projectId = portalUser.projectId;
    const run = runs.find((r) => r.projectId === projectId && r.yearMonth === yearMonth);
    const closePrev = monthlyCloses.find((c) => c.projectId === projectId && c.yearMonth === prevYearMonth);
    const payroll = run && today >= run.noticeDate && !run.acknowledged ? 1 : 0;
    const monthly = closePrev && closePrev.status === 'DONE' && !closePrev.acknowledged ? 1 : 0;
    return payroll + monthly;
  })();
  const notificationItems = buildPortalShellNotificationItems({
    pendingChanges,
    hrAlertCount,
    payrollPendingCount,
  });
  function isActive(to: string, exact?: boolean) {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to);
  }

  function getBadge(to: string): number | null {
    if (to === '/portal/payroll' && payrollPendingCount > 0) return payrollPendingCount;
    if (to === '/portal/change-requests') {
      const total = pendingChanges + hrAlertCount;
      return total > 0 ? total : null;
    }
    return null;
  }

  return (
    <PortalNavigationGuardContext.Provider value={{ registerNavigationHandler }}>
      <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-full overflow-hidden relative">
        {/* ── Mobile overlay ── */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* ── Mobile drawer ── */}
        <aside className={`
          ${collapsed ? 'w-[60px]' : 'w-[240px]'} flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 lg:hidden
          transition-all duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          bg-sidebar/90 backdrop-blur-xl border-r border-white/10
        `}>
          {/* Brand */}
          <div className={`flex items-center gap-2.5 h-[48px] px-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm">
              <MyscWordmark />
            </div>
            {!collapsed && (
              <div className="flex-1" />
            )}
          </div>

          {/* 사업 정보 카드 */}
          {myProject && !collapsed && (
            <div className="mx-2.5 mb-2 p-2.5 rounded-xl bg-white/8 border border-white/20">
              <p className="text-[10px] text-slate-500 mb-0.5">내 사업</p>
              {projectOptions.length > 0 ? (
                <Select
                  value={selectedProjectOptionValue}
                  onValueChange={(value) => {
                    if (value && value !== portalUser?.projectId) {
                      setActiveProject(value);
                    }
                  }}
                >
                  <SelectTrigger className="h-7 text-[10px] px-2 bg-white/8 border-white/20 text-slate-200">
                    <SelectValue placeholder="사업 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-[11px] text-white truncate" style={{ fontWeight: 600 }}>
                  {myProject.name.length > 28 ? myProject.name.slice(0, 28) + '...' : myProject.name}
                </p>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                <Badge className="text-[8px] h-3.5 px-1 bg-teal-500/20 text-teal-300 border-0">
                  {currentProject?.clientOrg || ''}
                </Badge>
                <span className="text-[9px] text-slate-600">{currentProject?.department || ''}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-6 text-[10px] w-full border-white/20 bg-white/8 text-slate-200 hover:bg-white/15"
                onClick={() => requestPortalNavigation('/portal/project-settings', '사업 배정 수정')}
              >
                사업 배정 수정
              </Button>
            </div>
          )}

          {myProject && collapsed && (
            <div className="mx-2.5 mb-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 border-white/20 bg-white/8 text-slate-200 hover:bg-white/15"
                    onClick={() => requestPortalNavigation('/portal/project-settings', '사업 배정 수정')}
                  >
                    <FolderKanban className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[11px]">
                  <div className="space-y-1">
                    <p className="font-medium text-slate-900">{currentProjectName || '사업 미선택'}</p>
                    <p className="text-slate-500">사업 배정 수정</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 py-1 overflow-y-auto">
            <div className="space-y-3 px-2">
              {navSections.map((section) => {
                const visibleItems = section.items;
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.title} className="space-y-1">
                    {!collapsed && (
                      <p className="px-2.5 text-[10px] text-slate-500 tracking-wide" style={{ fontWeight: 700 }}>
                        {section.title}
                      </p>
                    )}
                    <div className="space-y-px">
                      {visibleItems.map((item) => {
                        const active = isActive(item.to, item.exact);
                        const badge = getBadge(item.to);
                        const navLink = (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.exact}
                            onClick={(event) => {
                              event.preventDefault();
                              requestPortalNavigation(item.to, item.label);
                            }}
                            className={`
                              group relative flex items-center gap-2 rounded-md text-[12px] transition-all duration-100
                              ${collapsed ? 'justify-center h-9 w-full px-0' : 'px-2.5 py-[7px]'}
                              ${active
                                ? 'bg-teal-500/18 text-white backdrop-blur-sm'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/8'
                              }
                            `}
                          >
                            {active && !collapsed && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r bg-teal-400" />
                            )}
                            <item.icon className={`w-[15px] h-[15px] shrink-0 ${active ? 'text-teal-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
                            {!collapsed && (
                              <>
                                <span style={{ fontWeight: active ? 500 : 400 }}>{item.label}</span>
                                {badge !== null && (
                                  <span className="ml-auto flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-teal-500/90 text-[9px] text-white px-1" style={{ fontWeight: 700 }}>
                                    {badge}
                                  </span>
                                )}
                              </>
                            )}
                          </NavLink>
                        );
                        if (collapsed) {
                          return (
                            <Tooltip key={item.to}>
                              <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                              <TooltipContent side="right" className="text-[11px]">
                                <div className="flex items-center gap-2">
                                  <span>{item.label}</span>
                                  {badge !== null && <span className="text-teal-500">{badge}</span>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        }
                        return navLink;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </nav>

          {/* Footer */}
          <div className="border-t border-white/10 p-2 space-y-1.5">
            <DarkModeToggle collapsed={collapsed} />
            {!collapsed ? (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/8 border border-white/10">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-[10px] text-white"
                  style={{ fontWeight: 700, background: 'linear-gradient(135deg, #0d9488, #059669)' }}
                >
                  {portalUser.name.charAt(0)}
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-[11px] text-slate-300 truncate" style={{ fontWeight: 500 }}>{portalUser.name}</p>
                  <p className="text-[9px] text-slate-600">{portalUser.role}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { portalLogout(); authLogout(); navigate('/login'); }}
                      className="p-1 rounded hover:bg-white/15 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">로그아웃</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { portalLogout(); authLogout(); navigate('/login'); }}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/8 text-slate-400 hover:bg-white/15 hover:text-slate-200 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[11px]">로그아웃</TooltipContent>
                </Tooltip>
              </div>
            )}
            <button
              onClick={toggleSidebar}
              className="w-full flex items-center justify-center h-7 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
            >
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
          <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <div className="flex h-14 items-center gap-3 border-b border-slate-200 bg-[#0f2747] px-4 text-white md:px-6">
              <button
                className="rounded-md p-1.5 text-slate-200 transition-colors hover:bg-white/10 lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 items-center gap-2">
                <div className="inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm">
                  <MyscWordmark className="shrink-0" />
                </div>
              </div>
              <div className="hidden flex-1 items-center justify-center px-4 md:flex">
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  className="flex h-10 w-full max-w-xl items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 text-left text-slate-200 transition-colors hover:bg-white/12"
                >
                  <Search className="h-4 w-4 text-slate-300" />
                  <span className="truncate text-[12px] text-slate-300">빠른 이동, 담당 사업, 화면 검색</span>
                  <span className="ml-auto rounded-md border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    ⌘K
                  </span>
                </button>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {isAdminSpaceRole(authUser?.role) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden h-8 border-white/15 bg-white/8 text-[11px] text-white hover:bg-white/12 md:inline-flex"
                    onClick={requestAdminNavigation}
                  >
                    <Shield className="mr-1 h-3.5 w-3.5" />
                    관리자 공간
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="알림 메뉴 열기"
                      className="relative rounded-md p-2 text-slate-200 transition-colors hover:bg-white/10"
                    >
                      <Bell className="h-4 w-4" />
                      {notificationItems.length > 0 && (
                        <span className="absolute right-1 top-1 inline-flex h-2 w-2 rounded-full bg-amber-400" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72 text-[12px]">
                    <DropdownMenuLabel>알림</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {notificationItems.length === 0 ? (
                      <DropdownMenuItem disabled>처리할 알림 없음</DropdownMenuItem>
                    ) : (
                      <DropdownMenuGroup>
                        {notificationItems.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            onClick={() => requestPortalNavigation(item.to, item.label)}
                            className="flex flex-col items-start gap-0.5 py-2"
                          >
                            <span className="font-medium text-slate-900">{item.label}</span>
                            <span className="text-[11px] text-slate-500">{item.description}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="사용자 메뉴 열기"
                      className="rounded-md p-2 text-slate-200 transition-colors hover:bg-white/10"
                    >
                      <UserCircle2 className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 text-[12px]">
                    <DropdownMenuLabel className="space-y-0.5">
                      <div className="text-[12px] font-semibold text-slate-900">{portalUser.name}</div>
                      <div className="text-[11px] font-normal text-slate-500">{authUser?.email || ''}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => requestPortalNavigation('/portal/career-profile', '내 프로필')}>
                        <User className="h-4 w-4" />
                        내 프로필
                      </DropdownMenuItem>
                      {isAdminSpaceRole(authUser?.role) && (
                        <DropdownMenuItem onClick={requestAdminNavigation}>
                          <Shield className="h-4 w-4" />
                          관리자 공간
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="h-4 w-4" />
                      로그아웃
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3 md:px-6 lg:gap-0">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[20px] font-semibold tracking-[-0.03em] text-slate-950">{currentSectionLabel}</p>
                      <Badge className="h-5 rounded-full bg-[#e8f0fb] px-2 text-[10px] font-semibold text-[#1b4f8f]">
                        {portalUser.role}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {projectOptions.length > 0 ? (
                    <Select
                      value={selectedProjectOptionValue}
                      onValueChange={(value) => {
                        if (value && value !== portalUser?.projectId) {
                          setActiveProject(value);
                        }
                      }}
                    >
                      <SelectTrigger className="h-10 min-w-[220px] rounded-xl border-slate-300 bg-white text-[12px] font-medium text-slate-900 shadow-sm">
                        <SelectValue placeholder="사업 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-[12px] font-medium text-slate-900 shadow-sm">
                      {currentProjectName || '사업 미선택'}
                    </div>
                  )}
                </div>
              </div>

              <div className="-mx-4 overflow-x-auto px-4 pb-1 pt-1 md:-mx-6 md:px-6">
                <nav className="flex min-w-max items-center gap-1">
                  {topNavItems.map((item) => {
                    const active = isActive(item.to, item.exact);
                    const badge = getBadge(item.to);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.exact}
                        onClick={(event) => {
                          event.preventDefault();
                          requestPortalNavigation(item.to, item.label);
                        }}
                        className={`group inline-flex h-10 items-center gap-2 rounded-t-xl border-b-2 px-3 text-[12px] font-medium transition-colors ${
                          active
                            ? 'border-[#1b6dff] text-[#1b4f8f]'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <item.icon className={`h-3.5 w-3.5 ${active ? 'text-[#1b6dff]' : 'text-slate-400 group-hover:text-slate-600'}`} />
                        <span className="whitespace-nowrap">
                          {item.label.replace('(주간)', '')}
                        </span>
                        {badge !== null && (
                          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-700">
                            {badge}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </nav>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1480px] p-4 md:p-6">
              <PageTransition>
                <ErrorBoundary homePath="/portal" resetKey={location.pathname}>
                  <Outlet />
                </ErrorBoundary>
              </PageTransition>
            </div>
          </main>
        </div>
        <CommandDialog
          open={commandOpen}
          onOpenChange={setCommandOpen}
          title="포털 빠른 이동"
          description="포털 업무와 현재 사업 작업을 빠르게 찾아 이동합니다."
        >
          <CommandInput placeholder="업무, 담당 사업, 캐시플로, 제출 상태 검색..." />
          <CommandList>
            <CommandEmpty>일치하는 화면이 없습니다.</CommandEmpty>
            <CommandGroup heading="빠른 이동">
              {shellCommandItems.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description} ${item.keywords.join(' ')}`}
                  onSelect={() => {
                    setCommandOpen(false);
                    if (item.kind === 'admin') {
                      requestAdminNavigation();
                      return;
                    }
                    if (item.kind === 'project' && item.projectId) {
                      void setActiveProject(item.projectId).finally(() => {
                        requestPortalNavigation(item.to, item.label);
                      });
                      return;
                    }
                    requestPortalNavigation(item.to, item.label);
                  }}
                  className="flex items-center gap-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12px] font-medium text-slate-900">{item.label}</span>
                    <span className="text-[11px] text-slate-500">{item.description}</span>
                  </div>
                  <CommandShortcut>{item.category}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </CommandList>
        </CommandDialog>
      </div>
      </TooltipProvider>
    </PortalNavigationGuardContext.Provider>
  );
}

export function PortalLayout() {
  return (
    <PortalProvider>
      <PortalContent />
    </PortalProvider>
  );
}
