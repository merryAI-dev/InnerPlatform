import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeIfEmulator = emulatorHost ? describe : describe.skip;
const projectId = 'demo-bff-firestore-rules-it';
const tenantId = 'firestore-rules-private-edit-it';
const protectedCollections = [
  'editLeases',
  'idempotency_keys',
  'projectRequestDrafts',
  'privateEditDrafts',
  'cashflowEditLocks',
  'cashflow_edit_locks',
] as const;
const actors = [
  { uid: 'draft-owner', role: 'viewer', label: 'project request draft owner' },
  { uid: 'pm-member', role: 'pm', label: 'PM' },
  { uid: 'finance-member', role: 'finance', label: 'finance' },
  { uid: 'admin-member', role: 'admin', label: 'admin' },
] as const;

setLogLevel('silent');

describeIfEmulator('BFF-only Firestore collection rules (Firestore emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let adminApp: App;
  let adminDb: AdminFirestore;

  function protectedDocumentData(ownerId = 'draft-owner') {
    return { ownerId, tenantId, status: 'DRAFT', value: 'original' };
  }

  beforeAll(async () => {
    const [host, port] = emulatorHost!.split(':');
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
      },
    });
    await testEnv.clearFirestore();

    adminApp = initializeApp({ projectId }, `firestore-rules-it-${process.pid}`);
    adminDb = getAdminFirestore(adminApp);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        ...actors.map((actor) => setDoc(doc(db, `orgs/${tenantId}/members/${actor.uid}`), {
          uid: actor.uid,
          role: actor.role,
        })),
        ...protectedCollections.map((collection) => setDoc(
          doc(db, `orgs/${tenantId}/${collection}/existing`),
          protectedDocumentData(),
        )),
        setDoc(doc(db, `orgs/${tenantId}/projects/existing`), { name: 'Existing project' }),
      ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
      await testEnv.cleanup();
    }
    if (adminApp) await deleteApp(adminApp);
  }, 60_000);

  for (const collection of protectedCollections) {
    for (const actor of actors) {
      it(`denies ${actor.label} client CRUD on ${collection}`, async () => {
        const db = testEnv.authenticatedContext(actor.uid, {
          email: `${actor.uid}@mysc.co.kr`,
        }).firestore();
        const existing = doc(db, `orgs/${tenantId}/${collection}/existing`);
        const created = doc(db, `orgs/${tenantId}/${collection}/created-${actor.uid}`);

        await assertFails(getDoc(existing));
        await assertFails(setDoc(created, protectedDocumentData(actor.uid)));
        await assertFails(updateDoc(existing, { value: `updated-${actor.uid}` }));
        await assertFails(deleteDoc(existing));
      });
    }
  }

  it('keeps authorized member client reads and writes for ordinary projects', async () => {
    const db = testEnv.authenticatedContext('pm-member', {
      email: 'pm-member@mysc.co.kr',
    }).firestore();
    const existing = doc(db, `orgs/${tenantId}/projects/existing`);
    const created = doc(db, `orgs/${tenantId}/projects/client-created`);

    expect((await assertSucceeds(getDoc(existing))).data()).toEqual({ name: 'Existing project' });
    await assertSucceeds(setDoc(created, { name: 'Client project' }));
    await assertSucceeds(updateDoc(created, { name: 'Updated client project' }));
    await assertSucceeds(deleteDoc(created));
  });

  it('keeps Admin SDK CRUD available for protected collections', async () => {
    for (const collection of protectedCollections) {
      const ref = adminDb.doc(`orgs/${tenantId}/${collection}/admin-sdk`);
      await ref.set(protectedDocumentData());
      expect((await ref.get()).data()?.value).toBe('original');
      await ref.update({ value: 'updated' });
      expect((await ref.get()).data()?.value).toBe('updated');
      await ref.delete();
    }
  });
});
