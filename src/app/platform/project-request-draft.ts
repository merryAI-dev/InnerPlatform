import type {
  ProjectRequestDraft,
  ProjectRequestDraftKind,
  ProjectRequestDraftStatus,
} from '../data/types';
import {
  buildProjectRequestPayloadFromDraft,
  type ProjectEditorDraft,
} from './project-editor';

export const PROJECT_REQUEST_DRAFT_SCHEMA_VERSION = 1;

function text(value: unknown): string {
  return String(value || '').trim();
}

function safeId(value: unknown): string {
  const normalized = text(value).replace(/[^A-Za-z0-9가-힣._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'unknown';
}

function omitUndefinedFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedFields(item)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, omitUndefinedFields(item)]),
  ) as T;
}

export function buildProjectRequestDraftId(input: {
  kind: ProjectRequestDraftKind;
  ownerId: string;
  targetProjectId?: string;
}): string {
  const ownerId = safeId(input.ownerId);
  if (input.kind === 'CHANGE') return `change-${safeId(input.targetProjectId)}-${ownerId}`;
  return `registration-${ownerId}`;
}

export function buildProjectRequestDraft(input: {
  tenantId: string;
  kind: ProjectRequestDraftKind;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  targetProjectId?: string;
  draftKey: string;
  draft: ProjectEditorDraft;
  stepIndex: number;
  previousDraft?: ProjectRequestDraft | null;
  status?: ProjectRequestDraftStatus;
  now: string;
}): ProjectRequestDraft {
  const id = input.previousDraft?.id || buildProjectRequestDraftId({
    kind: input.kind,
    ownerId: input.ownerId,
    targetProjectId: input.targetProjectId,
  });
  const version = Math.max(1, Number(input.previousDraft?.version || 0) + 1);
  return omitUndefinedFields({
    id,
    tenantId: input.tenantId,
    kind: input.kind,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    ownerEmail: input.ownerEmail,
    targetProjectId: input.targetProjectId,
    draftKey: input.draftKey,
    payloadSnapshot: buildProjectRequestPayloadFromDraft(input.draft),
    stepIndex: Math.max(0, Math.round(Number(input.stepIndex) || 0)),
    status: input.status || 'DRAFT',
    version,
    createdAt: input.previousDraft?.createdAt || input.now,
    updatedAt: input.now,
    ...(input.status === 'SUBMITTED' ? { submittedAt: input.now } : {}),
  });
}

