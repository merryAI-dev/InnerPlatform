import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowRight, CheckCircle2, FolderKanban, Loader2, Search, Shield, Sparkles } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { useAuth } from '../../data/auth-store';
import {
  canChooseWorkspace,
  resolveActiveWorkspacePreference,
  resolvePostLoginPath,
  resolveRequestedRedirectPath,
  resolveWorkspaceSelectionPath,
  shouldPromptWorkspaceSelection,
} from '../../platform/navigation';
import { canAccessAdminPath } from '../../platform/admin-nav';
import type { WorkspaceId } from '../../data/member-workspace';
import { MyscWordmark } from '../brand/MyscWordmark';

const ADMIN_WORKSPACE_FEATURES = [
  '기능 검색',
  '대시보드',
  '프로젝트',
  '프로젝트 등록/승인',
  '캐시플로 모니터링',
  '권한/사용자',
];

const PM_WORKSPACE_FEATURES = [
  '내 프로젝트 현황',
  '예산 편집',
  '사업비 입력',
  '캐시플로',
  '프로젝트 등록 요청',
  '인건비/공지',
];

export function WorkspaceSelectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, setWorkspacePreference } = useAuth();
  const [pending, setPending] = useState<WorkspaceId | null>(null);
  const [error, setError] = useState('');
  const redirectFrom = resolveRequestedRedirectPath(
    (location.state as { from?: string } | null)?.from,
    location.search,
  );
  const activeWorkspace = resolveActiveWorkspacePreference(user?.lastWorkspace, user?.defaultWorkspace);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      navigate('/login', { replace: true });
      return;
    }
    if (!canChooseWorkspace(user.role)) {
      navigate(resolvePostLoginPath(user.role, activeWorkspace, redirectFrom), { replace: true });
      return;
    }
    if (!shouldPromptWorkspaceSelection(user.role, activeWorkspace)) {
      navigate(resolvePostLoginPath(user.role, activeWorkspace, redirectFrom), { replace: true });
    }
  }, [activeWorkspace, isAuthenticated, isLoading, navigate, redirectFrom, user]);

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
    navigate(resolveWorkspaceSelectionPath(user.role, workspace, redirectFrom), { replace: true });
  };

  if (
    isLoading
    || !isAuthenticated
    || !user
    || !canChooseWorkspace(user.role)
    || !shouldPromptWorkspaceSelection(user.role, activeWorkspace)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentWorkspace = activeWorkspace;
  const canAccessAdmin = canAccessAdminPath(user.role, '/');
  const portalRequested = !!redirectFrom?.startsWith('/portal');
  const adminRequested = !!redirectFrom && !portalRequested;

  return (
    <div className="flex min-h-dvh bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-none">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-800 bg-[#001e46] px-5 py-5 text-white md:px-7">
            <MyscWordmark tone="onDark" size="md" />
          </div>
          <div className="space-y-6 px-5 py-6 md:px-7 md:py-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="w-full">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Search className="h-3.5 w-3.5" />
                  시작 공간 선택
                </div>
                <h1 className="mt-4 text-[30px] font-extrabold leading-tight text-slate-950 dark:text-slate-50 md:text-[38px]">
                  어느 공간에서 시작할까요?
                </h1>
                <p className="mt-3 text-[14px] leading-6 text-slate-600 dark:text-slate-300">
                  로그인 직후 자주 쓰는 업무 화면을 기준으로 관리자와 PM 포털을 구분해 보여줍니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px] font-semibold">
                <span className="rounded-full border border-sky-200/80 bg-sky-50/75 px-3 py-1 text-sky-800 shadow-sm backdrop-blur-md dark:border-sky-400/20 dark:bg-sky-950/40 dark:text-sky-200">
                  관리자
                </span>
                <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  PM
                </span>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="flex min-h-[360px] flex-col justify-between rounded-lg border border-white/60 bg-sky-50/50 p-5 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-sky-400/20 dark:bg-sky-950/25">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-white/40 bg-sky-800/90 text-white shadow-lg shadow-sky-900/20 backdrop-blur-md dark:bg-sky-300/90 dark:text-sky-950">
                      <Shield className="h-6 w-6" />
                    </div>
                    {adminRequested && (
                      <Badge variant="outline" className="border-white/70 bg-white/60 text-sky-800 shadow-sm backdrop-blur-md dark:border-sky-400/20 dark:bg-slate-950/50 dark:text-sky-200">
                        요청 화면 기준
                      </Badge>
                    )}
                  </div>
                  <div>
                    <h2 className="text-[20px] font-bold text-sky-950 dark:text-sky-100">관리자 공간</h2>
                    <p className="mt-2 text-[13px] leading-6 text-sky-900/75 dark:text-sky-100/70">
                      프로젝트 운영, 등록/승인, 캐시플로 관제, 권한 관리로 이동합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ADMIN_WORKSPACE_FEATURES.map((feature) => (
                      <span
                        key={feature}
                        className="rounded-full border border-white/70 bg-white/60 px-3 py-1 text-[12px] font-semibold text-sky-900 shadow-sm backdrop-blur-md dark:border-sky-400/20 dark:bg-slate-950/50 dark:text-sky-200"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-2 text-[12px] text-sky-900/75 dark:text-sky-100/70">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                      승인, 조직, 권한처럼 관리 기준으로 찾는 화면
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                      운영 상태와 프로젝트 목록을 한 번에 확인
                    </div>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  <Button
                    className="h-11 w-full gap-2 border border-sky-700/40 bg-sky-800/90 text-white shadow-lg shadow-sky-900/20 backdrop-blur-md hover:bg-sky-900/95"
                    variant={currentWorkspace === 'admin' ? 'default' : 'outline'}
                    disabled={pending !== null || !canAccessAdmin}
                    onClick={() => void handleSelect('admin')}
                  >
                    {pending === 'admin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    관리자 공간으로 계속
                  </Button>
                  {!canAccessAdmin && (
                    <p className="text-center text-[11px] text-sky-900/60 dark:text-sky-100/50">
                      현재 이 계정은 관리자 공간 접근이 제한되어 있습니다
                    </p>
                  )}
                </div>
              </section>

              <section className="flex min-h-[360px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-[#001e46] text-white shadow-sm dark:border-slate-700">
                      <FolderKanban className="h-6 w-6" />
                    </div>
                    {(portalRequested || !canAccessAdmin) && (
                      <Badge variant="outline" className="border-slate-300 bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                        <Sparkles className="mr-1 h-3 w-3" />
                        추천
                      </Badge>
                    )}
                  </div>
                  <div>
                    <h2 className="text-[20px] font-bold text-slate-950 dark:text-slate-100">PM 포털</h2>
                    <p className="mt-2 text-[13px] leading-6 text-slate-600 dark:text-slate-300">
                      담당 프로젝트 현황, 예산 편집, 사업비 입력, 프로젝트 등록 요청으로 이동합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PM_WORKSPACE_FEATURES.map((feature) => (
                      <span
                        key={feature}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                      내 프로젝트 기준으로 입력과 확인을 진행
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                      사업비, 예산, 캐시플로 흐름을 같은 공간에서 처리
                    </div>
                  </div>
                </div>
                <Button
                  className="mt-5 h-11 w-full gap-2 border border-[#001e46] bg-[#001e46] text-white shadow-sm hover:bg-[#001735]"
                  disabled={pending !== null}
                  onClick={() => void handleSelect('portal')}
                >
                  {pending === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  PM 포털로 계속
                </Button>
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
