import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, Wallet, Calculator, Users,
  ArrowRightLeft, LogOut,
  FolderKanban, Menu, X,
  Plus,
  MessagesSquare,
  CircleDollarSign,
} from 'lucide-react';
import { PortalProvider, usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { useHrAnnouncements } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { DarkModeToggle } from '../layout/DarkModeToggle';
import { PageTransition } from '../layout/PageTransition';
import { resolveHomePath } from '../../platform/navigation';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';

// ═══════════════════════════════════════════════════════════════
// PortalLayout — 사용자(PM) 전용 레이아웃
// 하나의 사업만 볼 수 있는 간소화된 UI
// ═══════════════════════════════════════════════════════════════

const NAV_ITEMS = [
  { to: '/portal', icon: LayoutDashboard, label: '내 사업 현황', exact: true },
  { to: '/portal/board', icon: MessagesSquare, label: '전사 게시판' },
  { to: '/portal/payroll', icon: CircleDollarSign, label: '인건비/공지', accent: true },
  { to: '/portal/budget', icon: Calculator, label: '예산총괄' },
  { to: '/portal/expenses', icon: Wallet, label: '사업비 입력' },
  { to: '/portal/personnel', icon: Users, label: '인력 현황' },
  { to: '/portal/change-requests', icon: ArrowRightLeft, label: '인력변경 신청' },
  { to: '/portal/register-project', icon: Plus, label: '사업 등록 제안', accent: true },
];

function PortalContent() {
  const { isRegistered, portalUser, myProject, logout: portalLogout, expenseSets, changeRequests } = usePortalStore();
  const { isAuthenticated, user: authUser, logout: authLogout } = useAuth();
  const { getUnacknowledgedCount } = useHrAnnouncements();
  const { runs, monthlyCloses } = usePayroll();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // 미인증 시 로그인으로
  useEffect(() => {
    if (!isAuthenticated && !location.pathname.includes('/portal/onboarding')) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, location.pathname, navigate]);

  useEffect(() => {
    const role = authUser?.role;
    if (!isAuthenticated || !role) return;
    if (resolveHomePath(role) === '/') {
      if (location.pathname.startsWith('/portal/board')) {
        const suffix = location.pathname.slice('/portal'.length);
        navigate(suffix, { replace: true });
        return;
      }

      navigate('/', { replace: true });
    }
  }, [isAuthenticated, authUser, location.pathname, navigate]);

  // 포털 미등록 시 온보딩으로 (인증은 되었지만 포털 사업 미선택)
  useEffect(() => {
    if (isAuthenticated && !isRegistered && !location.pathname.includes('/portal/onboarding')) {
      navigate('/portal/onboarding', { replace: true });
    }
  }, [isAuthenticated, isRegistered, location.pathname, navigate]);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // 온보딩 페이지면 레이아웃 없이 렌더
  if (location.pathname.includes('/portal/onboarding')) {
    return <Outlet />;
  }

  if (!isRegistered || !portalUser) return null;

  // 배지 카운트
  const myExpenses = expenseSets.filter(s => s.projectId === portalUser.projectId);
  const draftCount = myExpenses.filter(s => s.status === 'DRAFT').length;
  const rejectedCount = myExpenses.filter(s => s.status === 'REJECTED').length;
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
    if (to === '/portal/expenses' && (draftCount + rejectedCount) > 0) return draftCount + rejectedCount;
    if (to === '/portal/payroll' && payrollPendingCount > 0) return payrollPendingCount;
    if (to === '/portal/change-requests') {
      const total = pendingChanges + hrAlertCount;
      return total > 0 ? total : null;
    }
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-full overflow-hidden">
        {/* ── Mobile overlay ── */}
        {mobileOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
        )}

        {/* ── Sidebar ── */}
        <aside className={`
          w-[240px] flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 lg:relative
          transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `} style={{ background: '#0f172a' }}>
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
            <div className="mx-2.5 mb-2 p-2.5 rounded-lg bg-white/[0.05] border border-slate-700/50">
              <p className="text-[10px] text-slate-500 mb-0.5">내 사업</p>
              <p className="text-[11px] text-white truncate" style={{ fontWeight: 600 }}>
                {myProject.name.length > 28 ? myProject.name.slice(0, 28) + '...' : myProject.name}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge className="text-[8px] h-3.5 px-1 bg-teal-500/20 text-teal-300 border-0">
                  {myProject.clientOrg || ''}
                </Badge>
                <span className="text-[9px] text-slate-600">{myProject.department}</span>
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 py-1 overflow-y-auto">
            <div className="space-y-px px-2">
              {NAV_ITEMS.map(item => {
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
                        ? 'bg-teal-500/15 text-white'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                      }
                    `}
                  >
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r bg-teal-400" />
                    )}
                    <item.icon className={`w-[15px] h-[15px] shrink-0 ${active ? 'text-teal-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
                    <span style={{ fontWeight: active ? 500 : 400 }}>{item.label}</span>
                    {badge !== null && (
                      <span className="ml-auto flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-teal-500/90 text-[9px] text-white px-1" style={{ fontWeight: 700 }}>
                        {badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>

          </nav>

          {/* Footer */}
          <div className="border-t border-slate-800 p-2 space-y-1.5">
            <DarkModeToggle collapsed={false} />
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.03]">
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
                    className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors"
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
          <header className="flex items-center justify-between h-[48px] border-b border-border/50 px-5 bg-card shrink-0">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <button className="lg:hidden p-1 rounded hover:bg-muted" onClick={() => setMobileOpen(true)}>
                <Menu className="w-4 h-4" />
              </button>
              <FolderKanban className="w-3.5 h-3.5" />
              <span className="truncate">{myProject?.name || '사업 미선택'}</span>
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
                <Outlet />
              </PageTransition>
            </div>
          </main>
        </div>
      </div>
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
