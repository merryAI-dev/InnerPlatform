import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowRight, FolderKanban, Loader2, Shield } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useAuth } from '../../data/auth-store';
import { canChooseWorkspace, isAdminSpaceRole, resolvePostLoginPath } from '../../platform/navigation';
import type { WorkspaceId } from '../../data/member-workspace';

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading, user, setWorkspacePreference } = useAuth();
  const [pending, setPending] = useState<WorkspaceId | null>(null);
  const [error, setError] = useState('');
  const redirectFrom = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      navigate('/login', { replace: true, state: redirectFrom ? { from: redirectFrom } : undefined });
      return;
    }
    if (!canChooseWorkspace(user.role)) {
      navigate(resolvePostLoginPath(user.role, user.defaultWorkspace ?? user.lastWorkspace, redirectFrom), { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, redirectFrom, user]);

  const handleSelect = async (workspace: WorkspaceId) => {
    if (!user) return;
    setError('');
    setPending(workspace);
    const ok = await setWorkspacePreference(workspace, { persistDefault: true });
    setPending(null);
    if (!ok) {
      setError('공간 선택을 저장하지 못했습니다. 다시 시도해 주세요.');
      return;
    }
    // workspace를 명시 선택했으면, redirectFrom이 다른 공간이면 무시
    const effectiveRedirect = (() => {
      if (!redirectFrom) return undefined;
      const isPortalPath = redirectFrom === '/portal' || redirectFrom.startsWith('/portal/');
      if (workspace === 'admin' && isPortalPath) return undefined;
      if (workspace === 'portal' && !isPortalPath && redirectFrom !== '/') return undefined;
      return redirectFrom;
    })();
    const target = resolvePostLoginPath(user.role, workspace, effectiveRedirect);
    navigate(target, { replace: true });
  };

  if (isLoading || !isAuthenticated || !user || !canChooseWorkspace(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentWorkspace = user.defaultWorkspace ?? user.lastWorkspace;
  const canAccessAdmin = isAdminSpaceRole(user.role);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-teal-50/20 dark:from-slate-950 dark:via-indigo-950/10 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-[28px] text-foreground mb-2" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            어떤 공간으로 들어갈까요?
          </h1>
          <p className="text-[13px] text-muted-foreground">
            관리자 계정은 관리자 화면과 PM 포털 화면 중 하나를 기본 진입점으로 저장할 수 있습니다.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/60 shadow-lg shadow-black/5">
            <CardContent className="p-6 space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-[18px]" style={{ fontWeight: 700 }}>관리자 공간</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  설정, 사용자 관리, 조직 단위 운영 화면으로 이동합니다.
                </p>
              </div>
              <Button
                className="w-full h-11 gap-2"
                variant={currentWorkspace === 'admin' ? 'default' : 'outline'}
                disabled={pending !== null || !canAccessAdmin}
                onClick={() => void handleSelect('admin')}
              >
                {pending === 'admin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                관리자 공간으로 계속
              </Button>
              {!canAccessAdmin && (
                <p className="text-[11px] text-muted-foreground/60 text-center">관리자/재무 역할만 접근할 수 있습니다</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-lg shadow-black/5">
            <CardContent className="p-6 space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white">
                <FolderKanban className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-[18px]" style={{ fontWeight: 700 }}>PM 포털 공간</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  예산 편집, 통장내역, 주간 사업비 같은 PM 실무 화면으로 이동합니다.
                </p>
              </div>
              <Button
                className="w-full h-11 gap-2"
                style={{ background: 'linear-gradient(135deg, #0f766e, #0d9488)' }}
                disabled={pending !== null}
                onClick={() => void handleSelect('portal')}
              >
                {pending === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                PM 포털로 계속
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
