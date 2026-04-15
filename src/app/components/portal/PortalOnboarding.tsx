import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, CheckCircle2, FolderKanban, Loader2 } from 'lucide-react';
import { useAuth } from '../../data/auth-store';
import { normalizeProjectIds, resolvePrimaryProjectId } from '../../data/project-assignment';
import { getDefaultOrgId } from '../../lib/firebase';
import {
  createPlatformApiClient,
  fetchPortalOnboardingContextViaBff,
  type PortalEntryProjectSummary,
  upsertPortalRegistrationViaBff,
} from '../../lib/platform-bff-client';
import { canEnterPortalWorkspace } from '../../platform/navigation';
import { writeSessionActivePortalProjectId } from '../../platform/portal-project-selection';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-slate-100 text-slate-700',
  COMPLETED_PENDING_PAYMENT: 'bg-indigo-100 text-indigo-700',
};

export function PortalOnboarding() {
  const navigate = useNavigate();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<PortalEntryProjectSummary[]>([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [primaryProjectId, setPrimaryProjectId] = useState('');

  const tenantId = authUser?.tenantId || getDefaultOrgId();
  const apiClient = useMemo(() => createPlatformApiClient(import.meta.env), []);
  const isAdminSpaceUser = !canEnterPortalWorkspace(authUser?.role);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/portal/onboarding' } });
      return;
    }

    if (isAdminSpaceUser) {
      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, isAdminSpaceUser, navigate]);

  useEffect(() => {
    if (authLoading || !authUser || !isAuthenticated || isAdminSpaceUser) return;
    let cancelled = false;
    setContextLoading(true);
    setError('');

    void fetchPortalOnboardingContextViaBff({
      tenantId,
      actor: authUser,
      client: apiClient,
    })
      .then((context) => {
        if (cancelled) return;
        if (context.registrationState === 'registered') {
          navigate('/portal', { replace: true });
          return;
        }

        setProjects(context.projects);
        const mergedProjectIds = normalizeProjectIds([
          ...(Array.isArray(authUser.projectIds) ? authUser.projectIds : []),
          authUser.projectId,
          context.activeProjectId,
        ]);
        const nextPrimaryProjectId = resolvePrimaryProjectId(
          mergedProjectIds,
          context.activeProjectId || authUser.projectId || mergedProjectIds[0],
        ) || '';
        setProjectIds(mergedProjectIds);
        setPrimaryProjectId(nextPrimaryProjectId);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        console.error('[PortalOnboarding] onboarding-context fetch failed:', fetchError);
        setError('사업 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => {
        if (!cancelled) {
          setContextLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, authLoading, authUser, isAdminSpaceUser, isAuthenticated, navigate, tenantId]);

  const primaryProject = useMemo(
    () => projects.find((project) => project.id === primaryProjectId) || null,
    [primaryProjectId, projects],
  );

  function getClientLabel(project: PortalEntryProjectSummary) {
    return project.clientOrg || '클라이언트 미지정';
  }

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
    try {
      const result = await upsertPortalRegistrationViaBff({
        tenantId,
        actor: authUser,
        registration: {
          name: authUser.name,
          email: authUser.email,
          role: authUser.role || 'pm',
          projectId: primary,
          projectIds: normalized,
        },
        client: apiClient,
      });

      writeSessionActivePortalProjectId(authUser.uid, result.activeProjectId);
      navigate('/portal', { replace: true });
    } catch (saveError) {
      console.error('[PortalOnboarding] portal registration save failed:', saveError);
      setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || contextLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="portal-onboarding-page"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-3xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-900/15 bg-blue-900">
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-slate-950">내 사업 선택</h1>
          <p className="text-[12px] text-muted-foreground">
            참여하는 사업을 선택해 주세요. 저장 후 바로 포털로 이동합니다.
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

            {projects.length === 0 && (
              <div className="p-4 rounded-lg border border-dashed border-border text-center text-[12px] text-muted-foreground">
                <div>등록된 사업이 없습니다. 관리자에게 사업 등록을 요청해 주세요.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-7 text-[11px]"
                  onClick={() => navigate('/portal/register-project')}
                >
                  사업 추가 요청
                </Button>
              </div>
            )}

            <div className="rounded-xl border border-blue-200/70 bg-blue-50/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-blue-700 font-semibold">현재 선택 상태</p>
                  <p className="text-[13px] text-slate-900 font-semibold">
                    {projectIds.length > 0 ? `${projectIds.length}개 사업 선택됨` : '아직 선택한 사업이 없습니다'}
                  </p>
                </div>
                <Badge className="bg-white text-blue-700 border border-blue-200 text-[10px]">
                  {primaryProject ? `주사업: ${primaryProject.name}` : '주사업 미선택'}
                </Badge>
              </div>
              <p className="mt-2 text-[11px] text-blue-800/80">
                카드를 선택하면 내 사업에 포함되고, 그중 하나를 주사업으로 지정할 수 있습니다.
              </p>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {projects.map((project) => {
                const selected = projectIds.includes(project.id);
                const isPrimary = primaryProjectId === project.id;
                const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
                return (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-all ${
                      selected
                        ? 'border-blue-300 bg-blue-50 shadow-sm shadow-blue-100/60 ring-1 ring-blue-100'
                        : 'border-border/60 bg-white/80 hover:border-blue-200 hover:bg-blue-50/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold">{project.name}</span>
                        <Badge className={`text-[10px] ${statusColors[project.status] || 'bg-slate-100 text-slate-700'}`}>{statusLabel}</Badge>
                        {selected ? (
                          <Badge className="bg-blue-900 text-white text-[10px]">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            선택한 사업
                          </Badge>
                        ) : null}
                        {isPrimary ? (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] border border-amber-200">
                            주사업
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{getClientLabel(project)}</p>
                      {selected ? (
                        <p className="mt-1 text-[11px] text-blue-800">
                          {isPrimary ? '이 사업이 현재 포털 기본 진입 사업입니다.' : '선택된 사업입니다. 필요하면 주사업으로 지정하세요.'}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">선택하면 내 사업 목록에 포함됩니다.</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {selected && (
                        <Button
                          variant={isPrimary ? 'default' : 'outline'}
                          className={`h-9 text-[11px] ${isPrimary ? 'bg-amber-500 hover:bg-amber-500/90 text-white border-amber-500' : ''}`}
                          onClick={() => selectPrimary(project.id)}
                        >
                          {isPrimary ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1" /> 주사업 선택 완료</>
                          ) : (
                            '주사업으로 지정'
                          )}
                        </Button>
                      )}
                      <Button
                        variant={selected ? 'default' : 'outline'}
                        className={`h-9 text-[11px] ${selected ? 'bg-blue-900 hover:bg-blue-950' : ''}`}
                        onClick={() => toggleProject(project.id)}
                      >
                        {selected ? '선택 취소' : '내 사업으로 선택'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-[12px] w-full"
                onClick={() => navigate('/portal/register-project')}
              >
                사업 추가 요청
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                사업을 선택하고 주사업을 확인한 뒤 포털로 이동하세요.
              </p>
              <Button
                className="h-9 text-[12px] bg-blue-900 hover:bg-blue-950"
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
