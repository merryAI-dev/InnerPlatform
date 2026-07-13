import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CheckCircle2, Clock3, LockKeyhole, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useProjectDepartmentSettings } from '../../data/project-department-settings';
import { usePortalStore } from '../../data/portal-store';
import type { FileAttachment } from '../../data/types';
import { getAuthInstance } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import { createEditLeaseClient } from '../../lib/edit-lease-client';
import {
  createProjectRegistrationDraftClient,
  type ProjectRegistrationAttachment,
  type ProjectRegistrationDraft,
  type ProjectRegistrationFileLike,
} from '../../lib/project-registration-draft-client';
import type { ActorLike } from '../../lib/platform-bff-client';
import { openEditSession, type EditSession } from '../../platform/edit-session';
import {
  buildProjectRequestPayloadFromDraft,
  createProjectEditorDraft,
  type ProjectEditorDraft,
} from '../../platform/project-editor';
import type { ProjectRequestDocumentKind } from '../../platform/project-contract-upload';
import { EditLeaseDialogs } from '../editing/EditLeaseDialogs';
import { useEditLease } from '../editing/useEditLease';
import { ProjectEditorWizard } from '../projects/ProjectEditorWizard';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

type DraftClient = ReturnType<typeof createProjectRegistrationDraftClient>;

function attachmentDocument(attachment: ProjectRegistrationAttachment): FileAttachment {
  return {
    path: attachment.path,
    name: attachment.name,
    downloadURL: '',
    size: attachment.size,
    contentType: attachment.contentType,
    uploadedAt: attachment.uploadedAt || '',
  };
}

function draftForEditor(record: ProjectRegistrationDraft): ProjectEditorDraft {
  const documents: Partial<Record<ProjectRequestDocumentKind, FileAttachment>> = {};
  for (const attachment of record.attachmentRefs) {
    documents[attachment.documentKind] = attachmentDocument(attachment);
  }
  return createProjectEditorDraft({
    ...(record.payload as Partial<ProjectEditorDraft>),
    contractDocument: documents.contract || null,
    quoteDocument: documents.quote || null,
    proposalDocument: documents.proposal || null,
  });
}

