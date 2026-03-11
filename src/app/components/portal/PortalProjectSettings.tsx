import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderKanban, AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import { PROJECT_STATUS_LABELS, type Project } from '../../data/types';
import { normalizeProjectIds, resolvePrimaryProjectId } from '../../data/project-assignment';
import { useAuth } from '../../data/auth-store';
import { canEnterPortalWorkspace } from '../../platform/navigation';
import { useFirebase } from '../../lib/firebase-context';
import { PlatformApiError } from '../../platform/api-client';
import {
  linkProjectEvidenceDriveRootViaBff,
  provisionProjectEvidenceDriveRootViaBff,
} from '../../lib/platform-bff-client';
import { isValidDriveUrl } from '../../platform/evidence-helpers';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-700',
};

export function PortalProjectSettings() {
  const navigate = useNavigate();
  const { register, isRegistered, isLoading, portalUser, projects } = usePortalStore();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const { orgId } = useFirebase();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [driveRootInputs, setDriveRootInputs] = useState<Record<string, string>>({});
  const [driveSavingProjectId, setDriveSavingProjectId] = useState('');
  const [driveProvisioningProjectId, setDriveProvisioningProjectId] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>(() => normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser?.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser?.projectIds : []),
    authUser?.projectId,
  ]));
  const [primaryProjectId, setPrimaryProjectId] = useState<string>(() => (
    resolvePrimaryProjectId(projectIds, portalUser?.projectId || authUser?.projectId) || ''
  ));

  const isAdminSpaceUser = !canEnterPortalWorkspace(authUser?.role);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/portal/project-settings' } });
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
    projects.filter((p) => p.status === 'CONTRACT_PENDING')
  ), [projects]);

  const allProjects = activeProjects;
  const primaryProject = useMemo(
    () => allProjects.find((project) => project.id === primaryProjectId) || null,
    [allProjects, primaryProjectId],
  );
  const selectedProjects = useMemo(
    () => allProjects.filter((project) => projectIds.includes(project.id)),
    [allProjects, projectIds],
  );
  const bffActor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: authUser?.role || portalUser?.role || 'pm',
    idToken: authUser?.idToken,
  }), [authUser?.uid, authUser?.email, authUser?.role, authUser?.idToken, portalUser?.id, portalUser?.email, portalUser?.role]);

  useEffect(() => {
    setDriveRootInputs((prev) => {
      const next = { ...prev };
      for (const project of allProjects) {
        if (next[project.id] === undefined) {
          next[project.id] = project.evidenceDriveRootFolderLink || '';
        }
      }
      return next;
    });
  }, [allProjects]);

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
    // NOTE: 테스트용으로 사업 선택 필수 조건을 일시적으로 해제
    if (normalized.length === 0) {
      setSaving(true);
      const ok = await register({
        name: authUser.name,
        email: authUser.email,
        role: authUser.role || 'pm',
        projectId: '',
        projectIds: [],
        allowEmptyProject: true,
      });
      setSaving(false);
      if (!ok) {
        setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
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

  const handleSaveDriveRoot = async (projectId: string) => {
    const value = (driveRootInputs[projectId] || '').trim();
    if (!value) {
      toast.error('Google Drive 폴더 링크를 입력해 주세요.');
      return;
    }

    setDriveSavingProjectId(projectId);
    try {
      const result = await linkProjectEvidenceDriveRootViaBff({
        tenantId: orgId,
        actor: bffActor,
        projectId,
        value,
      });
      setDriveRootInputs((prev) => ({
        ...prev,
        [projectId]: result.webViewLink || value,
      }));
      toast.success(`증빙 드라이브 연결 완료: ${result.folderName}`);
    } catch (err) {
      console.error('[PortalProjectSettings] save drive root failed:', err);
      if (err instanceof PlatformApiError) {
        const body = err.body as Record<string, unknown> | null;
        toast.error(String(body?.message || err.message || '드라이브 설정 저장에 실패했습니다.'));
      } else {
        toast.error('드라이브 설정 저장에 실패했습니다.');
      }
    } finally {
      setDriveSavingProjectId('');
    }
  };

  const handleProvisionDriveRoot = async (projectId: string) => {
    setDriveProvisioningProjectId(projectId);
    try {
      const result = await provisionProjectEvidenceDriveRootViaBff({
        tenantId: orgId,
        actor: bffActor,
        projectId,
      });
      setDriveRootInputs((prev) => ({
        ...prev,
        [projectId]: result.webViewLink || prev[projectId] || '',
      }));
      toast.success(`기본 증빙 폴더 생성 완료: ${result.folderName}`);
    } catch (err) {
      console.error('[PortalProjectSettings] provision drive root failed:', err);
      if (err instanceof PlatformApiError) {
        const body = err.body as Record<string, unknown> | null;
        toast.error(String(body?.message || err.message || '기본 폴더 생성에 실패했습니다.'));
      } else {
        toast.error('기본 폴더 생성에 실패했습니다.');
      }
    } finally {
      setDriveProvisioningProjectId('');
    }
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

            <div className="rounded-xl border border-teal-200/70 bg-teal-50/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-teal-700" style={{ fontWeight: 700 }}>현재 선택 상태</p>
                  <p className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>
                    {projectIds.length > 0 ? `${projectIds.length}개 사업 선택됨` : '아직 선택한 사업이 없습니다'}
                  </p>
                </div>
                <Badge className="bg-white text-teal-700 border border-teal-200 text-[10px]">
                  {primaryProject ? `주사업: ${primaryProject.name}` : '주사업 미선택'}
                </Badge>
              </div>
              <p className="mt-2 text-[11px] text-teal-800/80">
                현재 선택한 사업과 주사업이 저장 후 즉시 포털에 반영됩니다.
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
                        ? 'border-teal-400 bg-teal-50 shadow-sm shadow-teal-200/40 ring-1 ring-teal-200'
                        : 'border-border/60 bg-white/80 hover:border-teal-200 hover:bg-teal-50/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px]" style={{ fontWeight: 600 }}>{project.name}</span>
                        <Badge className={`text-[10px] ${statusColors[project.status] || 'bg-slate-100 text-slate-700'}`}>{statusLabel}</Badge>
                        {selected ? (
                          <Badge className="bg-teal-600 text-white text-[10px]">
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
                        <p className="mt-1 text-[11px] text-teal-800">
                          {isPrimary ? '이 사업이 현재 기본 사업으로 저장됩니다.' : '선택된 사업입니다. 필요하면 주사업으로 바꾸세요.'}
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
                        className={`h-9 text-[11px] ${selected ? 'bg-teal-600 hover:bg-teal-600/90' : ''}`}
                        onClick={() => toggleProject(project.id)}
                      >
                        {selected ? '선택 취소' : '내 사업으로 선택'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedProjects.length > 0 && (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[12px] text-slate-900" style={{ fontWeight: 800 }}>증빙 드라이브 연결</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      사업별 루트 폴더 링크를 저장하면 정산 화면에서 거래별 하위 폴더를 자동 생성합니다.
                    </p>
                  </div>
                  <Badge className="bg-white text-slate-700 border border-slate-200 text-[10px]">
                    사업별 Firestore 저장
                  </Badge>
                </div>

                <div className="space-y-3">
                  {selectedProjects.map((project) => {
                    const inputValue = driveRootInputs[project.id] || '';
                    const configured = !!project.evidenceDriveRootFolderId;
                    const isSavingDrive = driveSavingProjectId === project.id;
                    const isProvisioningDrive = driveProvisioningProjectId === project.id;
                    return (
                      <div key={`drive-${project.id}`} className="rounded-lg border border-white/70 bg-white px-3 py-3 shadow-sm">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <p className="text-[12px]" style={{ fontWeight: 700 }}>{project.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {configured
                                ? `연결됨 · ${project.evidenceDriveRootFolderName || project.evidenceDriveRootFolderId}`
                                : '아직 루트 폴더가 연결되지 않았습니다'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] ${configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                              {configured ? '설정됨' : '미설정'}
                            </Badge>
                            {isValidDriveUrl(project.evidenceDriveRootFolderLink || '') && (
                              <a
                                href={project.evidenceDriveRootFolderLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-700"
                                title="Google Drive에서 열기"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={configured ? 'outline' : 'default'}
                            className="h-9 text-[11px]"
                            disabled={isSavingDrive || isProvisioningDrive}
                            onClick={() => void handleProvisionDriveRoot(project.id)}
                          >
                            {isProvisioningDrive ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              configured ? '기본 폴더 재확인' : '기본 폴더 자동 생성'
                            )}
                          </Button>
                          <input
                            type="text"
                            value={inputValue}
                            placeholder="Google Drive 폴더 링크 또는 폴더 ID"
                            className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] outline-none focus:border-teal-400"
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setDriveRootInputs((prev) => ({ ...prev, [project.id]: nextValue }));
                            }}
                          />
                          <Button
                            type="button"
                            className="h-9 text-[11px]"
                            disabled={isSavingDrive || isProvisioningDrive || !inputValue.trim()}
                            onClick={() => void handleSaveDriveRoot(project.id)}
                          >
                            {isSavingDrive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '드라이브 저장'}
                          </Button>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          기본값은 상위 Shared Drive 아래에 사업명 기준 폴더를 자동 생성하고, 예외 케이스만 수동 링크로 덮어쓸 수 있습니다.
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                변경 사항은 저장 후 즉시 반영됩니다. {primaryProject ? `현재 주사업은 ${primaryProject.name}입니다.` : ''}
              </p>
              <Button
                className="h-9 text-[12px]"
                onClick={handleSave}
                disabled={saving || allProjects.length === 0}
              >
                {saving ? '저장 중...' : `선택 저장${primaryProject ? ` · ${primaryProject.name}` : ''}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
