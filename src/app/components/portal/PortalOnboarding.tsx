import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  FolderKanban, User, Mail, Briefcase, ArrowRight,
  CheckCircle2, LogIn, Loader2, AlertCircle,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import { PROJECT_STATUS_LABELS } from '../../data/types';
import { normalizeProjectIds, resolvePrimaryProjectId } from '../../data/project-assignment';
import { useAuth } from '../../data/auth-store';
import { resolveHomePath } from '../../platform/navigation';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-700',
};

function isSelected(projectIds: string[], projectId: string): boolean {
  return projectIds.includes(projectId);
}

export function PortalOnboarding() {
  const navigate = useNavigate();
  const { register, isRegistered, isLoading, projects, portalUser } = usePortalStore();
  const { user: authUser, isAuthenticated, isFirebaseAuthEnabled } = useAuth();
  const [step, setStep] = useState<'info' | 'project' | 'done'>(() => (isRegistered ? 'project' : 'info'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState(() => {
    const initialProjectIds = normalizeProjectIds([
      ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
      portalUser?.projectId,
      ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
      authUser?.projectId,
    ]);
    const initialPrimary = resolvePrimaryProjectId(initialProjectIds, portalUser?.projectId || authUser?.projectId);
    return {
      name: portalUser?.name || authUser?.name || '',
      email: portalUser?.email || authUser?.email || '',
      role: 'PM',
      projectIds: initialProjectIds,
      projectId: initialPrimary || '',
    };
  });

  const activeProjects = projects.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'COMPLETED_PENDING_PAYMENT');
  const allProjects = projects;
  const selectedProject = allProjects.find((p) => p.id === form.projectId);
  const isAdminSpaceUser = resolveHomePath(authUser?.role) === '/';

  useEffect(() => {
    if (isAdminSpaceUser) {
      navigate('/', { replace: true });
    }
  }, [isAdminSpaceUser, navigate]);

  useEffect(() => {
    if (isRegistered && step === 'info') {
      setStep('project');
    }
  }, [isRegistered, step]);

  useEffect(() => {
    if (!authUser) return;
    setForm((prev) => {
      const mergedProjectIds = normalizeProjectIds([
        ...prev.projectIds,
        ...(Array.isArray(authUser.projectIds) ? authUser.projectIds : []),
        authUser.projectId,
      ]);
      const mergedProjectId = resolvePrimaryProjectId(mergedProjectIds, prev.projectId || authUser.projectId) || '';
      return {
        ...prev,
        name: prev.name || authUser.name || '',
        email: prev.email || authUser.email || '',
        projectIds: mergedProjectIds,
        projectId: mergedProjectId,
      };
    });
  }, [authUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const toggleProject = (projectId: string) => {
    setError('');
    setForm((prev) => {
      const exists = isSelected(prev.projectIds, projectId);
      const projectIds = exists
        ? prev.projectIds.filter((id) => id !== projectId)
        : [...prev.projectIds, projectId];
      const nextProjectIds = normalizeProjectIds(projectIds);
      const nextProjectId = resolvePrimaryProjectId(nextProjectIds, exists ? prev.projectId : prev.projectId || projectId) || '';
      return {
        ...prev,
        projectIds: nextProjectIds,
        projectId: nextProjectId,
      };
    });
  };

  const setPrimaryProject = (projectId: string) => {
    setForm((prev) => {
      if (!isSelected(prev.projectIds, projectId)) return prev;
      return { ...prev, projectId };
    });
  };

  const handleNext = async () => {
    setError('');
    if (step === 'info') {
      if (!form.name.trim() || !form.email.trim()) {
        setError('이름과 이메일을 입력해 주세요.');
        return;
      }
      setStep('project');
      return;
    }

    if (step === 'project') {
      if (!form.projectIds.length) {
        setError('최소 1개 이상의 사업을 선택해 주세요.');
        return;
      }
      const primary = resolvePrimaryProjectId(form.projectIds, form.projectId);
      if (!primary) {
        setError('주사업을 선택해 주세요.');
        return;
      }

      setSaving(true);
      const ok = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        projectId: primary,
        projectIds: form.projectIds,
      });
      setSaving(false);
      if (!ok) {
        setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setStep('done');
    }
  };

  const handleStart = () => {
    navigate('/portal');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/30 dark:from-slate-950 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' }}
          >
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px] mb-1" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            사업 포털 설정
          </h1>
          <p className="text-[13px] text-muted-foreground">
            회원가입은 1회만 하면 되며, 이후에는 여기서 사업 배정을 수정할 수 있습니다.
          </p>
          {isRegistered && (
            <Badge className="mt-2 text-[10px] h-5 px-2 bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
              기존 계정 설정 수정 모드
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 mb-6">
          {[
            { key: 'info', label: '기본 정보' },
            { key: 'project', label: '사업 선택(복수)' },
            { key: 'done', label: '완료' },
          ].map((s, i) => {
            const isCurrent = s.key === step;
            const isPast = (step === 'project' && i === 0) || (step === 'done' && i < 2);
            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className={`w-8 h-px ${isPast || isCurrent ? 'bg-teal-400' : 'bg-border'}`} />}
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${
                    isPast ? 'bg-teal-500 text-white' :
                    isCurrent ? 'bg-teal-500 text-white ring-4 ring-teal-500/20' :
                    'bg-muted text-muted-foreground'
                  }`} style={{ fontWeight: 700 }}>
                    {isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-[11px] ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`} style={{ fontWeight: isCurrent ? 600 : 400 }}>
                    {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 text-[12px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'info' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" /> 이름 (닉네임)
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="예: 데이나"
                  className="h-10 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" /> 이메일
                </Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="예: dana@mysc.co.kr"
                  className="h-10 text-[13px]"
                  disabled={isFirebaseAuthEnabled && isAuthenticated}
                />
              </div>
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-muted-foreground" /> 역할
                </Label>
                <Input value="PM (사업 담당자)" className="h-10 text-[13px]" disabled />
              </div>
              <Button className="w-full h-10 gap-2" onClick={handleNext} disabled={!form.name || !form.email}>
                다음: 사업 선택 <ArrowRight className="w-4 h-4" />
              </Button>

              <div className="pt-3 border-t border-border mt-4">
                <Link
                  to="/login"
                  className="w-full flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <LogIn className="w-3.5 h-3.5" /> 로그인 페이지로 이동
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'project' && (
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-[12px] text-muted-foreground mb-3">
                  담당 사업을 여러 개 선택할 수 있습니다. 선택한 사업 중 1개를 주사업으로 지정해 주세요.
                </p>

                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {activeProjects.map((p) => {
                    const selected = isSelected(form.projectIds, p.id);
                    const primary = selected && form.projectId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          selected
                            ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20 ring-1 ring-teal-500/30'
                            : 'border-border hover:border-teal-300 hover:bg-muted/30'
                        }`}
                        onClick={() => toggleProject(p.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] truncate" style={{ fontWeight: 600 }}>{p.name}</p>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                              <span>{p.clientOrg}</span>
                              <span>{p.department}</span>
                              {p.managerName && <span>담당: {p.managerName}</span>}
                            </div>
                            {selected && (
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={primary ? 'default' : 'outline'}
                                  className="h-6 text-[10px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPrimaryProject(p.id);
                                  }}
                                >
                                  {primary ? '주사업' : '주사업으로 지정'}
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge className={`text-[9px] h-4 px-1.5 ${statusColors[p.status] || ''}`}>
                              {PROJECT_STATUS_LABELS[p.status]}
                            </Badge>
                            {selected && <CheckCircle2 className="w-4 h-4 text-teal-500" />}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  <div className="pt-2">
                    <p className="text-[10px] text-muted-foreground mb-1.5 px-1" style={{ fontWeight: 600 }}>
                      계약 전 / 예정 사업
                    </p>
                    {allProjects.filter((p) => p.status === 'CONTRACT_PENDING').slice(0, 8).map((p) => {
                      const selected = isSelected(form.projectIds, p.id);
                      const primary = selected && form.projectId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                            selected
                              ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20'
                              : 'border-border/50 hover:border-teal-300 hover:bg-muted/30'
                          }`}
                          onClick={() => toggleProject(p.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] truncate" style={{ fontWeight: 500 }}>{p.name}</p>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[8px] h-3.5 px-1 text-amber-600">
                                {primary ? '계약전 · 주사업' : '계약전'}
                              </Badge>
                              {selected && <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            {selectedProject && (
              <Card className="border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/20">
                <CardContent className="p-3 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-teal-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-teal-700 dark:text-teal-300" style={{ fontWeight: 600 }}>
                      주사업
                    </p>
                    <p className="text-[12px] truncate">{selectedProject.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">총 선택 사업: {form.projectIds.length}개</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setStep('info')} disabled={isRegistered}>
                이전
              </Button>
              <Button className="flex-1 h-10 gap-2" onClick={handleNext} disabled={!form.projectIds.length || saving}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</> : <>저장 완료 <ArrowRight className="w-4 h-4" /></>}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <Card>
            <CardContent className="p-8 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' }}
              >
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-[20px] mb-2" style={{ fontWeight: 800 }}>저장 완료</h2>
              <p className="text-[13px] text-muted-foreground mb-6">
                사업 배정 정보가 저장되었습니다. 이후에도 이 화면에서 사업을 추가/수정할 수 있습니다.
              </p>
              <Button size="lg" className="gap-2 h-11" onClick={handleStart}>
                포털로 이동 <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
