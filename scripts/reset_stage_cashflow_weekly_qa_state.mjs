import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const STAGE_FIRESTORE_PROJECT_ID = 'mysc-bmp-14173451';
const args = new Set(process.argv.slice(2));
const projectIdIndex = process.argv.indexOf('--project-id');
const projectId = projectIdIndex >= 0 ? process.argv[projectIdIndex + 1] || '' : '';
const apply = args.has('--apply');

if (!projectId || !/^p\d+$/.test(projectId)) {
  throw new Error('Use --project-id p1234567890.');
}
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== STAGE_FIRESTORE_PROJECT_ID) {
  throw new Error('This reset script is Stage-only.');
}

const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: STAGE_FIRESTORE_PROJECT_ID });
const db = getFirestore(app);
const collections = [
  'cashflow_weekly_update_completions',
  'cashflow_weekly_update_completion_versions',
  'cashflow_weekly_settlement_change_warnings',
];
const tenantIds = (await db.collection('orgs').listDocuments()).map((document) => document.id);
const tenantSnapshots = await Promise.all(tenantIds.map(async (tenantId) => ({
  tenantId,
  project: await db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
  snapshots: await Promise.all(collections.map((collection) => db.collection(`orgs/${tenantId}/${collection}`)
    .where('projectId', '==', projectId)
    .get())),
})));
const matches = tenantSnapshots.filter(({ project, snapshots }) => project.exists || snapshots.some((snapshot) => !snapshot.empty));
if (matches.length > 1) throw new Error(`Project belongs to multiple tenants: ${matches.map((match) => match.tenantId).join(', ')}`);
const tenantId = matches[0]?.tenantId;
const snapshots = matches[0]?.snapshots || [];
const documents = snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({ path: doc.ref.path, data: doc.data() })));
const collectionCounts = Object.fromEntries(collections.map((collection, index) => [collection, snapshots[index]?.size || 0]));
console.log(JSON.stringify({ projectId, tenantId: tenantId || null, apply, documentCount: documents.length, collectionCounts }, null, 2));

if (!apply) process.exit(0);
if (!tenantId) throw new Error('No weekly QA records found. Nothing was changed.');

const qaSnapshot = await db.doc(`orgs/${tenantId}/cashflow_month_close_qa_dates/${projectId}`).get();
const qaDateTime = qaSnapshot.exists && qaSnapshot.data()?.active ? String(qaSnapshot.data()?.qaDateTime || '') : '';
const resetAt = Number.isFinite(Date.parse(qaDateTime)) ? qaDateTime : new Date().toISOString();
const backupDirectory = resolve(process.env.TMPDIR || '/tmp', 'myscube-stage-reset-backups');
const backupPath = resolve(backupDirectory, `${projectId}-${Date.now()}.json`);
await mkdir(backupDirectory, { recursive: true });
await writeFile(backupPath, JSON.stringify({ projectId, tenantId, resetAt, documents }, null, 2));

const batch = db.batch();
for (const snapshot of snapshots) for (const doc of snapshot.docs) batch.delete(doc.ref);
batch.set(db.doc(`orgs/${tenantId}/cashflow_weekly_update_reset_controls/${projectId}`), {
  projectId,
  trackingStartedAt: resetAt,
  resetAt,
  resetBy: 'stage-qa-reset',
});
await batch.commit();
console.log(JSON.stringify({ projectId, reset: true, backupPath }, null, 2));
