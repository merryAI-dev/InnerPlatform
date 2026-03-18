// ═══════════════════════════════════════════════════════════════
// MYSC — Firestore CRUD 서비스
// org 스코프 경로를 기준으로 읽기/쓰기/삭제 + 변경 이력(audit) 기록
// ═══════════════════════════════════════════════════════════════

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getOrgCollectionPath, getOrgDocumentPath } from './firebase';
import type { OrgMember, ParticipationEntry, TransactionState } from '../data/types';
import type { MyscEmployee, ParticipationProject } from '../data/participation-data';
import {
  createAuditLogEntry,
  writeAuditLogDoc,
  type AuditActorContext,
  type AuditAction,
  type AuditEntityType,
} from '../platform/audit-log';
import { assertTenantId } from '../platform/tenant';

const SYSTEM_ACTOR: AuditActorContext = {
  id: 'system',
  name: 'System',
};
const TRANSACTION_STATES: TransactionState[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

function assertActorId(actorId: string | undefined): string {
  const normalized = (actorId || '').trim();
  if (!normalized) {
    throw new Error('Actor id is required');
  }
  return normalized;
}

function normalizeAuditActor(actor: AuditActorContext): AuditActorContext {
  return {
    ...actor,
    id: assertActorId(actor.id),
    name: actor.name?.trim() || actor.id.trim(),
    role: actor.role?.trim() || undefined,
    email: actor.email?.trim().toLowerCase() || undefined,
  };
}

export interface BuildTransactionStatePatchInput {
  orgId: string;
  newState: string;
  actorId: string;
  reason?: string;
  now?: string;
}

export function buildTransactionStatePatch(input: BuildTransactionStatePatchInput): Record<string, string> {
  const tenantId = assertTenantId(input.orgId);
  const actorId = assertActorId(input.actorId);
  const state = input.newState.trim().toUpperCase();

  if (!TRANSACTION_STATES.includes(state as TransactionState)) {
    throw new Error(`Unsupported transaction state: ${input.newState}`);
  }

  const timestamp = input.now || new Date().toISOString();
  const updates: Record<string, string> = {
    state,
    updatedAt: timestamp,
    updatedBy: actorId,
    tenantId,
  };

  if (state === 'SUBMITTED') {
    updates.submittedBy = actorId;
    updates.submittedAt = timestamp;
  } else if (state === 'APPROVED') {
    updates.approvedBy = actorId;
    updates.approvedAt = timestamp;
  } else if (state === 'REJECTED') {
    const rejectedReason = (input.reason || '').trim();
    if (!rejectedReason) {
      throw new Error('REJECTED transition requires a rejection reason');
    }
    updates.rejectedReason = rejectedReason;
  }

  return updates;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function withTenantScope<T extends Record<string, unknown>>(
  orgId: string,
  data: T,
): T & { tenantId: string } {
  const tenantId = assertTenantId(orgId);
  return stripUndefined({
    ...data,
    tenantId,
  });
}

function colRef(db: Firestore, orgId: string, key: Parameters<typeof getOrgCollectionPath>[1]) {
  return collection(db, getOrgCollectionPath(orgId, key));
}

function docRef(
  db: Firestore,
  orgId: string,
  key: Parameters<typeof getOrgCollectionPath>[1],
  id: string,
) {
  return doc(db, getOrgDocumentPath(orgId, key, id));
}

async function writeAuditLog(
  db: Firestore,
  orgId: string,
  entityType: AuditEntityType,
  entityId: string,
  action: AuditAction,
  details: string,
  actor: AuditActorContext = SYSTEM_ACTOR,
  metadata?: Record<string, unknown>,
) {
  const normalizedActor = normalizeAuditActor(actor);
  const entry = createAuditLogEntry({
    tenantId: orgId,
    entityType,
    entityId,
    action,
    details,
    actor: normalizedActor,
    metadata,
  });
  await writeAuditLogDoc(db, orgId, entry);
}

export function listenEmployees(
  db: Firestore,
  orgId: string,
  callback: (employees: MyscEmployee[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'employees'), (snap) => {
    const list: MyscEmployee[] = [];
    snap.forEach((d) => list.push(d.data() as MyscEmployee));
    list.sort((a, b) => a.id.localeCompare(b.id));
    callback(list);
  }, (err) => {
    console.error('[Firestore] employees listen error:', err);
  });
}

export function listenMembers(
  db: Firestore,
  orgId: string,
  callback: (members: OrgMember[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'members'), (snap) => {
    const list: OrgMember[] = [];
    snap.forEach((d) => {
      const raw = d.data() as Partial<OrgMember>;
      list.push({
        uid: (raw.uid || d.id).trim(),
        name: raw.name || '',
        email: raw.email || '',
        role: raw.role || 'pm',
        avatarUrl: raw.avatarUrl,
      });
    });
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    callback(list);
  }, (err) => {
    console.error('[Firestore] members listen error:', err);
  });
}

export async function upsertMember(
  db: Firestore,
  orgId: string,
  member: OrgMember & Record<string, unknown>,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'members', member.uid), withTenantScope(orgId, {
    ...member,
    updatedAt: new Date().toISOString(),
  }), { merge: true });
  await writeAuditLog(
    db,
    orgId,
    'member',
    member.uid,
    'UPSERT',
    `구성원 업데이트: ${member.name} (${member.email})`,
    actor,
  );
}

