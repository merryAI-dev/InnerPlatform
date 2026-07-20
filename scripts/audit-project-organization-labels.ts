#!/usr/bin/env npx tsx
/**
 * Read-only audit for organization labels stored in project data.
 *
 * Usage:
 *   npm run firestore:audit:organization-labels -- --org mysc --firebase-project mysc-bmp-14173451
 *   npm run firestore:audit:organization-labels -- --org mysc --firebase-project inner-platform-live-20260316 --format json --fail-on-issues
 *   npm run firestore:audit:organization-labels -- --org mysc --firebase-project inner-platform-live-20260316 --database reh2607151200 --format json --fail-on-issues
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeProjectDepartment } from '../src/app/platform/project-cic';

type AuditFormat = 'table' | 'json' | 'ndjson';
type OrganizationField = 'department' | 'cic';

interface FirestoreDocument {
  docId: string;
  data: Record<string, unknown>;
}

interface AuditCollection {
  name: string;
  documents: FirestoreDocument[];
}

interface FirestoreModule {
  createFirestoreDb(options?: { projectId?: string; databaseId?: string }): Firestore;
  resolveProjectId(): string;
}

export interface OrganizationLabelAuditRow {
  collection: string;
  docId: string;
  docPath: string;
  fieldPath: string;
  actualValue: string;
  canonicalValue: string;
}

const PROJECT_REQUEST_COLLECTIONS = ['project_requests', 'projectRequests'] as const;
const REQUEST_SNAPSHOT_FIELDS = ['payload', 'proposedSnapshot', 'beforeSnapshot', 'approvedSnapshot'] as const;
const ORGANIZATION_FIELDS: OrganizationField[] = ['department', 'cic'];

function readFlag(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printUsage(): void {
  console.log('Usage: npm run firestore:audit:organization-labels -- --org <orgId> --firebase-project <firebaseProjectId> [--database <databaseId>] [--format table|json|ndjson] [--fail-on-issues]');
  console.log('Reads orgs/<orgId>/projects, project_requests, and projectRequests. This script never writes Firestore.');
}

async function loadFirestoreModule(): Promise<FirestoreModule> {
  const modulePath = '../server/bff/firestore.mjs';
  return await import(modulePath) as FirestoreModule;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Keep the audit aligned with project writes, while covering the historical
 * English AXR team spelling that has not yet been persisted canonically.
 */
export function canonicalizeOrganizationLabel(value: unknown): string {
  const normalized = normalizeProjectDepartment(value);
  const compact = normalized.replace(/\s+/g, '').toLocaleLowerCase('en-US');
  return compact === 'axrteam' || compact === 'axr팀' ? 'AXR팀' : normalized;
}

function addRow(
  rows: OrganizationLabelAuditRow[],
  collection: string,
  docId: string,
  orgId: string,
  fieldPath: string,
  value: unknown,
): void {
  const actualValue = String(value ?? '').trim();
  const canonicalValue = canonicalizeOrganizationLabel(actualValue);
  if (!actualValue || !canonicalValue || actualValue === canonicalValue) return;
  rows.push({
    collection,
    docId,
    docPath: `orgs/${orgId}/${collection}/${docId}`,
    fieldPath,
    actualValue,
    canonicalValue,
  });
}

function inspectOrganizationFields(
  rows: OrganizationLabelAuditRow[],
  collection: string,
  docId: string,
  orgId: string,
  prefix: string,
  data: Record<string, unknown>,
): void {
  ORGANIZATION_FIELDS.forEach((field) => {
    addRow(rows, collection, docId, orgId, `${prefix}${field}`, data[field]);
  });
}

export function buildOrganizationLabelAuditRows(orgId: string, collections: AuditCollection[]): OrganizationLabelAuditRow[] {
  const rows: OrganizationLabelAuditRow[] = [];
  collections.forEach(({ name: collection, documents }) => {
    documents.forEach(({ docId, data }) => {
      inspectOrganizationFields(rows, collection, docId, orgId, '', data);
      if (collection === 'projects') return;
      REQUEST_SNAPSHOT_FIELDS.forEach((snapshotField) => {
        const snapshot = asRecord(data[snapshotField]);
        if (snapshot) inspectOrganizationFields(rows, collection, docId, orgId, `${snapshotField}.`, snapshot);
      });
    });
  });
  return rows;
}

async function readCollection(db: Firestore, collectionPath: string): Promise<FirestoreDocument[]> {
  const snapshot = await db.collection(collectionPath).get();
  return snapshot.docs.map((doc) => ({ docId: doc.id, data: doc.data() as Record<string, unknown> }));
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }
  const firestoreModule = await loadFirestoreModule();
  const orgId = readFlag('--org', process.env.BFF_TENANT_ID || process.env.VITE_DEFAULT_ORG_ID || 'mysc');
  const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', firestoreModule.resolveProjectId()));
  const databaseId = readFlag('--database', process.env.FIRESTORE_DATABASE_ID || '(default)');
  const format = readFlag('--format', 'table') as AuditFormat;
  const failOnIssues = hasFlag('--fail-on-issues');
  if (!['table', 'json', 'ndjson'].includes(format)) {
    throw new Error(`Unsupported --format ${format}. Use table, json, or ndjson.`);
  }

  const db = firestoreModule.createFirestoreDb({ projectId: firebaseProjectId, databaseId });
  const collectionNames = ['projects', ...PROJECT_REQUEST_COLLECTIONS];
  const collections = await Promise.all(collectionNames.map(async (name) => ({
    name,
    documents: await readCollection(db, `orgs/${orgId}/${name}`),
  })));
  const rows = buildOrganizationLabelAuditRows(orgId, collections);

  if (format === 'json') {
    console.log(JSON.stringify({ orgId, firebaseProjectId, databaseId, issueCount: rows.length, rows }, null, 2));
  } else if (format === 'ndjson') {
    rows.forEach((row) => console.log(JSON.stringify(row)));
  } else {
    console.log(`Organization label audit (read-only): org=${orgId}, firebaseProject=${firebaseProjectId}, database=${databaseId}, issues=${rows.length}`);
    if (rows.length > 0) console.table(rows);
  }

  if (failOnIssues && rows.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Organization label audit failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
