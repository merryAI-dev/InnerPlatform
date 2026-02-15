import { useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import { MessagesSquare, Home, LogOut } from 'lucide-react';
import { useAuth } from '../../data/auth-store';
import { resolveHomePath } from '../../platform/navigation';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { DarkModeToggle } from '../layout/DarkModeToggle';

export function BoardLayout() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const homePath = resolveHomePath(user?.role);
  const home = { to: homePath, label: homePath === '/portal' ? '포털' : '대시보드' };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, rgba(15,23,42,0.03) 0%, rgba(15,23,42,0) 40%)' }}>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' }}>
              <MessagesSquare className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[13px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>전사 게시판</p>
              <p className="text-[11px] text-muted-foreground">Q&A · 아이디어 · 도움요청</p>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-1.5">
            <NavLink to={home.to}>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                <Home className="w-3.5 h-3.5" />
                {home.label}
              </Button>
            </NavLink>
            <NavLink to="/board">
              <Button
                variant={location.pathname.startsWith('/board') ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 gap-1.5"
              >
                <MessagesSquare className="w-3.5 h-3.5" />
                게시판
              </Button>
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <DarkModeToggle />
            {user?.name && (
              <Badge variant="outline" className="hidden md:inline-flex text-[11px]">
                {user.name}
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => logout()}>
              <LogOut className="w-3.5 h-3.5" />
              로그아웃
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
