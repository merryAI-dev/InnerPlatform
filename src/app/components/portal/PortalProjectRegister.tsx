import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Send } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useProjectDepartmentSettings } from '../../data/project-department-settings';
import { usePortalStore } from '../../data/portal-store';
import type { ProjectRequestDraft, ProjectRequestDraftStatus } from '../../data/types';
import { getAuthInstance, getOrgDocumentPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
  notifyProjectRequestRegistrationViaBff,
} from '../../lib/platform-bff-client';
import { uploadProjectRequestContractFile } from '../../platform/project-contract-upload';
import {
  buildProjectRequestPayloadFromDraft,
  createProjectEditorDraft,
  type ProjectEditorDraft,
} from '../../platform/project-editor';
import { buildProjectRequestDraft } from '../../platform/project-request-draft';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ProjectEditorWizard } from '../projects/ProjectEditorWizard';

export function PortalProjectRegister() {
  const navigate = useNavigate();
  const { db, orgId } = useFirebase();
  const { user: authUser } = useAuth();
  const { createProjectRequest, members, portalUser } = usePortalStore();
  const { options: departmentOptions } = useProjectDepartmentSettings();
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const serverDraftRef = useRef<ProjectRequestDraft | null>(null);
  const autosaveKey = `portal-register-${orgId}-${authUser?.uid || 'anonymous'}`;

  const initialDraft = useMemo(
    () => createProjectEditorDraft({
      registeredById: authUser?.uid || '',
      registeredByName: authUser?.name || portalUser?.name || '',
      registeredByEmail: authUser?.email || portalUser?.email || '',
      managerId: authUser?.uid || '',
      managerName: authUser?.name || portalUser?.name || '',
    }),
    [authUser?.email, authUser?.name, authUser?.uid, portalUser?.email, portalUser?.name],
  );

  const persistDraft = useCallback(async (
    draft: ProjectEditorDraft,
    stepIndex: number,
    status: ProjectRequestDraftStatus = 'DRAFT',
  ) => {
    if (!db || !authUser?.uid) return;
    const now = new Date().toISOString();
    const nextDraft = buildProjectRequestDraft({
      tenantId: orgId,
      kind: 'REGISTRATION',
      ownerId: authUser.uid,
      ownerName: authUser.name || portalUser?.name || authUser.email || 'PM',
      ownerEmail: authUser.email || portalUser?.email || '',
      draftKey: autosaveKey,
      draft,
      stepIndex,
      previousDraft: serverDraftRef.current,
      status,
      now,
    });
    await setDoc(
      doc(db, getOrgDocumentPath(orgId, 'projectRequestDrafts', nextDraft.id)),
      nextDraft,
      { merge: true },
    );
    serverDraftRef.current = nextDraft;
  }, [authUser?.email, authUser?.name, authUser?.uid, autosaveKey, db, orgId, portalUser?.email, portalUser?.name]);

  const autosaveConfig = useMemo(
    () => (authUser?.uid ? {
      key: autosaveKey,
      onSave: persistDraft,
    } : undefined),
    [authUser?.uid, autosaveKey, persistDraft],
  );

  const handleSubmit = async (draft: ProjectEditorDraft) => {
    if (busyActionId) return;
    setBusyActionId('submit');
    try {
      const payload = buildProjectRequestPayloadFromDraft(draft);
      const createdId = await createProjectRequest(payload);
      if (!createdId) {
        throw new Error('프로젝트 등록 요청 저장에 실패했습니다. 다시 시도해 주세요.');
      }
      try {
        await persistDraft(draft, 4, 'SUBMITTED');
      } catch (draftError) {
        console.warn('[PortalProjectRegister] submitted draft marker failed:', draftError);
      }

      if (authUser && isPlatformApiEnabled()) {
        try {
          const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
          const notification = await notifyProjectRequestRegistrationViaBff({
            tenantId: orgId,
            actor: {
              uid: authUser.uid,
              email: authUser.email,
              role: authUser.role,
              idToken,
            },
            projectRequestId: createdId,
          });
          if (!notification.delivered) {
            toast.warning('프로젝트 등록 요청은 저장됐지만 슬랙 알림은 아직 설정되지 않았습니다.');
          }
        } catch (notificationError) {
          console.error('[PortalProjectRegister] project registration Slack notification failed:', notificationError);
          toast.warning('프로젝트 등록 요청은 저장됐지만 슬랙 알림 전송은 실패했습니다.');
        }
      }

      setSubmitted(true);
      toast.success('프로젝트 등록 요청이 저장되었습니다. 관리자 검토를 기다려주세요.');
    } catch (error) {
      console.error('[PortalProjectRegister] create project request failed:', error);
      toast.error(error instanceof Error ? error.message : '프로젝트 등록 요청 저장에 실패했습니다.');
      throw error;
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

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-5xl py-10">
        <Card className="border-slate-200 bg-white">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#001e46] text-white shadow-sm">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-950">프로젝트 등록 요청이 저장되었습니다</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                수정 화면과 승인 화면에서 같은 입력값을 기준으로 검토됩니다.
              </p>
            </div>
            <Button onClick={() => navigate('/portal/project-select')} className="gap-2">
              프로젝트 선택으로 돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ProjectEditorWizard
      mode="portal-register"
      title="프로젝트 등록"
      description="기본 정보, 계약/재무, 팀/인력, 입금/정산 정보를 같은 기준으로 입력합니다."
      initialDraft={initialDraft}
      draftKey={`portal-register-${authUser?.uid || 'anonymous'}`}
      members={members}
      departmentOptions={departmentOptions}
      autosave={autosaveConfig}
      actions={[{ id: 'submit', label: '등록 요청 저장', icon: Send }]}
      busyActionId={busyActionId}
      onContractFileUpload={handleContractFileUpload}
      onCancel={() => navigate('/portal/project-select')}
      onSubmit={(draft) => handleSubmit(draft)}
    />
  );
}
