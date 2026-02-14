import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { getOrgDocumentPath } from '../lib/firebase';

export type AuditEntityType =
  | 'project'
  | 'ledger'
  | 'transaction'
  | 'evidence'
  | 'comment'
  | 'part_entry'
  | 'part_project'
  | 'employee'
  | 'member'
  | 'system';

export type AuditAction =
  | 'CREATE'
  | 'UPSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'REJECT'
  | `STATE_CHANGE:${string}`
  | string;

export interface AuditActorContext {
  id: string;
  name?: string;
  role?: string;
  email?: string;
}

export interface PlatformAuditLog {
  id: string;
  tenantId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  userId: string;
  userName: string;
  userRole?: string;
  requestId: string;
  details: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAuditLogInput {
  tenantId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  details: string;
  actor?: AuditActorContext;
  requestId?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function generateAuditLogId(timestamp: string = new Date().toISOString()): string {
  return `al_${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}_${randomToken()}`;
}

export function createAuditLogEntry(input: CreateAuditLogInput): PlatformAuditLog {
  const actor = input.actor || { id: 'system', name: 'System' };
  const timestamp = input.timestamp || new Date().toISOString();
  return {
    id: generateAuditLogId(timestamp),
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    userId: actor.id,
    userName: actor.name || actor.id,
    userRole: actor.role,
    requestId: input.requestId || `audit_${Date.now()}_${randomToken()}`,
    details: input.details,
    timestamp,
    metadata: input.metadata,
  };
}

export async function writeAuditLogDoc(
  db: Firestore,
  orgId: string,
  entry: PlatformAuditLog,
): Promise<void> {
  await setDoc(doc(db, getOrgDocumentPath(orgId, 'auditLogs', entry.id)), stripUndefined(entry));
}
