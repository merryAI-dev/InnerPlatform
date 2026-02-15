import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Plus, X, FolderKanban, BarChart3, FileCheck,
  Shield, Zap,
} from 'lucide-react';

const ACTIONS = [
  { icon: FolderKanban, label: '새 사업 등록', path: '/projects/new', color: '#4f46e5' },
  { icon: BarChart3, label: '캐시플로', path: '/cashflow', color: '#0d9488' },
  { icon: FileCheck, label: '증빙/정산', path: '/evidence', color: '#f59e0b' },
  { icon: Shield, label: '참여율 관리', path: '/participation', color: '#7c3aed' },
];

export function QuickActionFab() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const fabRef = useRef<HTMLDivElement>(null);

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
        {ACTIONS.map((action, i) => (
          <button
            key={action.path}
            onClick={() => {
              navigate(action.path);
              setOpen(false);
            }}
            className="flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-xl bg-card border border-border/60 shadow-lg shadow-black/8 whitespace-nowrap hover:shadow-xl active:scale-[0.98] transition-all duration-150"
            style={{
              transitionDelay: open ? `${i * 30}ms` : '0ms',
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(4px)',
            }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
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
        className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-200 active:scale-95"
        style={{
          background: open ? 'var(--muted)' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          boxShadow: open
            ? '0 4px 12px rgba(0,0,0,0.1)'
            : '0 8px 24px rgba(79,70,229,0.35)',
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
