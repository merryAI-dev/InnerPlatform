import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Loader2, Save, SendHorizontal } from 'lucide-react';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import type { Project, ProjectRequest } from '../../data/types';
import { getAuthInstance, getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
  upsertProjectViaBff,
  type UpsertProjectPayload,
} from '../../lib/platform-bff-client';
import { uploadProjectRequestContractFile } from '../../platform/project-contract-upload';
import { buildProjectRequestPayloadFromDraft } from '../../platform/project-editor';
import {
  buildProjectEditorDraftFromProject,
  buildProjectEditorProjectPatch,
  createProjectEditorDraft,
  type ProjectEditorDraft,
} from '../../platform/project-editor';
import {
  buildPortalProjectEditSavePayload,
  isProjectVersionConflictError,
} from '../../platform/project-edit-save';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { ProjectEditorWizard } from '../projects/ProjectEditorWizard';

function resolveExecutiveBanner(project: Project) {
  const status = project.executiveReviewStatus || 'PENDING';
  const reason = project.executiveReviewComment || '';

  if (status === 'APPROVED') {
    return {
      tone: 'success',
      title: '승인 완료',
      description: 'CIC 대표 검토가 승인된 프로젝트입니다. PM이 수정 저장하면 다시 검토 대기로 전환됩니다.',
    };
  }
  if (status === 'REVISION_REJECTED') {
    return {
      tone: 'danger',
      title: '수정 요청 후 반려',
      description: reason || '수정이 필요한 상태입니다. 내용을 보완한 뒤 다시 제출해 주세요.',
    };
  }
  if (status === 'DUPLICATE_DISCARDED') {
    return {
      tone: 'neutral',
      title: '중복·폐기',
      description: reason || '중복 또는 폐기 대상으로 정리된 상태입니다. 필요한 경우 내용을 보완해 다시 제출할 수 있습니다.',
    };
  }
  return {
    tone: 'warning',
    title: '검토 대기',
    description: 'CIC 대표 검토 대기 상태입니다. 수정 저장 시 같은 승인 대기열에서 최신 값으로 확인됩니다.',
  };
}

