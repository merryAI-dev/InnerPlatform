import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AlertCircle, CheckCircle2, FolderKanban, Loader2, Search } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { usePortalStore } from '../../data/portal-store';
import { PROJECT_STATUS_LABELS, type Project } from '../../data/types';
import { normalizeProjectIds, resolvePrimaryProjectId } from '../../data/project-assignment';
import { useAuth } from '../../data/auth-store';
import { canEnterPortalWorkspace } from '../../platform/navigation';

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-700',
};

const PROJECT_STATUS_FILTERS = [
  'ALL',
  'IN_PROGRESS',
  'CONTRACT_PENDING',
  'COMPLETED',
  'COMPLETED_PENDING_PAYMENT',
] as const;

type ProjectStatusFilter = typeof PROJECT_STATUS_FILTERS[number];

export function PortalProjectSettings() {
  const navigate = useNavigate();
  const { register, isRegistered, isLoading, portalUser, projects } = usePortalStore();
  const { user: authUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('ALL');
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
  const searchedProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) return allProjects;
    return allProjects.filter((project) => {
      const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
      const haystack = [
        project.name,
        getClientLabel(project),
        statusLabel,
        project.managerName || '',
        String(project.contractStart || ''),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [allProjects, projectSearch]);
  const filteredProjects = useMemo(() => {
    return searchedProjects.filter((project) => {
      if (showSelectedOnly && !projectIds.includes(project.id)) return false;
      if (statusFilter !== 'ALL' && project.status !== statusFilter) return false;
      return true;
    });
  }, [searchedProjects, showSelectedOnly, projectIds, statusFilter]);
  const visibleProjects = useMemo(() => {
    const sorted = [...filteredProjects].sort((left, right) => {
      const leftSelected = projectIds.includes(left.id);
      const rightSelected = projectIds.includes(right.id);
      const leftPrimary = left.id === primaryProjectId;
      const rightPrimary = right.id === primaryProjectId;
      if (leftPrimary !== rightPrimary) return leftPrimary ? -1 : 1;
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      return left.name.localeCompare(right.name, 'ko');
    });
    return sorted;
  }, [filteredProjects, projectIds, primaryProjectId]);
  const visibleSelectedProjects = useMemo(
    () => visibleProjects.filter((project) => projectIds.includes(project.id)),
    [visibleProjects, projectIds],
  );
  const visibleUnselectedProjects = useMemo(
    () => visibleProjects.filter((project) => !projectIds.includes(project.id)),
    [visibleProjects, projectIds],
  );
  const filterCounts = useMemo(() => {
    return PROJECT_STATUS_FILTERS.reduce<Record<ProjectStatusFilter, number>>((acc, filter) => {
      acc[filter] = filter === 'ALL'
        ? searchedProjects.length
        : searchedProjects.filter((project) => project.status === filter).length;
      return acc;
    }, {
      ALL: 0,
      IN_PROGRESS: 0,
      CONTRACT_PENDING: 0,
      COMPLETED: 0,
      COMPLETED_PENDING_PAYMENT: 0,
    });
  }, [searchedProjects]);

  useEffect(() => {
    if (projectIds.includes(primaryProjectId)) return;
    setPrimaryProjectId(resolvePrimaryProjectId(projectIds, projectIds[0]) || '');
  }, [primaryProjectId, projectIds]);

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

  function getClientLabel(project: Project) {
    const maybeName = (project as unknown as { clientName?: string }).clientName;
    return project.clientOrg || maybeName || '클라이언트 미지정';
  }

  function getStatusFilterLabel(filter: ProjectStatusFilter): string {
    if (filter === 'ALL') return '전체';
    return PROJECT_STATUS_LABELS[filter] || filter;
  }

  function highlightKeyword(text: string, keyword: string): ReactNode {
    const trimmed = keyword.trim();
    if (!trimmed) return text;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    const lowered = trimmed.toLowerCase();
    return parts.map((part, index) => (
      part.toLowerCase() === lowered
        ? <mark key={`${part}-${index}`} className="rounded bg-amber-200/70 px-0.5 text-inherit">{part}</mark>
        : <Fragment key={`${part}-${index}`}>{part}</Fragment>
    ));
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/30 dark:from-slate-950 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-teal-500/20 bg-teal-600">
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            {isRegistered ? '사업 배정 수정' : '포털 시작하기'}
          </h1>
          <p className="text-[12px] text-muted-foreground">
            선택한 사업 중 주사업만 저장하세요.
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
                주사업을 저장하면 포털에 즉시 반영됩니다.
              </p>
            </div>

            {allProjects.length > 0 && (
              <div className="space-y-2">
                {primaryProject ? (
                  <div className="rounded-lg border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
                    현재 주사업은 <strong>{primaryProject.name}</strong>입니다. 다른 사업으로 바꾸려면 목록에서 주사업을 다시 지정하세요.
                  </div>
                ) : null}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="사업명, 클라이언트, 유형, 담당자로 검색"
                    className="h-10 pl-9 text-[12px]"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {projectSearch.trim()
                      ? `${visibleProjects.length}개 검색 결과 · 선택 ${visibleSelectedProjects.length}개`
                      : `${allProjects.length}개 전체 사업 · 선택 ${projectIds.length}개`}
                  </span>
                  {projectSearch.trim() ? (
                    <button
                      type="button"
                      className="text-teal-700 hover:text-teal-800"
                      onClick={() => setProjectSearch('')}
                    >
                      검색 지우기
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={showSelectedOnly ? 'default' : 'outline'}
                    className={`h-8 text-[11px] ${showSelectedOnly ? 'bg-teal-600 hover:bg-teal-600/90' : ''}`}
                    onClick={() => setShowSelectedOnly((prev) => !prev)}
                  >
                    선택한 사업만 보기
                  </Button>
                  {PROJECT_STATUS_FILTERS.map((filter) => {
                    const active = statusFilter === filter;
                    return (
                      <Button
                        key={filter}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        className={`h-8 text-[11px] ${active ? 'bg-slate-900 hover:bg-slate-900/90 text-white' : ''}`}
                        onClick={() => setStatusFilter(filter)}
                      >
                        {getStatusFilterLabel(filter)} {filterCounts[filter]}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {visibleSelectedProjects.length > 0 && (
                <div className="sticky top-0 z-10 rounded-lg border border-amber-200/70 bg-amber-50/95 px-3 py-2 text-[11px] text-amber-800 backdrop-blur-sm">
                  선택한 사업과 주사업이 먼저 보입니다.
                </div>
              )}
              {visibleProjects.length > 0 && visibleSelectedProjects.length > 0 && (
                <div className="px-1 pt-1 text-[11px] font-medium text-slate-700">
                  선택한 사업
                </div>
              )}
              {visibleSelectedProjects.map((project) => {
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
                        <span className="text-[13px]" style={{ fontWeight: 600 }}>{highlightKeyword(project.name, projectSearch)}</span>
                        <Badge className={`text-[10px] ${statusColors[project.status] || 'bg-slate-100 text-slate-700'}`}>{statusLabel}</Badge>
                        <Badge className="bg-teal-600 text-white text-[10px]">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          선택한 사업
                        </Badge>
                        {isPrimary ? (
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] border border-amber-200">
                            주사업
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{highlightKeyword(getClientLabel(project), projectSearch)}</p>
                      <p className="mt-1 text-[11px] text-teal-800">
                        {isPrimary ? '이 사업이 현재 주사업으로 저장됩니다.' : '선택된 사업입니다. 필요하면 주사업으로 지정하세요.'}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
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
                      <Button
                        variant="default"
                        className="h-9 text-[11px] bg-teal-600 hover:bg-teal-600/90"
                        onClick={() => toggleProject(project.id)}
                      >
                        선택 취소
                      </Button>
                    </div>
                  </div>
                );
              })}
              {visibleUnselectedProjects.length > 0 && (
                <div className="px-1 pt-2 text-[11px] font-medium text-slate-700">
                  {visibleSelectedProjects.length > 0 ? '추가 가능한 사업' : '사업 목록'}
                </div>
              )}
              {visibleUnselectedProjects.map((project) => {
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
                        <span className="text-[13px]" style={{ fontWeight: 600 }}>{highlightKeyword(project.name, projectSearch)}</span>
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
                      <p className="text-[11px] text-muted-foreground">{highlightKeyword(getClientLabel(project), projectSearch)}</p>
                      {selected ? (
                        <p className="mt-1 text-[11px] text-teal-800">
                          {isPrimary ? '이 사업이 현재 주사업으로 저장됩니다.' : '선택된 사업입니다. 필요하면 주사업으로 지정하세요.'}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {project.managerName
                            ? <>담당 {highlightKeyword(project.managerName, projectSearch)} · 선택하면 내 사업 목록에 포함됩니다.</>
                            : '선택하면 내 사업 목록에 포함됩니다.'}
                        </p>
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
              {allProjects.length > 0 && visibleProjects.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
                  검색 결과가 없습니다. 다른 키워드로 다시 찾아보세요.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-[11px] text-muted-foreground">
                주사업을 저장하면 포털이 즉시 갱신됩니다. {primaryProject ? `현재 주사업은 ${primaryProject.name}입니다.` : '주사업을 먼저 선택해 주세요.'}
              </p>
              <Button
                className="h-9 text-[12px]"
                onClick={handleSave}
                disabled={saving || allProjects.length === 0 || projectIds.length === 0}
              >
                {saving ? '저장 중...' : '주사업 저장'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
