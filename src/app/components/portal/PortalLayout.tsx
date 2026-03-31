import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, Calculator,
  LogOut,
  FolderKanban, Menu,
  Plus, Pencil,
  CircleDollarSign,
  BarChart3,
  ClipboardList,
  Loader2,
  Settings2,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  Upload,
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
import { DarkModeToggle } from '../layout/DarkModeToggle';
import { PageTransition } from '../layout/PageTransition';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { ClaudeSdkHelpWidget } from '../guide-chat/ClaudeSdkHelpWidget';
import {
  canChooseWorkspace,
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  resolveHomePath,
  shouldForcePortalOnboarding,
} from '../../platform/navigation';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';

// ═══════════════════════════════════════════════════════════════
// PortalLayout — 사용자(PM) 전용 레이아웃
// 하나의 사업만 볼 수 있는 간소화된 UI
// ═══════════════════════════════════════════════════════════════

const NAV_SECTIONS = [
  {
    title: '마이메뉴',
    items: [
      { to: '/portal', icon: LayoutDashboard, label: '내 사업 현황', exact: true },
      { to: '/portal/submissions', icon: ClipboardList, label: '내 제출 현황' },
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
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

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

  const currentProjectName = useMemo(() => {
    if (!portalUser?.projectId) return myProject?.name;
    const fromOptions = projectOptions.find((opt) => opt.id === portalUser.projectId)?.name;
    return fromOptions || myProject?.name;
  }, [portalUser?.projectId, projectOptions, myProject?.name]);


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
    const role = authUser?.role;
    if (!isAuthenticated || !role || !canChooseWorkspace(role)) return;
    // admin/finance가 portal을 잠깐 방문할 때 workspace를 덮어쓰지 않음
    if (isAdminSpaceRole(role)) return;
    if (authUser?.lastWorkspace === 'portal') return;
    void setWorkspacePreference('portal', { persistDefault: false });
  }, [authUser?.lastWorkspace, authUser?.role, isAuthenticated, setWorkspacePreference]);

  // 포털 미등록 시 온보딩으로 (인증은 되었지만 포털 사업 미선택)
  useEffect(() => {
    if (authLoading || portalLoading) return;
    if (shouldForcePortalOnboarding({
      isAuthenticated,
      role: authUser?.role,
      isRegistered,
      pathname: location.pathname,
    })) {
      navigate('/portal/project-settings', { replace: true });
    }
  }, [authLoading, portalLoading, isAuthenticated, authUser?.role, isRegistered, location.pathname, navigate]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-full overflow-hidden relative">
        {/* ── Mobile overlay ── */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* ── Sidebar ── */}
        <aside className={`
          w-[240px] flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 lg:relative
          transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          bg-sidebar/90 backdrop-blur-xl border-r border-white/10
        `}>
          {/* Brand */}
          <div className="flex items-center gap-2.5 h-[48px] px-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' }}
            >
              <FolderKanban className="w-4 h-4 text-white" />
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-[11px] text-white truncate" style={{ fontWeight: 700 }}>
                사업비 관리 포털
              </p>
              <p className="text-[9px] text-slate-500 truncate tracking-wider" style={{ textTransform: 'uppercase' }}>
                Project Member
              </p>
            </div>
          </div>

          {/* 사업 정보 카드 */}
          {myProject && (
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
                onClick={() => navigate('/portal/project-settings')}
              >
                사업 배정 수정
              </Button>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 py-1 overflow-y-auto">
            <div className="space-y-3 px-2">
              {NAV_SECTIONS.map((section) => {
                const visibleItems = section.items.filter((item) => !('hidden' in item && item.hidden));
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.title} className="space-y-1">
                    <p className="px-2.5 text-[10px] text-slate-500 tracking-wide" style={{ fontWeight: 700 }}>
                      {section.title}
                    </p>
                    <div className="space-y-px">
                      {visibleItems.map((item) => {
                        const active = isActive(item.to, item.exact);
                        const badge = getBadge(item.to);
                        return (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.exact}
                            className={`
                              group relative flex items-center gap-2 rounded-md text-[12px] px-2.5 py-[7px] transition-all duration-100
                              ${active
                                ? 'bg-teal-500/18 text-white backdrop-blur-sm'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/8'
                              }
                            `}
                          >
                            {active && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r bg-teal-400" />
                            )}
                            <item.icon className={`w-[15px] h-[15px] shrink-0 ${active ? 'text-teal-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
                            <span style={{ fontWeight: active ? 500 : 400 }}>{item.label}</span>
                            {item.to === '/portal/register-project' && authUser?.role === 'viewer' && (
                              <span className="ml-auto text-[8px] px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/20" style={{ fontWeight: 600 }}>
                                등록 가능
                              </span>
                            )}
                            {badge !== null && (
                              <span className="ml-auto flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-teal-500/90 text-[9px] text-white px-1" style={{ fontWeight: 700 }}>
                                {badge}
                              </span>
                            )}
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </nav>

          {/* Footer */}
          <div className="border-t border-white/10 p-2 space-y-1.5">
            <DarkModeToggle collapsed={false} />
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
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Top bar */}
          <header className="glass sticky top-0 z-30 flex items-center justify-between h-[48px] border-b border-glass-border px-5 shrink-0">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <button className="lg:hidden p-1 rounded hover:bg-muted" onClick={() => setMobileOpen(true)}>
                <Menu className="w-4 h-4" />
              </button>
              <FolderKanban className="w-3.5 h-3.5" />
              <span className="truncate">{currentProjectName || '사업 미선택'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] h-5 px-2">
                {portalUser.role}
              </Badge>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div className="p-5 max-w-[1400px] mx-auto">
              <PageTransition>
                <ErrorBoundary homePath="/portal" resetKey={location.pathname}>
                  <Outlet />
                </ErrorBoundary>
              </PageTransition>
            </div>
          </main>
        </div>
      </div>
      <ClaudeSdkHelpWidget />
    </TooltipProvider>
  );
}

export function PortalLayout() {
  return (
    <PortalProvider>
      <PortalContent />
    </PortalProvider>
  );
}
