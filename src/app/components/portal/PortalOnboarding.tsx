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
import { canEnterPortalWorkspace } from '../../platform/navigation';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'border border-slate-300 bg-white text-slate-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'border border-slate-300 bg-white text-slate-700',
  COMPLETED_PENDING_PAYMENT: 'border border-slate-300 bg-white text-slate-700',
};

export function PortalOnboarding() {
  const navigate = useNavigate();
  const { register, isRegistered, isLoading, portalUser, projects } = usePortalStore();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>(() => normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser?.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser?.projectIds : []),
    authUser?.projectId,
  ]));
  const [primaryProjectId, setPrimaryProjectId] = useState<string>(() => (
    resolvePrimaryProjectId(projectIds, portalUser?.projectId || authUser?.projectId) || ''
  ));

  const isAdminSpaceUser = Boolean(authUser?.role && !canEnterPortalWorkspace(authUser.role));

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/portal/onboarding' } });
      return;
    }
  }, [authLoading, isAuthenticated, navigate]);

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

  const allProjects = useMemo(() => projects, [projects]);
  const primaryProject = useMemo(
    () => allProjects.find((project) => project.id === primaryProjectId) || null,
    [allProjects, primaryProjectId],
  );

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
      setError('최소 1개 이상의 프로젝트를 선택해 주세요.');
      return;
    }

    const primary = resolvePrimaryProjectId(normalized, primaryProjectId || normalized[0]);
    if (!primary) {
      setError('주 프로젝트를 선택해 주세요.');
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

    navigate('/portal/project-select', { replace: true });
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">프로젝트 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (isAdminSpaceUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <Card className="w-full max-w-xl border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent className="p-6">
            <Badge variant="outline">접근 제한</Badge>
            <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-slate-50">포털 접근 권한을 확인해 주세요</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              권한 또는 작업 공간 상태를 확인해 주세요. 현재 URL은 유지했습니다.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getClientLabel = (project: Project) => {
    const maybeName = (project as unknown as { clientName?: string }).clientName;
    return project.clientOrg || maybeName || '계약 대상 미지정';
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-6xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm bg-[#001e46]">
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>내 프로젝트 선택</h1>
          <p className="text-[12px] text-muted-foreground">
            참여하는 프로젝트를 선택해 주세요. 선택 후 바로 포털로 이동합니다.
          </p>
        </div>

        <Card className="border-border">
          <CardContent className="p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white text-red-700 text-[12px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {allProjects.length === 0 && (
              <div className="p-4 rounded-lg border border-dashed border-border text-center text-[12px] text-muted-foreground">
                <div>등록된 프로젝트가 없습니다. 관리자에게 프로젝트 등록을 요청해 주세요.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 text-[11px]"
                  onClick={() => navigate('/portal/register-project')}
                >
                  프로젝트 추가 요청
                </Button>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-600" style={{ fontWeight: 700 }}>현재 선택 상태</p>
                  <p className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>
                    {projectIds.length > 0 ? `${projectIds.length}개 프로젝트 선택됨` : '아직 선택한 프로젝트가 없습니다'}
                  </p>
                </div>
                <Badge className="bg-white text-slate-800 border border-slate-300 text-[10px]">
                  {primaryProject ? `주 프로젝트: ${primaryProject.name}` : '주 프로젝트 미선택'}
                </Badge>
              </div>
              <p className="mt-2 text-[11px] text-slate-600">
                카드를 선택하면 내 프로젝트에 포함되고, 그중 하나를 주 프로젝트로 지정할 수 있습니다.
              </p>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {allProjects.map((project) => {
                const selected = projectIds.includes(project.id);
                const isPrimary = primaryProjectId === project.id;
                const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
                return (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-all ${
                      selected
                        ? 'border-[#001e46] bg-slate-50 shadow-sm ring-1 ring-[#001e46]/15'
                        : 'border-border bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px]" style={{ fontWeight: 600 }}>{project.name}</span>
                        <Badge className={`text-[10px] ${statusColors[project.status] || 'bg-slate-100 text-slate-700'}`}>{statusLabel}</Badge>
                        {selected ? (
                          <Badge className="bg-[#001e46] text-white text-[10px]">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            선택한 프로젝트
                          </Badge>
                        ) : null}
                        {isPrimary ? (
                          <Badge className="bg-white text-slate-800 text-[10px] border border-slate-300">
                            주 프로젝트
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{getClientLabel(project)}</p>
                      {selected ? (
                        <p className="mt-1 text-[11px] text-slate-600">
                          {isPrimary ? '이 프로젝트가 현재 포털 기본 진입 프로젝트입니다.' : '선택된 프로젝트입니다. 필요하면 주 프로젝트로 지정하세요.'}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">선택하면 내 프로젝트 목록에 포함됩니다.</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {selected && (
                        <Button
                          variant={isPrimary ? 'default' : 'outline'}
                          className={`h-9 text-[11px] ${isPrimary ? 'bg-[#001e46] hover:bg-[#001735] text-white border-[#001e46]' : ''}`}
                          onClick={() => selectPrimary(project.id)}
                        >
                          {isPrimary ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1" /> 주 프로젝트 선택 완료</>
                          ) : (
                            '주 프로젝트로 지정'
                          )}
                        </Button>
                      )}
                      <Button
                        variant={selected ? 'default' : 'outline'}
                        className={`h-9 text-[11px] ${selected ? 'bg-[#001e46] hover:bg-[#001735]' : ''}`}
                        onClick={() => toggleProject(project.id)}
                      >
                        {selected ? '선택 취소' : '내 프로젝트로 선택'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2">
              <Button
                variant="default"
                size="sm"
                className="h-9 text-[12px] w-full"
                onClick={() => navigate('/portal/register-project')}
              >
                프로젝트 추가 요청
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                {isRegistered
                  ? `선택 정보를 저장하면 ${primaryProject?.name || '주 프로젝트'} 기준으로 바로 반영됩니다.`
                  : '프로젝트를 선택하고 주 프로젝트를 확인한 뒤 포털로 이동하세요.'}
              </p>
              <Button
                className="h-9 text-[12px]"
                onClick={handleSave}
                disabled={saving || projectIds.length === 0}
              >
                {saving ? '저장 중...' : `선택 저장 후 계속${primaryProject ? ` · ${primaryProject.name}` : ''}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
