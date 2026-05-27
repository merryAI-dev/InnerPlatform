import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Plus, X, BarChart3, FileCheck,
  Shield, Zap,
} from 'lucide-react';
import { useAuth } from '../../data/auth-store';
import { canShowAdminNavItem } from '../../platform/admin-nav';
import { shouldShowShellRoute, useShellLabEnabled } from '../../platform/shell-lab-visibility';

const ACTIONS = [
  { icon: BarChart3, label: '캐시플로 모니터링', path: '/cashflow', color: '#0d9488' },
  { icon: FileCheck, label: '증빙/정산', path: '/evidence', color: '#f59e0b' },
  { icon: Shield, label: '승인 대기열', path: '/approvals', color: '#0891b2' },
];

export function QuickActionFab() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const fabRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const [labEnabled] = useShellLabEnabled();

  const visibleActions = ACTIONS.filter((action) => (
    canShowAdminNavItem(user?.role, action.path)
    && shouldShowShellRoute(action.path, 'admin', 'quick-action', { labEnabled })
  ));

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (visibleActions.length === 0) return null;

  return (
    <div ref={fabRef} className="fixed bottom-14 right-5 z-50 lg:hidden">
      {/* Backdrop blur when open */}
      {open && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px] -z-10 transition-opacity" />
      )}

      {/* Action items */}
      <div
        className="absolute bottom-14 right-0 flex flex-col-reverse gap-2 mb-2"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(8px)',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        }}
      >
        {visibleActions.map((action, i) => (
          <button
            key={action.path}
            onClick={() => {
              navigate(action.path);
              setOpen(false);
            }}
            className="flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-lg border border-border bg-card py-2 pl-3 pr-4 shadow-sm transition-all duration-150 hover:bg-accent active:scale-[0.98]"
            style={{
              transitionDelay: open ? `${i * 30}ms` : '0ms',
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(4px)',
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: action.color + '14' }}
            >
              <action.icon className="w-3.5 h-3.5" style={{ color: action.color }} />
            </div>
            <span className="text-[12px] text-foreground" style={{ fontWeight: 500 }}>
              {action.label}
            </span>
          </button>
        ))}
      </div>

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-12 w-12 items-center justify-center rounded-lg shadow-lg transition-all duration-200 active:scale-95"
        style={{
          background: open ? 'var(--muted)' : 'linear-gradient(135deg, #0891b2, #0f766e)',
          boxShadow: open
            ? '0 4px 12px rgba(0,0,0,0.1)'
            : '0 8px 24px rgba(8,145,178,0.28)',
        }}
      >
        <div
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(45deg)' : 'rotate(0deg)' }}
        >
          {open ? (
            <Plus className="w-5 h-5 text-foreground" />
          ) : (
            <Zap className="w-5 h-5 text-white" />
          )}
        </div>
      </button>
    </div>
  );
}
