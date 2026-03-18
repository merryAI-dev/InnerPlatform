#!/usr/bin/env npx tsx
/**
 * Sync staging bundle JSON to Firestore.
 *
 * Usage:
 *   npx tsx scripts/etl/sync-staging-to-firestore.ts --bundle scripts/etl/output/firestore-staging-bundle.json --org mysc
 *   npx tsx scripts/etl/sync-staging-to-firestore.ts --commit
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BundleShape {
  orgId?: string;
  collections?: Record<string, Array<Record<string, unknown>>>;
}

loadEnvFiles();

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const bundlePath = resolve(getFlagValue('--bundle') || 'scripts/etl/output/firestore-staging-bundle.json');
const orgId = getFlagValue('--org');

main().catch((err) => {
  console.error('❌ staging sync failed:', err);
  process.exit(1);
});

async function main() {
  if (!existsSync(bundlePath)) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }

  const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8')) as BundleShape;
  const collections = bundle.collections || {};
  const targetOrg = orgId || bundle.orgId || 'mysc';

  const stats = Object.fromEntries(
    Object.entries(collections).map(([k, docs]) => [k, docs.length]),
  );
  const total = Object.values(stats).reduce((s, v) => s + v, 0);

  console.log('📦 Staging bundle');
  console.log(`  - bundle: ${bundlePath}`);
  console.log(`  - orgId: ${targetOrg}`);
  console.log(`  - total docs: ${total}`);
  console.log(`  - collections: ${Object.entries(stats).map(([k, v]) => `${k}:${v}`).join(', ')}`);

  if (!commit) {
    console.log('\n🟢 Dry-run only. Add --commit to write Firestore.');
    return;
  }

  const admin = await import('firebase-admin');
  initFirebaseAdmin(admin.default);

  const db = admin.default.firestore();
  const BATCH_SIZE = 500;
  let written = 0;

  for (const [collection, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    console.log(`\n📤 [${collection}] ${docs.length} docs`);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (let idx = 0; idx < chunk.length; idx++) {
        const doc = { ...chunk[idx] };
        const id = String(doc.id || `staging-${collection}-${i + idx + 1}`);
        delete (doc as any)._staging;
        (doc as any).orgId = targetOrg;
        (doc as any).stagingSyncedAt = new Date().toISOString();

        const ref = db.collection(`orgs/${targetOrg}/${collection}`).doc(id);
        batch.set(ref, doc, { merge: true });
      }

      await batch.commit();
      written += chunk.length;
      console.log(`  - batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length}`);
    }
  }

  console.log(`\n✅ Firestore sync complete: ${written} docs`);
}

function initFirebaseAdmin(admin: typeof import('firebase-admin').default) {
  if (admin.apps.length > 0) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID;

  const serviceAccountJsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const serviceAccountBase64Raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();

  let serviceAccount: Record<string, unknown> | null = null;
  if (serviceAccountJsonRaw) {
    serviceAccount = JSON.parse(serviceAccountJsonRaw);
  } else if (serviceAccountBase64Raw) {
    const decoded = Buffer.from(serviceAccountBase64Raw, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(decoded);
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as any),
      projectId: projectId || String(serviceAccount.project_id || ''),
    });
    return;
  }

  admin.initializeApp(projectId ? { projectId } : undefined);
}

function loadEnvFiles() {
  const candidates = ['.env', '.env.local'];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
