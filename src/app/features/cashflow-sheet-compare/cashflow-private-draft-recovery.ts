type DraftPayload = Record<string, unknown>;

type DraftOwnership = {
  leaseId: string;
  fence: number;
};

type DraftClient = {
  get(): Promise<{ draft: { draftRevision: number; payload: DraftPayload } }>;
  save(
    ownership: DraftOwnership,
    input: { expectedDraftRevision: number; payload: DraftPayload },
  ): Promise<{ draft: { draftRevision: number; payload: DraftPayload } }>;
};

function errorCode(error: unknown): string {
  const candidate = error as { code?: unknown; body?: { code?: unknown; error?: unknown } };
  return typeof candidate?.code === 'string'
    ? candidate.code
    : typeof candidate?.body?.code === 'string'
      ? candidate.body.code
      : typeof candidate?.body?.error === 'string'
        ? candidate.body.error
        : '';
}

function sheetLabPayload(payload: DraftPayload): DraftPayload {
  const value = payload.sheetLab;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cashflow sheet private draft is invalid.');
  }
  return value as DraftPayload;
}

export function rebaseSheetLabDraft({
  latest,
  localSheetLab,
}: {
  latest: DraftPayload;
  localSheetLab: DraftPayload;
}): DraftPayload {
  return { ...latest, sheetLab: localSheetLab };
}

export function createCashflowPrivateDraftConflictError() {
  const error = new Error('다른 저장 요청이 먼저 반영되었습니다. 최신 임시저장본을 확인한 뒤 다시 저장해 주세요.') as Error & { code: string };
  error.code = 'cashflow_private_draft_conflict';
  return error;
}

export async function saveSheetLabDraftWithRecovery({
  client,
  ownership,
  expectedDraftRevision,
  payload,
}: {
  client: DraftClient;
  ownership: DraftOwnership;
  expectedDraftRevision: number;
  payload: DraftPayload;
}) {
  try {
    return await client.save(ownership, { expectedDraftRevision, payload });
  } catch (error) {
    if (errorCode(error) !== 'draft_version_conflict') throw error;
  }

  const latest = await client.get();
  const recoveredPayload = rebaseSheetLabDraft({
    latest: latest.draft.payload,
    localSheetLab: sheetLabPayload(payload),
  });
  try {
    return await client.save(ownership, {
      expectedDraftRevision: latest.draft.draftRevision,
      payload: recoveredPayload,
    });
  } catch (error) {
    if (errorCode(error) === 'draft_version_conflict') {
      throw createCashflowPrivateDraftConflictError();
    }
    throw error;
  }
}

export function createPrivateDraftMutationQueue() {
  let previous = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = previous.then(operation, operation);
    previous = current.then(() => undefined, () => undefined);
    return current;
  };
}