function bannerClassName(tone: string) {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-900';
  if (tone === 'neutral') return 'border-slate-200 bg-slate-50 text-slate-900';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

async function loadLatestProjectSnapshot(
  db: NonNullable<ReturnType<typeof useFirebase>['db']>,
  orgId: string,
  projectId: string,
): Promise<Project | null> {
  const snap = await getDoc(doc(db, getOrgDocumentPath(orgId, 'projects', projectId)));
  if (!snap.exists()) return null;
  return { ...(snap.data() as Project), id: projectId };
}

export function PortalProjectEdit() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const { myProject } = usePortalStore();
  const [requestDoc, setRequestDoc] = useState<ProjectRequest | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(true);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [resubmitComment, setResubmitComment] = useState('');

  useEffect(() => {
    if (!db || !isOnline || !myProject?.id) {
      setRequestDoc(null);
      setLoadingRequest(false);
      return;
    }

    setLoadingRequest(true);
    const q = query(
      collection(db, getOrgCollectionPath(orgId, 'projectRequests')),
      where('approvedProjectId', '==', myProject.id),
      orderBy('requestedAt', 'desc'),
      limit(1),
    );
    return onSnapshot(q, (snapshot) => {
      setRequestDoc(snapshot.docs[0]?.data() as ProjectRequest || null);
      setLoadingRequest(false);
    }, (error) => {
      console.error('[PortalProjectEdit] request listen failed:', error);
      setRequestDoc(null);
      setLoadingRequest(false);
    });
  }, [db, isOnline, myProject?.id, orgId]);

  const initialDraft = useMemo(
    () => (myProject
      ? buildProjectEditorDraftFromProject(myProject, requestDoc?.payload)
      : createProjectEditorDraft()),
    [myProject, requestDoc?.payload],
  );

  const executiveBanner = useMemo(
    () => (myProject ? resolveExecutiveBanner(myProject) : null),
    [myProject],
  );

  const canResubmit = myProject?.executiveReviewStatus === 'REVISION_REJECTED'
    || myProject?.executiveReviewStatus === 'DUPLICATE_DISCARDED';

  const shouldAutoResetApprovedReview = (project: Project) => (
    project.registrationSource === 'pm_portal'
    && project.executiveReviewStatus === 'APPROVED'
  );

  const persistProject = async (
    draft: ProjectEditorDraft,
    options: { forcePendingReview?: boolean; reviewComment?: string | null } = {},
  ) => {
    if (!orgId || !myProject || !authUser?.uid) return null;
    const now = new Date().toISOString();
    const actorName = authUser.name || authUser.email || 'PM';
    const autoReset = shouldAutoResetApprovedReview(myProject);
    const shouldSyncRequestPayload = !!requestDoc?.id && (
      requestDoc.status === 'PENDING' || options.forcePendingReview || autoReset
    );
    const requestPatch = shouldSyncRequestPayload
      ? ((options.forcePendingReview || autoReset)
          ? {
              status: 'PENDING',
              reviewOutcome: null,
              reviewedBy: null,
              reviewedByName: null,
              reviewedAt: null,
              reviewComment: null,
              rejectedReason: null,
              approvedProjectId: myProject.id,
              payload: buildProjectRequestPayloadFromDraft(draft),
              updatedAt: now,
            }
          : {
              payload: buildProjectRequestPayloadFromDraft(draft),
              updatedAt: now,
            })
      : null;
    const patch = buildProjectEditorProjectPatch(draft, {
      baseProject: myProject,
      mode: 'portal-edit',
      actorId: authUser.uid,
      actorName,
      now,
      forceExecutiveReviewPending: options.forcePendingReview,
      executiveReviewComment: options.reviewComment,
    });
    const buildSavePayload = async () => buildPortalProjectEditSavePayload({
      baseProject: myProject,
      latestProject: db ? await loadLatestProjectSnapshot(db, orgId, myProject.id) : null,
      patch,
      orgId,
      updatedAt: now,
    });
    let savedProject: Project | null = null;

    if (isPlatformApiEnabled()) {
      const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
      const actor = {
        uid: authUser.uid,
        email: authUser.email,
        role: authUser.role,
        idToken,
      };
      const saveViaBff = (payload: Awaited<ReturnType<typeof buildSavePayload>>) => upsertProjectViaBff({
        tenantId: orgId,
        actor,
        project: {
          ...payload.project,
          expectedVersion: payload.expectedVersion,
        } as UpsertProjectPayload,
      });

      const savePayload = await buildSavePayload();
      try {
        await saveViaBff(savePayload);
        savedProject = savePayload.project;
      } catch (error) {
        if (!db || !isProjectVersionConflictError(error)) throw error;
        const retryPayload = await buildSavePayload();
        await saveViaBff(retryPayload);
        savedProject = retryPayload.project;
      }

      if (requestPatch && requestDoc?.id) {
        if (!db) {
          throw new Error('검토 요청 동기화에 필요한 Firestore 연결이 없습니다.');
        }
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', requestDoc.id)),
          requestPatch,
          { merge: true },
        );
      }
    } else if (db) {
      const savePayload = await buildSavePayload();
      await setDoc(doc(db, getOrgDocumentPath(orgId, 'projects', myProject.id)), savePayload.project, { merge: true });
      savedProject = savePayload.project;
      if (requestPatch && requestDoc?.id) {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', requestDoc.id)),
          requestPatch,
          { merge: true },
        );
      }
    }

    return savedProject;
  };

  const handleSubmit = async (draft: ProjectEditorDraft, actionId: string) => {
    if (!myProject || busyActionId) return;

    setBusyActionId(actionId);
    try {
      const forcePendingReview = actionId === 'resubmit';
      await persistProject(draft, {
        forcePendingReview,
        reviewComment: forcePendingReview ? resubmitComment.trim() || null : null,
      });
      if (forcePendingReview) {
        setResubmitComment('');
        toast.success('수정 후 다시 제출했습니다.');
      } else if (shouldAutoResetApprovedReview(myProject)) {
        toast.success('수정 내용을 저장하고 재검토 대기로 전환했습니다.');
      } else {
        toast.success('프로젝트 수정 내용이 저장되었습니다.');
      }
    } catch (error) {
      console.error('[PortalProjectEdit] save failed:', error);
      toast.error(error instanceof Error ? error.message : '저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleContractFileUpload = async (file: File) => {
    return uploadProjectRequestContractFile({
      tenantId: orgId,
      actor: authUser,
      file,
    });
  };

  if (!myProject) {
    return (
      <Card className="border-dashed border-slate-200 bg-slate-50">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-slate-600">수정할 프로젝트를 찾지 못했습니다.</p>
          <Button className="mt-4" onClick={() => navigate('/portal')}>포털로 돌아가기</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ProjectEditorWizard
      mode="portal-edit"
      title="프로젝트 수정"
      description="등록 화면과 같은 5단계 구조로 수정하고, 승인 상태는 변경 이력과 함께 관리됩니다."
      initialDraft={initialDraft}
      draftKey={`portal-edit-${myProject.id}-${requestDoc?.updatedAt || myProject.updatedAt}`}
      actions={[
        { id: 'save', label: '저장', icon: Save },
        ...(canResubmit ? [{ id: 'resubmit', label: '수정 후 다시 제출', icon: SendHorizontal, variant: 'secondary' as const }] : []),
      ]}
      busyActionId={busyActionId}
      onContractFileUpload={handleContractFileUpload}
      onCancel={() => navigate('/portal')}
      onSubmit={(draft, actionId) => void handleSubmit(draft, actionId)}
      topSlot={executiveBanner ? (
        <div className={`rounded-2xl border px-4 py-4 ${bannerClassName(executiveBanner.tone)}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                {canResubmit ? '반려 사유' : '검토 상태'}
              </p>
              <h2 className="mt-1 text-base font-semibold">{executiveBanner.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{executiveBanner.description}</p>
              {canResubmit ? (
                <div className="mt-4">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.16em]">다시 제출 메모</Label>
                  <Textarea
                    value={resubmitComment}
                    onChange={(event) => setResubmitComment(event.target.value)}
                    placeholder="보완한 내용을 짧게 남길 수 있습니다."
                    className="mt-2 min-h-[88px] border-white/70 bg-white/85 text-sm text-slate-900"
                  />
                </div>
              ) : null}
            </div>
            {busyActionId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>
        </div>
      ) : null}
    />
  );
}
