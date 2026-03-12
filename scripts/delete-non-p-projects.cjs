/* eslint-disable no-console */
const admin = require('firebase-admin');

function parseArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  return next && !next.startsWith('-') ? next : '';
}

async function main() {
  const orgId = parseArg('--org') || process.env.ORG_ID || 'mysc';
  const confirm = process.argv.includes('--confirm');
  const app =
    admin.apps.length > 0
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
  const db = app.firestore();

  const colRef = db.collection(`orgs/${orgId}/projects`);
  const snap = await colRef.get();
  const targets = [];
  snap.forEach((doc) => {
    const id = doc.id;
    if (!id.startsWith('p')) {
      const data = doc.data() || {};
      targets.push({ id, name: data.name || '', clientOrg: data.clientOrg || '' });
    }
  });

  if (targets.length === 0) {
    console.log(`[OK] No non-p projects found in orgs/${orgId}/projects`);
    return;
  }

  console.log(`[INFO] Found ${targets.length} non-p projects in orgs/${orgId}/projects`);
  targets.forEach((t) => {
    console.log(`- ${t.id}${t.name ? ` | ${t.name}` : ''}${t.clientOrg ? ` | ${t.clientOrg}` : ''}`);
  });

  if (!confirm) {
    console.log('\n[DRY RUN] No deletions performed. Re-run with --confirm to delete.');
    return;
  }

  console.log('\n[DELETE] Deleting docs (including subcollections)...');
  let deleted = 0;
  for (const t of targets) {
    const ref = colRef.doc(t.id);
    await db.recursiveDelete(ref);
    deleted += 1;
    console.log(`✔ deleted ${t.id} (${deleted}/${targets.length})`);
  }

  console.log(`[DONE] Deleted ${deleted} project documents.`);
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});

