/**
 * Step 5: Firestore Loader
 * dry-run (JSON 파일 출력) 또는 live (Firestore batch write)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidationReport } from './04-validate.js';

export interface LoadResult {
  collection: string;
  sheetName: string;
  documentsWritten: number;
  dryRunPath?: string;
  errors: string[];
}

const OUTPUT_DIR = 'scripts/etl/output';

export async function loadToFirestore(
  reports: ValidationReport[],
  options: { commit?: boolean; orgId?: string; allowSheetErrorsOnCommit?: boolean } = {},
): Promise<LoadResult[]> {
  const { commit = false, orgId = 'mysc', allowSheetErrorsOnCommit = false } = options;
  const results: LoadResult[] = [];
  const now = new Date().toISOString();

  if (!commit) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const report of reports) {
    if (commit && !allowSheetErrorsOnCommit && report.stats.errors > 0) {
      const msg = `Strict mode: validation errors(${report.stats.errors}) in "${report.sheetName}" — skipped`;
      console.log(`  ⏭  [${report.collection}] ${msg}`);
      results.push({
        collection: report.collection,
        sheetName: report.sheetName,
        documentsWritten: 0,
        errors: [msg],
      });
      continue;
    }

    if (report.cleanedRecords.length === 0) {
      console.log(`  ⏭  [${report.collection}] No records to load from ${report.sheetName}`);
      continue;
    }

    console.log(`\n📤 [Load] ${report.collection} — ${report.cleanedRecords.length} records from ${report.sheetName}`);

    // Add metadata to each record
    const documents = report.cleanedRecords.map((record, index) => {
      const { _source, ...fields } = record;
      return {
        ...fields,
        // Auto-generate ID if missing
        id: fields.id || `import-${report.collection}-${Date.now()}-${index}`,
        orgId,
        importedAt: now,
        importSource: `excel:${report.sheetName}:row${_source?.row || 0}`,
        createdAt: fields.createdAt || now,
        updatedAt: now,
      };
    });

    if (commit) {
      // Live mode: write to Firestore
      try {
        const written = await batchWriteFirestore(documents, report.collection, orgId);
        results.push({
          collection: report.collection,
          sheetName: report.sheetName,
          documentsWritten: written,
          errors: [],
        });
        console.log(`  ✅ ${written} documents written to Firestore`);
      } catch (err) {
        results.push({
          collection: report.collection,
          sheetName: report.sheetName,
          documentsWritten: 0,
          errors: [(err as Error).message],
        });
        console.error(`  ❌ Firestore write failed: ${(err as Error).message}`);
      }
    } else {
      // Dry-run: write JSON files
      const fileName = `${report.collection}_${report.sheetName.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.json`;
      const filePath = join(OUTPUT_DIR, fileName);
      writeFileSync(filePath, JSON.stringify(documents, null, 2), 'utf-8');
      results.push({
        collection: report.collection,
        sheetName: report.sheetName,
        documentsWritten: documents.length,
        dryRunPath: filePath,
        errors: [],
      });
      console.log(`  📁 Dry-run: ${documents.length} documents → ${filePath}`);
    }
  }

  return results;
}

async function batchWriteFirestore(
  documents: Record<string, unknown>[],
  collection: string,
  orgId: string,
): Promise<number> {
  // Dynamically import firebase-admin (only when --commit)
  const admin = await import('firebase-admin');
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID;

  // Initialize if needed
  if (admin.default.apps.length === 0) {
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
      const credential = admin.default.credential.cert(serviceAccount as any);
      admin.default.initializeApp({
        credential,
        projectId: projectId || String(serviceAccount.project_id || ''),
      });
    } else {
      // Try application default credentials
      admin.default.initializeApp(projectId ? { projectId } : undefined);
    }
  }

  const appProjectId = (admin.default.app().options as any)?.projectId;
  if (!appProjectId) {
    throw new Error(
      'Firestore projectId is not configured. Set FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT, ' +
      'or provide FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_BASE64.',
    );
  }

  if (!projectId && process.env.GOOGLE_CLOUD_PROJECT == null && process.env.GCLOUD_PROJECT == null) {
    // Keep runtime env aligned for downstream Google client libs
    process.env.GOOGLE_CLOUD_PROJECT = String(appProjectId);
    process.env.GCLOUD_PROJECT = String(appProjectId);
    if (process.env.FIREBASE_PROJECT_ID == null) {
      process.env.FIREBASE_PROJECT_ID = String(appProjectId);
    }
  }

  const db = admin.default.firestore();
  const BATCH_SIZE = 500;
  let written = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = documents.slice(i, i + BATCH_SIZE);

    for (const doc of chunk) {
      const docId = String(doc.id || `auto-${Date.now()}-${written}`);
      const ref = db.collection(`orgs/${orgId}/${collection}`).doc(docId);
      batch.set(ref, doc, { merge: true });
      written++;
    }

    await batch.commit();
    console.log(`    batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} docs committed`);
  }

  return written;
}