export async function deleteMember(
  db: Firestore,
  orgId: string,
  uid: string,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  const snap = await getDoc(docRef(db, orgId, 'members', uid));
  const data = snap.data() as (OrgMember & { email?: string }) | undefined;
  await deleteDoc(docRef(db, orgId, 'members', uid));
  await writeAuditLog(
    db,
    orgId,
    'member',
    uid,
    'DELETE',
    `구성원 삭제: ${data?.name || uid} (${data?.email || '-'})`,
    actor,
  );
}

export async function upsertEmployee(
  db: Firestore,
  orgId: string,
  emp: MyscEmployee,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'employees', emp.id), withTenantScope(orgId, emp));
  await writeAuditLog(db, orgId, 'employee', emp.id, 'UPSERT', `직원 정보 업데이트: ${emp.realName}(${emp.nickname})`, actor);
}

export function listenPartProjects(
  db: Firestore,
  orgId: string,
  callback: (projects: ParticipationProject[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'partProjects'), (snap) => {
    const list: ParticipationProject[] = [];
    snap.forEach((d) => list.push(d.data() as ParticipationProject));
    callback(list);
  }, (err) => {
    console.error('[Firestore] partProjects listen error:', err);
  });
}

export async function upsertPartProject(
  db: Firestore,
  orgId: string,
  proj: ParticipationProject,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'partProjects', proj.id), withTenantScope(orgId, proj));
  await writeAuditLog(db, orgId, 'part_project', proj.id, 'UPSERT', `참여율 사업 업데이트: ${proj.shortName}`, actor);
}

export function listenPartEntries(
  db: Firestore,
  orgId: string,
  callback: (entries: ParticipationEntry[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'partEntries'), (snap) => {
    const list: ParticipationEntry[] = [];
    snap.forEach((d) => list.push(d.data() as ParticipationEntry));
    list.sort((a, b) => a.id.localeCompare(b.id));
    callback(list);
  }, (err) => {
    console.error('[Firestore] partEntries listen error:', err);
  });
}

export async function addPartEntry(
  db: Firestore,
  orgId: string,
  entry: ParticipationEntry,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'partEntries', entry.id), withTenantScope(orgId, entry));
  await writeAuditLog(
    db,
    orgId,
    'part_entry',
    entry.id,
    'CREATE',
    `참여율 배정 추가: ${entry.memberName} → ${entry.projectName} (${entry.rate}%)`,
    actor,
  );
}

export async function updatePartEntry(
  db: Firestore,
  orgId: string,
  id: string,
  updates: Partial<ParticipationEntry>,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await updateDoc(docRef(db, orgId, 'partEntries', id), {
    ...withTenantScope(orgId, stripUndefined(updates as Record<string, unknown>)),
    updatedAt: new Date().toISOString(),
  });
  await writeAuditLog(
    db,
    orgId,
    'part_entry',
    id,
    'UPDATE',
    `참여율 배정 수정: ${JSON.stringify(updates)}`,
    actor,
  );
}

