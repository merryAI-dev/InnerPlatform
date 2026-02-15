import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

const tenantId = (process.env.BFF_TENANT_ID || process.env.VITE_DEFAULT_ORG_ID || 'mysc').trim().toLowerCase();
const projectId = resolveProjectId();
const db = createFirestoreDb({ projectId });

const now = new Date().toISOString();

const project = {
  id: 'p-bff-demo-001',
  name: 'BFF Demo Project',
  slug: 'bff-demo-project',
  status: 'IN_PROGRESS',
  tenantId,
  orgId: tenantId,
  createdAt: now,
  updatedAt: now,
  createdBy: 'seed-script',
  updatedBy: 'seed-script',
  version: 1,
};

const ledger = {
  id: 'l-bff-demo-001',
  tenantId,
  projectId: project.id,
  name: 'BFF Demo Ledger',
  createdAt: now,
  updatedAt: now,
  createdBy: 'seed-script',
  updatedBy: 'seed-script',
  version: 1,
};

const transaction = {
  id: 'tx-bff-demo-001',
  tenantId,
  projectId: project.id,
  ledgerId: ledger.id,
  state: 'DRAFT',
  counterparty: 'Demo Vendor',
  memo: 'Seeded by bff_seed_demo_data.mjs',
  updatedAt: now,
  updatedBy: 'seed-script',
  createdAt: now,
  createdBy: 'seed-script',
  version: 1,
};

await db.doc(`orgs/${tenantId}/projects/${project.id}`).set(project, { merge: true });
await db.doc(`orgs/${tenantId}/ledgers/${ledger.id}`).set(ledger, { merge: true });
await db.doc(`orgs/${tenantId}/transactions/${transaction.id}`).set(transaction, { merge: true });

console.log(`[bff-seed] project=${projectId}, tenant=${tenantId}`);
console.log('[bff-seed] inserted project:', project.id);
console.log('[bff-seed] inserted ledger:', ledger.id);
console.log('[bff-seed] inserted transaction:', transaction.id);
