import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowRight, CheckCircle2, FolderKanban, Loader2, Search } from 'lucide-react';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { normalizeProjectIds } from '../../data/project-assignment';
import { PROJECT_STATUS_LABELS, type Project } from '../../data/types';
import {
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  resolveRequestedRedirectPath,
} from '../../platform/navigation';
import {
  resolvePortalProjectCandidates,
  resolvePortalProjectSwitchPath,
} from '../../platform/portal-project-selection';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesProjectSearch(project: Project, query: string): boolean {
  if (!query) return true;
  const haystack = [
    project.name,
    project.clientOrg,
    project.type,
    project.managerName,
    project.department,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return haystack.includes(query);
}

function ProjectStartCard(props: {
  project: Project;
  activeProjectId: string;
  pendingProjectId: string;
  onStart: (projectId: string) => void;
}) {
  const { project, activeProjectId, pendingProjectId, onStart } = props;
  const statusLabel = PROJECT_STATUS_LABELS[project.status] || project.status;
  const isCurrent = activeProjectId === project.id;
  const isPending = pendingProjectId === project.id;

  return (
    <Card className={`border-border/60 shadow-sm ${isCurrent ? 'border-teal-300 bg-teal-50/70' : 'bg-white'}`}>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-950">{project.name}</h2>
            <Badge variant="outline" className="text-[10px]">
              {statusLabel}
            </Badge>
            {isCurrent && (
              <Badge className="bg-teal-600 text-[10px] text-white">
                현재 선택
              </Badge>
            )}
          </div>
          <p className="text-[12px] text-slate-600">
            {project.clientOrg || '클라이언트 미지정'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            담당 {project.managerName || '미지정'} · {project.department || '부서 미지정'}
          </p>
        </div>
        <Button
          type="button"
          data-testid={`portal-project-start-${project.id}`}
          className="h-10 gap-2"
          disabled={isPending}
          onClick={() => onStart(project.id)}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          이 사업으로 시작
        </Button>
      </CardContent>
    </Card>
  );
}

export function PortalProjectSelectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth();
  const {
    isRegistered,
    isLoading: portalLoading,
    portalUser,
    activeProjectId,
    projects,
    setSessionActiveProject,
  } = usePortalStore();
  const [search, setSearch] = useState('');
  const [pendingProjectId, setPendingProjectId] = useState('');

  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const redirectTarget = resolvePortalProjectSwitchPath(
    resolveRequestedRedirectPath(undefined, location.search) || '/portal',
  );
  const assignedProjectIds = useMemo(() => normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
    authUser?.projectId,
  ]), [authUser?.projectId, authUser?.projectIds, portalUser?.projectId, portalUser?.projectIds]);
  const candidateProjects = useMemo(() => resolvePortalProjectCandidates({
    role: authUser?.role,
    authUid: authUser?.uid,
    assignedProjectIds,
    projects,
  }), [assignedProjectIds, authUser?.role, authUser?.uid, projects]);
  const normalizedQuery = normalizeSearchValue(search);
  const filteredSearchProjects = useMemo(() => (
    candidateProjects.searchProjects.filter((project) => matchesProjectSearch(project, normalizedQuery))
  ), [candidateProjects.searchProjects, normalizedQuery]);
  const showPrioritySection = candidateProjects.priorityProjects.length > 0 && !isAdminSpaceRole(authUser?.role);
  const visibleSearchProjects = useMemo(() => (
    normalizedQuery || !showPrioritySection ? filteredSearchProjects : []
  ), [filteredSearchProjects, normalizedQuery, showPrioritySection]);

  useEffect(() => {
    if (authLoading || portalLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: currentPath } });
      return;
    }
    if (!canEnterPortalWorkspace(authUser?.role)) {
      navigate('/', { replace: true });
      return;
    }
    if (!isRegistered && !isAdminSpaceRole(authUser?.role)) {
      navigate('/portal/onboarding', { replace: true });
    }
  }, [authLoading, authUser?.role, currentPath, isAuthenticated, isRegistered, navigate, portalLoading]);

  const handleStart = async (projectId: string) => {
    setPendingProjectId(projectId);
    const ok = await setSessionActiveProject(projectId);
    setPendingProjectId('');
    if (!ok) return;
    navigate(redirectTarget, { replace: true });
  };

  if (authLoading || portalLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      data-testid="portal-project-select-page"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-teal-50/40 px-4 py-8 md:px-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="space-y-3">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-500/20">
            <FolderKanban className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950">오늘 작업할 사업 선택</h1>
            <p className="text-[13px] text-slate-600">
              담당 사업이 먼저 보이며, 필요한 경우 검색해서 다른 사업으로 바로 들어갈 수 있습니다.
            </p>
            <p className="text-[12px] text-muted-foreground">
              여기서 고른 사업은 이번 세션의 작업 기준만 바뀌며 저장된 주사업은 그대로 유지됩니다.
            </p>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Search className="h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="사업명, 클라이언트, 유형, 담당자로 검색"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline">{candidateProjects.searchProjects.length}개 검색 가능</Badge>
              {activeProjectId ? (
                <span className="inline-flex items-center gap-1 text-teal-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  현재 세션 사업이 이미 선택되어 있습니다.
                </span>
              ) : (
                <span>사업을 하나 고르면 현재 보고 있던 화면으로 바로 이동합니다.</span>
              )}
            </div>
          </CardContent>
        </Card>

        {showPrioritySection && !normalizedQuery && (
          <section className="space-y-3">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">담당 사업</p>
              <p className="mt-1 text-[12px] text-muted-foreground">지금 바로 시작할 수 있는 담당 사업입니다.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {candidateProjects.priorityProjects.map((project) => (
                <ProjectStartCard
                  key={project.id}
                  project={project}
                  activeProjectId={activeProjectId}
                  pendingProjectId={pendingProjectId}
                  onStart={handleStart}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {normalizedQuery ? '검색 결과' : showPrioritySection ? '전체 검색' : '선택 가능한 사업'}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {normalizedQuery
                ? `${filteredSearchProjects.length}개 사업이 검색되었습니다.`
                : showPrioritySection
                  ? '다른 사업을 찾으려면 검색어를 입력하세요.'
                  : '접근 가능한 사업을 바로 선택할 수 있습니다.'}
            </p>
          </div>

          {visibleSearchProjects.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {visibleSearchProjects.map((project) => (
                <ProjectStartCard
                  key={project.id}
                  project={project}
                  activeProjectId={activeProjectId}
                  pendingProjectId={pendingProjectId}
                  onStart={handleStart}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed border-slate-300 bg-slate-50/60">
              <CardContent className="py-10 text-center">
                <p className="text-[13px] font-medium text-slate-900">
                  {normalizedQuery ? '일치하는 사업이 없습니다.' : '검색어를 입력하면 다른 사업을 바로 찾을 수 있습니다.'}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {normalizedQuery ? '다른 사업명이나 담당자 이름으로 다시 검색해 보세요.' : '사업명, 클라이언트, 유형, 담당자 기준으로 검색할 수 있습니다.'}
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
