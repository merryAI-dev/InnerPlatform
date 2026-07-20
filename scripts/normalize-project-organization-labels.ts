#!/usr/bin/env npx tsx
/**
 * Clone-only normalization for legacy project organization labels.
 *
 * Usage:
 *   npm run firestore:normalize:organization-labels -- --org mysc --firebase-project inner-platform-live-20260316 --database audit2607151400
 *   npm run firestore:normalize:organization-labels -- --org mysc --firebase-project inner-platform-live-20260316 --database audit2607151400 --apply
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Firestore } from 'firebase-admin/firestore';
import {
  buildOrganizationLabelAuditRows,
  canonicalizeOrganizationLabel,
  type OrganizationLabelAuditRow,
} from './audit-project-organization-labels';

type OutputFormat = 'table' | 'json';
type AuditCollections = Parameters<typeof buildOrganizationLabelAuditRows>[1];

interface FirestoreDocument {
  docId: string;
  data: Record<string, unknown>;
}

interface FirestoreModule {
  createFirestoreDb(options?: { projectId?: string; databaseId?: string }): Firestore;
  resolveProjectId(): string;
}

export interface OrganizationLabelNormalizationPatch {
  collection: string;
  docId: string;
  docPath: string;
  fields: Record<string, string>;
}

const COLLECTION_NAMES = ['projects', 'project_requests', 'projectRequests'] as const;
const WRITE_BATCH_SIZE = 400;

function readFlag(name: string, fallback = ''): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function printUsage(): void {
  console.log('Usage: npm run firestore:normalize:organization-labels -- --org <orgId> --firebase-project <firebaseProjectId> --database <namedCloneDatabaseId> [--apply] [--format table|json]');
  console.log('Dry-run is the default. --apply writes only CIC <number> and AXR Team legacy labels. (default) is always rejected.');
}

async function loadFirestoreModule(): Promise<FirestoreModule> {
  const modulePath = '../server/bff/firestore.mjs';
  return await import(modulePath) as FirestoreModule;
}

function isExactLegacyOrganizationLabel(value: string): boolean {
  return /^CIC \d+$/.test(value) || value === 'AXR Team';
}

export function normalizeLegacyOrganizationLabel(value: unknown): string | null {
  const actualValue = String(value ?? '').trim();
  if (!isExactLegacyOrganizationLabel(actualValue)) return null;
  const canonicalValue = canonicalizeOrganizationLabel(actualValue);
  return canonicalValue && canonicalValue !== actualValue ? canonicalValue : null;
}

export function assertNamedCloneDatabase(databaseId: string): void {
  if (!databaseId || databaseId === '(default)') {
    throw new Error('Refusing to run against the default database. Pass a named clone database with --database.');
  }
}

export function buildOrganizationLabelNormalizationPatches(
  orgId: string,
  collections: AuditCollections,
): OrganizationLabelNormalizationPatch[] {
  const patches = new Map<string, OrganizationLabelNormalizationPatch>();
  const rows = buildOrganizationLabelAuditRows(orgId, collections);

  rows.forEach((row: OrganizationLabelAuditRow) => {
    const normalizedValue = normalizeLegacyOrganizationLabel(row.actualValue);
    if (!normalizedValue) return;
    const key = `${row.collection}/${row.docId}`;
    const existing = patches.get(key) || {
      collection: row.collection,
      docId: row.docId,
      docPath: row.docPath,
      fields: {},
    };
    existing.fields[row.fieldPath] = normalizedValue;
    patches.set(key, existing);
  });

  return [...patches.values()];
}

async function readCollection(db: Firestore, collectionPath: string): Promise<FirestoreDocument[]> {
  const snapshot = await db.collection(collectionPath).get();
  return snapshot.docs.map((doc) => ({ docId: doc.id, data: doc.data() as Record<string, unknown> }));
}

async function applyPatches(db: Firestore, patches: OrganizationLabelNormalizationPatch[]): Promise<void> {
  for (let start = 0; start < patches.length; start += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    patches.slice(start, start + WRITE_BATCH_SIZE).forEach((patch) => {
      batch.update(db.doc(patch.docPath), patch.fields);
    });
    await batch.commit();
  }
}

function flattenPatches(patches: OrganizationLabelNormalizationPatch[]) {
  return patches.flatMap((patch) => Object.entries(patch.fields).map(([fieldPath, canonicalValue]) => ({
    docPath: patch.docPath,
    fieldPath,
    canonicalValue,
  })));
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const orgId = readFlag('--org', process.env.BFF_TENANT_ID || process.env.VITE_DEFAULT_ORG_ID || 'mysc');
  const suppliedFirebaseProjectId = readFlag('--firebase-project', readFlag('--project', process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''));
  const databaseId = readFlag('--database', process.env.FIRESTORE_DATABASE_ID || '');
  const format = readFlag('--format', 'table') as OutputFormat;
  const apply = hasFlag('--apply');

  if (!['table', 'json'].includes(format)) {
    throw new Error(`Unsupported --format ${format}. Use table or json.`);
  }
  assertNamedCloneDatabase(databaseId);

  const firestoreModule = await loadFirestoreModule();
  const firebaseProjectId = suppliedFirebaseProjectId || firestoreModule.resolveProjectId();
  const db = firestoreModule.createFirestoreDb({ projectId: firebaseProjectId, databaseId });
  const collections = await Promise.all(COLLECTION_NAMES.map(async (name) => ({
    name,
    documents: await readCollection(db, `orgs/${orgId}/${name}`),
  })));
  const patches = buildOrganizationLabelNormalizationPatches(orgId, collections);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    orgId,
    firebaseProjectId,
    databaseId,
    documentCount: patches.length,
    fieldCount: flattenPatches(patches).length,
    patches,
  };

  if (apply && patches.length > 0) await applyPatches(db, patches);

  if (format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Organization label normalization (${summary.mode}): org=${orgId}, firebaseProject=${firebaseProjectId}, database=${databaseId}, documents=${summary.documentCount}, fields=${summary.fieldCount}`);
    const rows = flattenPatches(patches);
    if (rows.length > 0) console.table(rows);
    if (!apply) console.log('Dry-run only. Re-run with --apply after reviewing this named clone plan.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error('Organization label normalization failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
