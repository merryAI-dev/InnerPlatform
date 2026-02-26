import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  FolderKanban,
  ArrowRight,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useAuth } from '../../data/auth-store';
import { resolveHomePath } from '../../platform/navigation';

// ═══════════════════════════════════════════════════════════════
// LoginPage — 통합 로그인 페이지
// 역할에 따라 admin(/) 또는 portal(/portal) 로 라우팅
// ═══════════════════════════════════════════════════════════════

export function LoginPage() {
  const navigate = useNavigate();
  const {
    loginWithGoogle,
    isLoading,
    isAuthenticated,
    isFirebaseAuthEnabled,
    user,
  } = useAuth();
  const [error, setError] = useState('');

  // 이미 인증된 사용자는 역할에 맞는 페이지로 리다이렉트
  useEffect(() => {
    if (isAuthenticated && user) {
      const target = resolveHomePath(user.role);
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  if (isAuthenticated && user) return null;

  const handleLogin = async () => {
    setError('');
    const result = await loginWithGoogle();
    if (!result.success) {
      setError(result.error || 'Google 로그인에 실패했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-teal-50/20 dark:from-slate-950 dark:via-indigo-950/10 dark:to-teal-950/5 flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        {/* ── Brand Header ── */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20"
            style={{ background: 'linear-gradient(135deg, #312e81 0%, #4f46e5 50%, #0d9488 100%)' }}
          >
            <FolderKanban className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-[24px] text-foreground mb-1" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            MYSC 사업관리
          </h1>
          <p className="text-[13px] text-muted-foreground">
            통합 플랫폼에 로그인하세요
          </p>
        </div>

        {/* ── Login Form ── */}
        <Card className="shadow-xl shadow-black/5 dark:shadow-black/20 border-border/50">
          <CardContent className="p-6">
            <div className="space-y-4">
              {!isFirebaseAuthEnabled && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200/60 text-amber-700 text-[12px]">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Firebase Auth가 비활성화되어 있습니다. 환경 설정을 확인해 주세요.</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-[12px]">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="button"
                className="w-full h-11 text-[13px] gap-2"
                disabled={isLoading || !isFirebaseAuthEnabled}
                onClick={() => handleLogin()}
                style={{ background: 'linear-gradient(135deg, #312e81, #4f46e5)' }}
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Google 인증 중...</>
                ) : (
                  <>Google 계정으로 로그인 <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground text-center">
                `mysc.co.kr` 계정만 로그인할 수 있습니다.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/60 mt-6">
          MYSC(마이에스씨) 사업관리 통합 플랫폼 v1.0
        </p>
      </div>
    </div>
  );
}
