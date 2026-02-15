import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, FolderKanban, BookOpen, BarChart3,
  FileCheck, Settings, ChevronLeft, ChevronRight,
  Bell, User, Plus, Shield, ClipboardList, ClipboardCheck,
  Search, Zap, HelpCircle, Maximize2, Minimize2,
  Menu, X, Calculator, Wallet, ExternalLink,
  ListChecks, Users, LogOut, Megaphone,
} from 'lucide-react';
import { useAppStore, AppProvider } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { useHrAnnouncements } from '../../data/hr-announcements-store';
import { FirebaseStatusBadge } from '../settings/FirebaseSetup';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import { CommandPalette } from './CommandPalette';
import { NotificationPanel } from './NotificationPanel';
import { Breadcrumbs } from './Breadcrumbs';
import { StatusBar } from './StatusBar';
import { DarkModeToggle } from './DarkModeToggle';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ScrollToTop } from './ScrollToTop';
import { QuickActionFab } from './QuickActionFab';
import { PageTransition } from './PageTransition';
import { resolveHomePath } from '../../platform/navigation';
import { canAccessAdminPath, canShowAdminNavItem } from '../../platform/admin-nav';

const NAV_GROUPS = [
  {
    label: '메인',
    items: [
      { to: '/', icon: LayoutDashboard, label: '대시보드' },
      { to: '/projects', icon: FolderKanban, label: '프로젝트' },
      { to: '/projects/new', icon: Plus, label: '사업 등록', accent: true },
    ],
  },
  {
    label: '재무관리',
    items: [
      { to: '/cashflow', icon: BarChart3, label: '캐시플로' },
      { to: '/evidence', icon: FileCheck, label: '증빙/정산' },
      { to: '/budget-summary', icon: Calculator, label: '예산총괄' },
      { to: '/expense-management', icon: Wallet, label: '사업비 관리' },
    ],
  },
  {
    label: '인력/참여율',
    items: [
      { to: '/participation', icon: Shield, label: '참여율 관리' },
      { to: '/koica-personnel', icon: ClipboardList, label: 'KOICA 인력배치' },
      { to: '/personnel-changes', icon: ClipboardCheck, label: '인력변경 관리' },
      { to: '/hr-announcements', icon: Megaphone, label: '인사 공지', accent: true },
    ],
  },
  {
    label: '시스템',
    items: [
      { to: '/approvals', icon: ListChecks, label: '승인 대기열', accent: true },
      { to: '/users', icon: Users, label: '사용자 관리' },
      { to: '/audit', icon: BookOpen, label: '감사로그' },
      { to: '/settings', icon: Settings, label: '설정' },
      { to: '/portal', icon: ExternalLink, label: '사용자 포털' },
    ],
  },
];

