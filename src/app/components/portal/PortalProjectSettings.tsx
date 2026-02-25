import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderKanban, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import { PROJECT_STATUS_LABELS, type Project } from '../../data/types';
import { normalizeProjectIds, resolvePrimaryProjectId } from '../../data/project-assignment';
import { useAuth } from '../../data/auth-store';
import { PROJECTS } from '../../data/mock-data';
import { resolveHomePath } from '../../platform/navigation';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-700',
};

export function PortalProjectSettings() {
  const navigate = useNavigate();
  const { register, isRegistered, isLoading, portalUser } = usePortalStore();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projects] = useState<Project[]>(PROJECTS);
  const [projectIds, setProjectIds] = useState<string[]>(() => normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser?.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser?.projectIds : []),
    authUser?.projectId,
  ]));
  const [primaryProjectId, setPrimaryProjectId] = useState<string>(() => (
    resolvePrimaryProjectId(projectIds, portalUser?.projectId || authUser?.projectId) || ''
  ));

  const isAdminSpaceUser = resolveHomePath(authUser?.role) === '/';

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    if (isAdminSpaceUser) {
      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, isAdminSpaceUser, navigate]);

  useEffect(() => {
    if (authLoading || isLoading) return;
    if (!isRegistered) {
      navigate('/portal/onboarding', { replace: true });
    }
  }, [authLoading, isLoading, isRegistered, navigate]);

  useEffect(() => {
    const merged = normalizeProjectIds([
      ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
      portalUser?.projectId,
      ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
      authUser?.projectId,
    ]);
    setProjectIds(merged);
    setPrimaryProjectId(resolvePrimaryProjectId(merged, portalUser?.projectId || authUser?.projectId) || '');
  }, [authUser, portalUser]);

  const activeProjects = useMemo(() => (
    projects.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'COMPLETED_PENDING_PAYMENT')
  ), [projects]);

  const allProjects = projects.length ? projects : activeProjects;

  const toggleProject = (projectId: string) => {
    setError('');
    setProjectIds((prev) => {
      const exists = prev.includes(projectId);
      const next = exists ? prev.filter((id) => id !== projectId) : [...prev, projectId];
      const normalized = normalizeProjectIds(next);
      const nextPrimary = resolvePrimaryProjectId(normalized, primaryProjectId || projectId) || '';
      setPrimaryProjectId(nextPrimary);
      return normalized;
    });
  };

  const selectPrimary = (projectId: string) => {
    if (!projectIds.includes(projectId)) return;
    setPrimaryProjectId(projectId);
  };

  const handleSave = async () => {
    setError('');

    if (!authUser) {
      setError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
      return;
    }

    const normalized = normalizeProjectIds(projectIds);
    if (normalized.length === 0) {
      setError('최소 1개 이상의 사업을 선택해 주세요.');
      return;
    }

    const primary = resolvePrimaryProjectId(normalized, primaryProjectId || normalized[0]);
    if (!primary) {
      setError('주사업을 선택해 주세요.');
      return;
    }

    setSaving(true);
    const ok = await register({
      name: authUser.name,
      email: authUser.email,
      role: authUser.role || 'pm',
      projectId: primary,
      projectIds: normalized,
    });
    setSaving(false);

    if (!ok) {
      setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    navigate('/portal', { replace: true });
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const getClientLabel = (project: Project) => {
    const maybeName = (project as unknown as { clientName?: string }).clientName;
    return project.clientOrg || maybeName || '클라이언트 미지정';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/30 dark:from-slate-950 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-teal-500/20 bg-teal-600">
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>사업 배정 수정</h1>
          <p className="text-[12px] text-muted-foreground">
            내 사업 목록과 주사업을 수정할 수 있습니다.
          </p>
        </div>

        <Card className="shadow-xl shadow-black/5 border-border/50">
          <CardContent className="p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200/60 text-rose-700 text-[12px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {allProjects.length === 0 && (
              <div className="p-4 rounded-lg border border-dashed border-border text-center text-[12px] text-muted-foreground">
                등록된 사업이 없습니다. 관리자에게 사업 등록을 요청해 주세요.
              </div>
            )}

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {allProjects.map((project) => {
                const selected = projectIds.includes(project.id);
                const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
                return (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${selected ? 'border-teal-300 bg-teal-50/50' : 'border-border/60'} transition-colors`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]" style={{ fontWeight: 600 }}>{project.name}</span>
                        <Badge className={`text-[10px] ${statusColors[project.status] || 'bg-slate-100 text-slate-700'}`}>{statusLabel}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{getClientLabel(project)}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {selected && (
                        <Button
                          variant={primaryProjectId === project.id ? 'default' : 'outline'}
                          className="h-8 text-[11px]"
                          onClick={() => selectPrimary(project.id)}
                        >
                          {primaryProjectId === project.id ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1" /> 주사업</>
                          ) : (
                            '주사업 지정'
                          )}
                        </Button>
                      )}
                      <Button
                        variant={selected ? 'default' : 'outline'}
                        className="h-8 text-[11px]"
                        onClick={() => toggleProject(project.id)}
                      >
                        {selected ? '선택됨' : '선택'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                변경 사항은 저장 후 즉시 반영됩니다.
              </p>
              <Button
                className="h-9 text-[12px]"
                onClick={handleSave}
                disabled={saving || allProjects.length === 0}
              >
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
