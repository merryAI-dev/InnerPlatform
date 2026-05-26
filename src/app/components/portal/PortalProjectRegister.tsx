import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { getAuthInstance } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
  notifyProjectRequestRegistrationViaBff,
  processProjectRequestContractViaBff,
} from '../../lib/platform-bff-client';
import {
  buildProjectRequestPayloadFromDraft,
  createProjectEditorDraft,
  type ProjectEditorDraft,
} from '../../platform/project-editor';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ProjectEditorWizard } from '../projects/ProjectEditorWizard';

export function PortalProjectRegister() {
  const navigate = useNavigate();
  const { orgId } = useFirebase();
  const { user: authUser } = useAuth();
  const { createProjectRequest, portalUser } = usePortalStore();
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const initialDraft = useMemo(
    () => createProjectEditorDraft({
      managerId: authUser?.uid || '',
      managerName: authUser?.name || portalUser?.name || '',
    }),
    [authUser?.name, authUser?.uid, portalUser?.name],
  );

  const handleSubmit = async (draft: ProjectEditorDraft) => {
    if (busyActionId) return;
    setBusyActionId('submit');
    try {
      const payload = buildProjectRequestPayloadFromDraft(draft);
      const createdId = await createProjectRequest(payload);
      if (!createdId) {
        toast.error('프로젝트 등록 요청 저장에 실패했습니다. 다시 시도해 주세요.');
        return;
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
    } finally {
      setBusyActionId(null);
    }
  };

  const handleContractFileUpload = async (file: File) => {
    if (!authUser?.uid) {
      throw new Error('로그인 정보를 확인할 수 없습니다.');
    }
    if (!isPlatformApiEnabled()) {
      throw new Error('계약서 업로드는 플랫폼 API가 켜진 환경에서만 사용할 수 있습니다.');
    }
    const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
    const processed = await processProjectRequestContractViaBff({
      tenantId: orgId,
      actor: {
        uid: authUser.uid,
        email: authUser.email,
        role: authUser.role,
        idToken,
      },
      file,
    });
    return {
      contractDocument: processed.contractDocument,
      contractAnalysis: processed.analysis,
    };
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <Card className="border-teal-200 bg-teal-50/70">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-teal-700 shadow-sm">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-950">프로젝트 등록 요청이 저장되었습니다</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                수정 화면과 승인 화면에서 같은 입력값을 기준으로 검토됩니다.
              </p>
            </div>
            <Button onClick={() => navigate('/portal')} className="gap-2">
              포털로 돌아가기
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
      actions={[{ id: 'submit', label: '등록 요청 저장', icon: Send }]}
      busyActionId={busyActionId}
      onContractFileUpload={handleContractFileUpload}
      onCancel={() => navigate('/portal')}
      onSubmit={(draft) => void handleSubmit(draft)}
    />
  );
}
