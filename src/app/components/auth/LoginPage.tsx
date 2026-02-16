import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  FolderKanban, Mail, Lock, ArrowRight, Eye, EyeOff,
  Shield, Users, BarChart3, BookOpen, Zap, AlertCircle,
  Loader2, UserPlus, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';
import { useAuth } from '../../data/auth-store';
import { featureFlags } from '../../config/feature-flags';
import { resolveHomePath } from '../../platform/navigation';

// ═══════════════════════════════════════════════════════════════
// LoginPage — 통합 로그인 페이지
// 역할에 따라 admin(/) 또는 portal(/portal) 로 라우팅
// ═══════════════════════════════════════════════════════════════

export function LoginPage() {
  const navigate = useNavigate();
  const {
    login,
    loginWithGoogle,
    loginAsDemo,
    isLoading,
    isAuthenticated,
    isFirebaseAuthEnabled,
    user,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [showDemoPanel, setShowDemoPanel] = useState(false);

  // 이미 인증된 사용자는 역할에 맞는 페이지로 리다이렉트
  useEffect(() => {
    if (isAuthenticated && user) {
      const target = resolveHomePath(user.role);
      navigate(target, { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  if (isAuthenticated && user) return null;

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');

    if (isFirebaseAuthEnabled) {
      const result = await loginWithGoogle();
      if (!result.success) {
        setError(result.error || 'Google 로그인에 실패했습니다.');
      }
      return;
    }

    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해 주세요');
      return;
    }

    const result = await login(email, password);
    if (!result.success) {
      setError(result.error || '로그인에 실패했습니다');
    }
  };

  const handleDemoLogin = (role: 'admin' | 'pm' | 'finance' | 'auditor') => {
    loginAsDemo(role);
    navigate(resolveHomePath(role), { replace: true });
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
            {isFirebaseAuthEnabled ? (
              <div className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-[12px]">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full h-11 text-[13px] gap-2"
                  disabled={isLoading}
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
                  로그인 후 권한은 Firestore `members.role`을 기준으로 적용됩니다.
                </p>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-[12px]">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Email */}
                <div>
                  <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    이메일
                  </Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    placeholder="user@mysc.co.kr"
                    className="h-11 text-[13px]"
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                {/* Password */}
                <div>
                  <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                    비밀번호
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(''); }}
                      placeholder="비밀번호 입력"
                      className="h-11 text-[13px] pr-10"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Login Button */}
                <Button
                  type="submit"
                  className="w-full h-11 text-[13px] gap-2"
                  disabled={isLoading}
                  style={{ background: 'linear-gradient(135deg, #312e81, #4f46e5)' }}
                >
                  {isLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 로그인 중...</>
                  ) : (
                    <>로그인 <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            <Separator className="my-5" />

            {/* Register link */}
            <Link
              to="/portal/onboarding"
              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 border border-border/50 transition-colors group"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-50 dark:bg-teal-950/30">
                  <UserPlus className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <p className="text-[12px]" style={{ fontWeight: 600 }}>포털 초기 등록/사업 설정</p>
                  <p className="text-[10px] text-muted-foreground">최초 1회 등록 후에는 동일 화면에서 사업 배정을 수정할 수 있습니다</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>

            <Separator className="my-5" />

            {/* Demo Access */}
            {!isFirebaseAuthEnabled && featureFlags.demoLoginEnabled && (
              <div>
              <button
                onClick={() => setShowDemoPanel(!showDemoPanel)}
                className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
              >
                <Zap className="w-3 h-3" />
                데모 계정으로 빠른 접속
                <ChevronRight className={`w-3 h-3 transition-transform ${showDemoPanel ? 'rotate-90' : ''}`} />
              </button>

              {showDemoPanel && (
                <div className="mt-3 space-y-2">
                  {[
                    { role: 'admin' as const, label: '관리자', desc: '모든 사업·재무·사용자 관리', icon: Shield, gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)', email: 'admin@mysc.co.kr' },
                    { role: 'pm' as const, label: 'PM (사업담당)', desc: '배정 사업의 재무·인력 관리', icon: FolderKanban, gradient: 'linear-gradient(135deg, #0d9488, #059669)', email: 'dana@mysc.co.kr' },
                    { role: 'finance' as const, label: '재무팀', desc: '모든 사업 재무 조회·승인', icon: BarChart3, gradient: 'linear-gradient(135deg, #059669, #0d9488)', email: 'finance@mysc.co.kr' },
                    { role: 'auditor' as const, label: '감사', desc: '읽기 전용 + 감사로그', icon: BookOpen, gradient: 'linear-gradient(135deg, #d97706, #f59e0b)', email: 'audit@mysc.co.kr' },
                  ].map(demo => (
                    <button
                      key={demo.role}
                      onClick={() => handleDemoLogin(demo.role)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all text-left group"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: demo.gradient }}
                      >
                        <demo.icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px]" style={{ fontWeight: 600 }}>{demo.label}</span>
                          <Badge variant="outline" className="text-[8px] h-3.5 px-1">{demo.role}</Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{demo.desc}</p>
                        <p className="text-[9px] text-muted-foreground/60 mt-0.5">{demo.email}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </button>
                  ))}

                  <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-800/30">
                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                      <AlertCircle className="w-3 h-3 inline mr-0.5" />
                      데모 로그인은 개발/데모 환경에서만 사용하세요. (프로덕션에서는 비활성화 권장)
                    </p>
                  </div>
                </div>
              )}
              </div>
            )}
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