function RegistrationEditor({
  actor,
  draftClient,
  record: initialRecord,
  session,
}: {
  actor: ActorLike;
  draftClient: DraftClient;
  record: ProjectRegistrationDraft;
  session: EditSession;
}) {
  const navigate = useNavigate();
  const { orgId } = useFirebase();
  const { members } = usePortalStore();
  const { options: departmentOptions } = useProjectDepartmentSettings();
  const [record, setRecord] = useState(initialRecord);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const revisionRef = useRef(record.draftRevision);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const leaseClient = useMemo(() => createEditLeaseClient({
    tenantId: orgId,
    actor,
    sessionId: session.sessionId,
    resourceType: 'project-registration',
    resourceId: record.draftId,
  }), [actor, orgId, record.draftId, session.sessionId]);
  const lease = useEditLease({ client: leaseClient });

  useEffect(() => {
    void lease.checkStatus();
  }, [lease.checkStatus]);

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(operation, operation);
    mutationQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const withOwnership = useCallback(async <T,>(operation: (ownership: { leaseId: string; fence: number }) => Promise<T>) => {
    const ownership = await lease.checkBeforeSave();
    if (!ownership) throw new Error('수정 세션이 종료되었거나 다른 세션이 사용 중입니다.');
    try {
      return await operation(ownership);
    } catch (error) {
      await lease.checkStatus();
      throw error;
    }
  }, [lease.checkBeforeSave, lease.checkStatus]);

  const persistDraft = useCallback((draft: ProjectEditorDraft, stepIndex: number) => enqueueMutation(() => (
    withOwnership(async (ownership) => {
      const saved = await draftClient.save(record.draftId, ownership, {
        expectedDraftRevision: revisionRef.current,
        payload: buildProjectRequestPayloadFromDraft(draft) as unknown as Record<string, unknown>,
        stepIndex,
      });
      revisionRef.current = saved.draft.draftRevision;
      setRecord(saved.draft);
    })
  )), [draftClient, enqueueMutation, record.draftId, withOwnership]);

  const uploadDocument = useCallback((kind: ProjectRequestDocumentKind, file: File) => enqueueMutation(() => (
    withOwnership(async (ownership) => {
      const uploaded = await draftClient.upload(record.draftId, ownership, {
        expectedDraftRevision: revisionRef.current,
        documentKind: kind,
        file: file as ProjectRegistrationFileLike,
      });
      revisionRef.current = uploaded.draft.draftRevision;
      setRecord(uploaded.draft);
      return { document: attachmentDocument(uploaded.attachment), contractAnalysis: null };
    })
  )), [draftClient, enqueueMutation, record.draftId, withOwnership]);
  const editorDraft = useMemo(() => draftForEditor(record), [record]);
  const autosave = useMemo(() => ({
    key: `portal-register-${record.draftId}`,
    disabled: !lease.canEdit,
    onSave: persistDraft,
  }), [lease.canEdit, persistDraft, record.draftId]);

  const submit = async () => {
    if (busyActionId) return;
    setBusyActionId('submit');
    try {
      await enqueueMutation(() => withOwnership((ownership) => draftClient.submit(record.draftId, ownership, {
        expectedDraftRevision: revisionRef.current,
      })));
      setSubmitted(true);
      toast.success('프로젝트 등록 요청이 최종 저장되었습니다.');
    } finally {
      setBusyActionId(null);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-5xl py-10">
        <Card className="border-slate-200 bg-white">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#001e46] text-white">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-950">프로젝트 등록 요청이 최종 저장되었습니다</h1>
              <p className="mt-2 text-sm text-slate-600">이제 관리자 검토 화면에 표시됩니다.</p>
            </div>
            <Button onClick={() => navigate('/portal/project-select')}>프로젝트 선택으로 돌아가기</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const minutesLeft = Math.max(0, Math.ceil(lease.remainingMs / 60_000));
  const topSlot = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-slate-700">
        {lease.canEdit ? <Pencil className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
        <span>{lease.error || (lease.canEdit ? `수정 세션 사용 중 · ${minutesLeft}분 남음` : '읽기 모드')}</span>
      </div>
      <div className="flex gap-2">
        {lease.canEdit ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void lease.extend()} disabled={lease.busy}>
              <Clock3 className="mr-1 h-4 w-4" />30분 연장
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => void lease.acquire()} disabled={lease.busy}>
            수정 시작
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <ProjectEditorWizard
        mode="portal-register"
        title="프로젝트 등록"
        description="임시저장 내용은 본인에게만 보이며, 최종 저장 후 관리자에게 표시됩니다."
        embeddedInShell
        initialDraft={editorDraft}
        draftKey={`portal-register-${record.draftId}`}
        members={members}
        departmentOptions={departmentOptions}
        topSlot={topSlot}
        readOnly={!lease.canEdit}
        autosave={autosave}
        actions={[{ id: 'submit', label: '최종 저장', icon: Send }]}
        busyActionId={busyActionId}
        onProjectDocumentFileUpload={({ kind, file }) => uploadDocument(kind, file)}
        canRemoveProjectDocuments={false}
        onCancel={() => navigate('/portal/project-select')}
        onSubmit={() => submit()}
      />
      <EditLeaseDialogs
        warningOpen={lease.warningOpen}
        expiredOpen={lease.expiredOpen}
        conflictOpen={lease.conflictOpen}
        holder={lease.holder}
        busy={lease.busy}
        onDismissWarning={lease.dismissWarning}
        onExtend={() => { void lease.extend(); }}
        onContinueReadOnly={lease.continueReadOnly}
        onReacquire={() => { void lease.acquire(); }}
        onTakeover={() => { void lease.takeover(); }}
      />
    </>
  );
}

export function PortalProjectRegister() {
  const { draftId } = useParams<{ draftId?: string }>();
  const navigate = useNavigate();
  const { orgId } = useFirebase();
  const { user } = useAuth();
  const [bootstrap, setBootstrap] = useState<{
    actor: ActorLike;
    client: DraftClient;
    draft: ProjectRegistrationDraft;
    session: EditSession;
  } | null>(null);
  const [error, setError] = useState('');
  const createDraftPromiseRef = useRef<{
    ownerKey: string;
    promise: Promise<{ draft: ProjectRegistrationDraft }>;
  } | null>(null);
  const identityKey = [user?.uid, user?.email, user?.name, user?.role].join('|');

  useEffect(() => {
    if (!user?.uid) {
      setBootstrap(null);
      return undefined;
    }
    setBootstrap(null);
    let cancelled = false;
    let session: EditSession | null = null;
    void (async () => {
      try {
        setError('');
        session = await openEditSession();
        if (cancelled) {
          session.dispose();
          return;
        }
        const idToken = user.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
        if (cancelled) return;
        const actor: ActorLike = { uid: user.uid, email: user.email, role: user.role, idToken };
        const client = createProjectRegistrationDraftClient({ tenantId: orgId, actor, sessionId: session.sessionId });
        if (!draftId) {
          const ownerKey = `${orgId}:${user.uid}`;
          const initial = createProjectEditorDraft({
            registeredById: user.uid,
            registeredByName: user.name || '',
            registeredByEmail: user.email || '',
            managerId: user.uid,
            managerName: user.name || '',
          });
          if (!createDraftPromiseRef.current || createDraftPromiseRef.current.ownerKey !== ownerKey) {
            createDraftPromiseRef.current = {
              ownerKey,
              promise: client.create({
                payload: buildProjectRequestPayloadFromDraft(initial) as unknown as Record<string, unknown>,
                stepIndex: 0,
              }),
            };
          }
          const pendingCreate = createDraftPromiseRef.current;
          let created: { draft: ProjectRegistrationDraft };
          try {
            created = await pendingCreate.promise;
          } catch (cause) {
            if (createDraftPromiseRef.current === pendingCreate) createDraftPromiseRef.current = null;
            throw cause;
          }
          if (!cancelled) navigate(`/portal/register-project/${created.draft.draftId}`, { replace: true });
          return;
        }
        createDraftPromiseRef.current = null;
        const loaded = await client.get(draftId);
        if (!cancelled && session) setBootstrap({ actor, client, draft: loaded.draft, session });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '등록 임시저장을 불러오지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
      session?.dispose();
    };
  // Token refresh must not unmount the editor; identity changes must.
  }, [draftId, identityKey, navigate, orgId]);

  useEffect(() => {
    const idToken = user?.idToken;
    if (!user?.uid || !idToken) return;
    setBootstrap((current) => {
      if (!current || current.actor.uid !== user.uid || current.actor.idToken === idToken) return current;
      const actor = { ...current.actor, idToken };
      return {
        ...current,
        actor,
        client: createProjectRegistrationDraftClient({
          tenantId: orgId,
          actor,
          sessionId: current.session.sessionId,
        }),
      };
    });
  }, [orgId, user?.idToken, user?.uid]);

  if (error) {
    return <div className="rounded-lg border border-red-200 bg-white p-5 text-sm text-red-700">{error}</div>;
  }
  if (!bootstrap) {
    return <div className="p-6 text-sm text-muted-foreground">등록 임시저장을 준비하는 중...</div>;
  }
  return (
    <RegistrationEditor
      actor={bootstrap.actor}
      draftClient={bootstrap.client}
      record={bootstrap.draft}
      session={bootstrap.session}
    />
  );
}
