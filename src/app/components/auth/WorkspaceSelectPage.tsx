import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, FolderKanban, Shield, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useAuth } from '../../data/auth-store';
import { canChooseWorkspace, resolveHomePath } from '../../platform/navigation';
import type { WorkspaceId } from '../../data/member-workspace';

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, setWorkspacePreference } = useAuth();
  const [pending, setPending] = useState<WorkspaceId | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      navigate('/login', { replace: true });
      return;
    }
    if (!canChooseWorkspace(user.role)) {
      navigate(resolveHomePath(user.role, user.defaultWorkspace ?? user.lastWorkspace), { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, user]);

  const handleSelect = async (workspace: WorkspaceId) => {
    setError('');
    setPending(workspace);
    const ok = await setWorkspacePreference(workspace, { persistDefault: true });
    setPending(null);

    if (!ok) {
      setError('공간 선택을 저장하지 못했습니다. 다시 시도해 주세요.');
      return;
    }

    navigate(workspace === 'portal' ? '/portal' : '/', { replace: true });
  };

  if (isLoading || !isAuthenticated || !user || !canChooseWorkspace(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentWorkspace = user.defaultWorkspace ?? user.lastWorkspace;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-teal-50/20 dark:from-slate-950 dark:via-indigo-950/10 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-[28px] text-foreground mb-2" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            어떤 공간으로 들어갈까요?
          </h1>
          <p className="text-[13px] text-muted-foreground">
            관리자 계정은 업무 맥락에 따라 관리자 화면과 PM 포털 화면 중 하나를 기본 진입점으로 저장할 수 있습니다.
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
                  대시보드, 사용자 관리, 프로젝트/재무 설정처럼 조직 전체를 다루는 화면으로 바로 이동합니다.
                </p>
              </div>
              <Button
                className="w-full h-11 gap-2"
                variant={currentWorkspace === 'admin' ? 'default' : 'outline'}
                disabled={pending !== null}
                onClick={() => handleSelect('admin')}
              >
                {pending === 'admin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                관리자 공간으로 계속
              </Button>
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
                  사업 배정, 주간 사업비 입력, 셀 메모처럼 실제 PM 흐름으로 바로 들어갑니다.
                </p>
              </div>
              <Button
                className="w-full h-11 gap-2"
                style={{ background: 'linear-gradient(135deg, #0f766e, #0d9488)' }}
                disabled={pending !== null}
                onClick={() => handleSelect('portal')}
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