export async function deletePartEntry(
  db: Firestore,
  orgId: string,
  id: string,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  const snap = await getDoc(docRef(db, orgId, 'partEntries', id));
  const data = snap.data() as ParticipationEntry | undefined;
  await deleteDoc(docRef(db, orgId, 'partEntries', id));
  await writeAuditLog(
    db,
    orgId,
    'part_entry',
    id,
    'DELETE',
    `참여율 배정 삭제: ${data?.memberName} → ${data?.projectName} (${data?.rate}%)`,
    actor,
  );
}

export function listenProjects(
  db: Firestore,
  orgId: string,
  callback: (projects: any[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'projects'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    callback(list);
  }, (err) => {
    console.error('[Firestore] projects listen error:', err);
  });
}

export async function upsertProject(
  db: Firestore,
  orgId: string,
  project: any,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'projects', project.id), withTenantScope(orgId, {
    ...project,
    updatedAt: new Date().toISOString(),
  }));
  await writeAuditLog(db, orgId, 'project', project.id, 'UPSERT', `프로젝트 업데이트: ${project.name}`, actor);
}

export function listenLedgers(
  db: Firestore,
  orgId: string,
  callback: (ledgers: any[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'ledgers'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    callback(list);
  });
}

export async function upsertLedger(
  db: Firestore,
  orgId: string,
  ledger: any,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'ledgers', ledger.id), withTenantScope(orgId, {
    ...ledger,
    updatedAt: new Date().toISOString(),
  }));
  await writeAuditLog(db, orgId, 'ledger', ledger.id, 'UPSERT', `원장 업데이트: ${ledger.name}`, actor);
}

export function listenTransactions(
  db: Firestore,
  orgId: string,
  callback: (transactions: any[]) => void,
): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'transactions'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    callback(list);
  });
}

export async function upsertTransaction(
  db: Firestore,
  orgId: string,
  tx: any,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'transactions', tx.id), withTenantScope(orgId, {
    ...tx,
    updatedAt: new Date().toISOString(),
  }));
  await writeAuditLog(db, orgId, 'transaction', tx.id, 'UPSERT', `거래 업데이트: ${tx.counterparty || tx.id}`, actor);
}

export async function changeTransactionStateFS(
  db: Firestore,
  orgId: string,
  txId: string,
  newState: string,
  actor: AuditActorContext,
  reason?: string,
): Promise<void> {
  const normalizedActor = normalizeAuditActor(actor);
  const updates = buildTransactionStatePatch({
    orgId,
    newState,
    actorId: normalizedActor.id,
    reason,
  });

  await updateDoc(docRef(db, orgId, 'transactions', txId), updates);
  await writeAuditLog(
    db,
    orgId,
    'transaction',
    txId,
    `STATE_CHANGE:${updates.state}`,
    `거래 상태 변경 → ${updates.state}${updates.rejectedReason ? ` (사유: ${updates.rejectedReason})` : ''}`,
    normalizedActor,
  );
}

export function listenComments(db: Firestore, orgId: string, callback: (c: any[]) => void): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'comments'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    callback(list);
  });
}

export async function addCommentFS(
  db: Firestore,
  orgId: string,
  comment: any,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'comments', comment.id), withTenantScope(orgId, comment));
  await writeAuditLog(db, orgId, 'comment', comment.id, 'CREATE', '코멘트 추가', actor, {
    transactionId: comment.transactionId,
  });
}

export function listenEvidences(db: Firestore, orgId: string, callback: (e: any[]) => void): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'evidences'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    callback(list);
  });
}

export async function addEvidenceFS(
  db: Firestore,
  orgId: string,
  evidence: any,
  actor: AuditActorContext = SYSTEM_ACTOR,
): Promise<void> {
  await setDoc(docRef(db, orgId, 'evidences', evidence.id), withTenantScope(orgId, evidence));
  await writeAuditLog(db, orgId, 'evidence', evidence.id, 'CREATE', '증빙 첨부 추가', actor, {
    transactionId: evidence.transactionId,
    fileName: evidence.fileName,
  });
}

export function listenAuditLogs(db: Firestore, orgId: string, callback: (logs: any[]) => void): Unsubscribe {
  return onSnapshot(colRef(db, orgId, 'auditLogs'), (snap) => {
    const list: any[] = [];
    snap.forEach((d) => list.push(d.data()));
    list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    callback(list);
  });
}