function AppLayoutContent() {
  const { org, currentUser, transactions, participationEntries, dataSource } = useAppStore();
  const { isAuthenticated, user: authUser, logout } = useAuth();
  const { getAllPendingCount: getHrPendingCount } = useHrAnnouncements();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Auth guard — 미인증 시 로그인 페이지로
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const role = (authUser || currentUser)?.role;
    if (!isAuthenticated || !role) return;
    const home = resolveHomePath(role);
    if (home === '/portal') {
      navigate('/portal', { replace: true });
      return;
    }

    if (!canAccessAdminPath(role, location.pathname)) {
      navigate(home, { replace: true });
    }
  }, [isAuthenticated, authUser, currentUser, location.pathname, navigate]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!isAuthenticated) return null;

  // 인증된 사용자 정보 (authUser 우선, fallback currentUser)
  const displayUser = authUser || currentUser;
  const navGroups = React.useMemo(() => {
    return NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canShowAdminNavItem(displayUser?.role, item.to)),
      }))
      .filter((group) => group.items.length > 0);
  }, [displayUser?.role]);

  const pendingCount = transactions.filter(t => t.state === 'SUBMITTED').length;
  const missingEvidenceCount = transactions.filter(t => t.evidenceStatus !== 'COMPLETE' && t.state !== 'REJECTED').length;

  const participationDangerCount = React.useMemo(() => {
    const memberMap = new Map<string, { eNara: number; orgs: Map<string, number> }>();
    participationEntries.forEach(e => {
      if (e.settlementSystem === 'NONE' || e.settlementSystem === 'PRIVATE') return;
      let m = memberMap.get(e.memberId);
      if (!m) { m = { eNara: 0, orgs: new Map() }; memberMap.set(e.memberId, m); }
      if (e.settlementSystem === 'E_NARA_DOUM') m.eNara += e.rate;
      const orgName = e.clientOrg.split('/')[0];
      m.orgs.set(orgName, (m.orgs.get(orgName) || 0) + e.rate);
    });
    let count = 0;
    memberMap.forEach(m => {
      if (m.eNara > 100) { count++; return; }
      for (const rate of m.orgs.values()) {
        if (rate > 100) { count++; return; }
      }
    });
    return count;
  }, [participationEntries]);

  const totalAlerts = pendingCount + (participationDangerCount > 0 ? participationDangerCount : 0);

  function getBadgeCount(to: string): number | null {
    if (to === '/evidence' && missingEvidenceCount > 0) return missingEvidenceCount;
    if (to === '/participation' && participationDangerCount > 0) return participationDangerCount;
    if (to === '/hr-announcements') {
      const hrCount = getHrPendingCount();
      return hrCount > 0 ? hrCount : null;
    }
    return null;
  }

  function isActive(to: string): boolean {
    if (to === '/') return location.pathname === '/';
    if (to === '/projects/new') return location.pathname.startsWith('/projects/new');
    if (to === '/projects') return location.pathname.startsWith('/projects') && !location.pathname.startsWith('/projects/new');
    return location.pathname.startsWith(to);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <CommandPalette />
      <KeyboardShortcuts />
      <div className="flex h-screen w-full overflow-hidden">
        {/* ━━━ Mobile Overlay ━━━ */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ━━━ Sidebar ━━━ */}
        <aside
          className={`flex flex-col transition-all duration-200 ease-out shrink-0
            ${collapsed ? 'w-[60px]' : 'w-[240px]'}
            fixed lg:relative inset-y-0 left-0 z-50
            ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
          `}
          style={{ background: '#0f172a' }}
        >
          {/* Brand */}
          <div className={`flex items-center gap-2.5 h-[48px] px-3 ${collapsed ? 'justify-center' : ''}`}>
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}
            >
              <Zap className="w-4 h-4 text-white" />
            </div>
            {!collapsed && (
              <div className="overflow-hidden flex-1">
                <p className="text-[13px] text-white truncate" style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {org.name}
                </p>
                <p className="text-[9px] text-slate-500 truncate tracking-wider" style={{ textTransform: 'uppercase' }}>
                  Business Platform
                </p>
              </div>
            )}
          </div>

          {/* Quick search */}
          {!collapsed && (
            <div className="px-2.5 mb-1">
              <button
                className="w-full flex items-center gap-2 h-[30px] px-2.5 rounded-md text-[11px] text-slate-500 bg-white/5 hover:bg-white/8 border border-slate-700/50 transition-colors"
                onClick={() => {
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
                }}
              >
                <Search className="w-3 h-3" />
                <span className="flex-1 text-left">빠른 검색...</span>
                <kbd className="text-[9px] text-slate-600 bg-slate-800 px-1 py-0.5 rounded">⌘K</kbd>
              </button>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 py-1.5 overflow-y-auto">
            {navGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'mt-2.5' : ''}>
                {!collapsed && (
                  <p className="px-4 pb-1 text-[9px] tracking-[0.08em] text-slate-600" style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                    {group.label}
                  </p>
                )}
                {collapsed && gi > 0 && <div className="mx-3 my-1.5 border-t border-slate-800" />}
                <div className="space-y-px px-2">
                  {group.items.map(item => {
                    const active = isActive(item.to);
                    const badge = getBadgeCount(item.to);
                    const accent = (item as any).accent;

                    const navLink = (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={`
                          group relative flex items-center gap-2 rounded-md text-[12px] transition-all duration-100
                          ${collapsed ? 'justify-center h-9 w-full' : 'px-2.5 py-[6px]'}
                          ${active
                            ? 'bg-indigo-500/15 text-white'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                          }
                        `}
                      >
                        {active && !collapsed && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 rounded-r bg-indigo-400" />
                        )}
                        <item.icon className={`w-[15px] h-[15px] shrink-0 ${
                          active ? 'text-indigo-400' : accent ? 'text-indigo-500/50' : 'text-slate-600 group-hover:text-slate-400'
                        }`} />
                        {!collapsed && (
                          <>
                            <span style={{ fontWeight: active ? 500 : 400 }}>{item.label}</span>
                            {badge !== null && (
                              <span className="ml-auto flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-rose-500/90 text-[9px] text-white px-1" style={{ fontWeight: 700 }}>
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
                          <TooltipContent side="right" className="text-[11px]" sideOffset={8}>
                            <div className="flex items-center gap-2">
                              {item.label}
                              {badge !== null && <span className="text-rose-400 text-[10px]" style={{ fontWeight: 600 }}>{badge}</span>}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return navLink;
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-slate-800 p-2 space-y-1.5">
            {!collapsed && (
              <div className="px-1 mb-1">
                <FirebaseStatusBadge />
              </div>
            )}
            <DarkModeToggle collapsed={collapsed} />
            {!collapsed && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.03]">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-[10px] text-white"
                  style={{ fontWeight: 700, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  {displayUser.name.charAt(0)}
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-[11px] text-slate-300 truncate" style={{ fontWeight: 500 }}>{displayUser.name}</p>
                  <p className="text-[9px] text-slate-600">{displayUser.role}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { logout(); navigate('/login'); }}
                      className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-slate-400 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">로그아웃</TooltipContent>
                </Tooltip>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="w-full flex items-center justify-center h-7 rounded-md text-slate-600 hover:text-slate-400 hover:bg-white/[0.04] transition-colors"
            >
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
          </div>
        </aside>

        {/* ━━━ Main ━━━ */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Top Header */}
          <header className="flex items-center justify-between h-[48px] border-b border-border/50 px-5 bg-card shrink-0">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                className="lg:hidden flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted transition-colors"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                <Menu className="w-4 h-4" />
              </button>
              <Breadcrumbs />
            </div>

            <div className="flex items-center gap-1.5">
              {/* Data source pill */}
              {dataSource === 'firestore' ? (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-800/40 rounded-full px-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  실시간
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted border border-border/60 rounded-full px-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                  로컬
                </div>
              )}

              <div className="w-px h-4 bg-border/50 mx-0.5" />

              {/* Search */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
                    }}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[11px]">검색 (⌘K)</TooltipContent>
              </Tooltip>

              {/* Keyboard shortcuts */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true }));
                    }}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[11px]">단축키 (⌘/)</TooltipContent>
              </Tooltip>

              {/* Notifications */}
              <NotificationPanel />

              <div className="w-px h-4 bg-border/50 mx-0.5" />

              {/* User avatar */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[10px] cursor-pointer"
                    style={{ fontWeight: 700, background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
                  >
                    {displayUser.name.charAt(0)}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-[11px]">{displayUser.name} ({displayUser.role})</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div className="p-5 max-w-[1600px] mx-auto">
              <PageTransition>
                <Outlet />
              </PageTransition>
            </div>
          </main>

          {/* Status Bar */}
          <StatusBar />
        </div>
      </div>
      <ScrollToTop />
      <QuickActionFab />
    </TooltipProvider>
  );
}

export function AppLayout() {
  return (
    <AppProvider>
      <AppLayoutContent />
    </AppProvider>
  );
}
