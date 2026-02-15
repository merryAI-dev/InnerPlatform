import { useNavigate } from 'react-router';
import { Home, ArrowLeft, Search, Zap } from 'lucide-react';
import { Button } from '../ui/button';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      {/* Decorative 404 */}
      <div className="relative mb-8 select-none">
        <div
          className="text-[120px] md:text-[160px] leading-none"
          style={{
            fontWeight: 900,
            letterSpacing: '-0.06em',
            background: 'linear-gradient(135deg, var(--border) 0%, var(--muted-foreground) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            opacity: 0.5,
          }}
        >
          404
        </div>
        {/* Brand icon overlay */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--ring))',
            boxShadow: '0 8px 24px color-mix(in srgb, var(--primary) 30%, transparent)',
          }}
        >
          <Zap className="w-6 h-6 text-white" />
        </div>
      </div>

      <h1
        className="text-[20px] text-foreground mb-2"
        style={{ fontWeight: 800, letterSpacing: '-0.03em' }}
      >
        페이지를 찾을 수 없습니다
      </h1>
      <p className="text-[13px] text-muted-foreground max-w-[400px] leading-relaxed mb-8">
        요청하신 경로가 존재하지 않거나 이동되었을 수 있습니다.
        아래 버튼을 눌러 대시보드로 돌아가거나 커맨드 팔레트(⌘K)에서 원하는 기능을 검색해보세요.
      </p>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="gap-1.5 h-9 text-xs"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          이전 페이지
        </Button>
        <Button
          className="gap-1.5 h-9 text-xs text-white"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--ring))' }}
          onClick={() => navigate('/')}
        >
          <Home className="w-3.5 h-3.5" />
          대시보드로
        </Button>
        <Button
          variant="ghost"
          className="gap-1.5 h-9 text-xs text-muted-foreground"
          onClick={() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
          }}
        >
          <Search className="w-3.5 h-3.5" />
          검색
          <kbd className="text-[9px] bg-muted border border-border/60 px-1 py-0.5 rounded ml-0.5">⌘K</kbd>
        </Button>
      </div>

      {/* Quick links */}
      <div className="mt-10 flex flex-wrap justify-center gap-2">
        {[
          { label: '프로젝트', path: '/projects' },
          { label: '캐시플로', path: '/cashflow' },
          { label: '증빙/정산', path: '/evidence' },
          { label: '참여율', path: '/participation' },
          { label: '설정', path: '/settings' },
        ].map(link => (
          <button
            key={link.path}
            onClick={() => navigate(link.path)}
            className="text-[11px] text-muted-foreground hover:text-primary hover:bg-accent px-2.5 py-1 rounded-md transition-colors"
          >
            {link.label}
          </button>
        ))}
      </div>
    </div>
  );
}
