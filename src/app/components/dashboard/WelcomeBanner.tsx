import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  X, FolderKanban, BarChart3, Shield, Keyboard,
  ArrowRight, Sparkles,
} from 'lucide-react';
import { useAppStore } from '../../data/store';

const QUICK_ACTIONS = [
  {
    icon: FolderKanban,
    label: '사업 등록',
    desc: '새 사업을 위저드로 등록',
    path: '/projects/new',
    color: '#4f46e5',
  },
  {
    icon: BarChart3,
    label: '캐시플로 확인',
    desc: '입출금 흐름 모니터링',
    path: '/cashflow',
    color: '#0d9488',
  },
  {
    icon: Shield,
    label: '참여율 점검',
    desc: '100-1 참여율 위험 확인',
    path: '/participation',
    color: '#7c3aed',
  },
  {
    icon: Keyboard,
    label: '단축키 배우기',
    desc: '⌘/ 로 전체 보기',
    action: 'shortcuts' as const,
    color: '#f59e0b',
  },
];

export function WelcomeBanner() {
  const navigate = useNavigate();
  const { currentUser } = useAppStore();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('mysc-welcome-dismissed') === 'true';
    }
    return false;
  });
  const [exiting, setExiting] = useState(false);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => {
      setDismissed(true);
      localStorage.setItem('mysc-welcome-dismissed', 'true');
    }, 250);
  };

  if (dismissed) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '안녕하세요' : '수고하셨습니다';

  return (
    <div
      className="relative rounded-xl border border-primary/15 overflow-hidden transition-all duration-250"
      style={{
        background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--primary) 8%, var(--card)) 60%, color-mix(in srgb, var(--primary) 12%, var(--card)) 100%)',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateY(-8px) scale(0.99)' : 'translateY(0) scale(1)',
        maxHeight: exiting ? '0px' : '300px',
      }}
    >
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors z-10"
        aria-label="배너 닫기"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--ring))' }}
          >
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <h3 className="text-[15px] text-foreground" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            {greeting}, {currentUser.name}님!
          </h3>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4 max-w-[500px]">
          MYSC 사업관리 통합 플랫폼에서 모든 사업의 재무, 증빙, 참여율을 한눈에 관리하세요.
          빠른 시작을 위한 주요 기능을 아래에서 확인할 수 있습니다.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                if ('action' in action && action.action === 'shortcuts') {
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true }));
                } else if (action.path) {
                  navigate(action.path);
                }
              }}
              className="flex items-start gap-2.5 p-2.5 rounded-lg bg-card/60 hover:bg-card border border-border/30 hover:border-border/60 transition-all duration-150 group text-left hover:shadow-sm"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: action.color + '14' }}
              >
                <action.icon className="w-3.5 h-3.5" style={{ color: action.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground truncate" style={{ fontWeight: 600 }}>
                  {action.label}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {action.desc}
                </p>
              </div>
              <ArrowRight className="w-3 h-3 text-muted-foreground/40 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Decorative dot pattern */}
      <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] pointer-events-none">
        <svg viewBox="0 0 100 100" fill="currentColor" className="text-foreground">
          <circle cx="20" cy="20" r="2.5" />
          <circle cx="40" cy="20" r="2.5" />
          <circle cx="60" cy="20" r="2.5" />
          <circle cx="80" cy="20" r="2.5" />
          <circle cx="20" cy="40" r="2.5" />
          <circle cx="40" cy="40" r="2.5" />
          <circle cx="60" cy="40" r="2.5" />
          <circle cx="80" cy="40" r="2.5" />
          <circle cx="20" cy="60" r="2.5" />
          <circle cx="40" cy="60" r="2.5" />
          <circle cx="60" cy="60" r="2.5" />
          <circle cx="80" cy="60" r="2.5" />
          <circle cx="20" cy="80" r="2.5" />
          <circle cx="40" cy="80" r="2.5" />
          <circle cx="60" cy="80" r="2.5" />
          <circle cx="80" cy="80" r="2.5" />
        </svg>
      </div>
    </div>
  );
}
