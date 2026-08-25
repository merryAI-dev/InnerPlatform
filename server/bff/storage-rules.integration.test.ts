import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from 'firebase/auth';
import {
  connectStorageEmulator,
  getBytes,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage';

const describeIfStorageEmulators = process.env.FIREBASE_AUTH_EMULATOR_HOST
  && process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? describe
  : describe.skip;

describeIfStorageEmulators('Firebase Storage rules', () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-bff-it';
  const bucketName = `${projectId}.firebasestorage.app`;
  const runId = `${process.pid}-${Date.now()}`;
  const protectedPath = `orgs/tenant-a/project-registration-drafts/draft-a/${runId}-secret.pdf`;
  const canonicalProtectedPath = `orgs/tenant-a/project-registration-documents/project-a/${runId}-secret.pdf`;
  const ordinaryPath = `orgs/tenant-a/ordinary-uploads/${runId}-allowed.txt`;
  const crossTenantPath = `orgs/tenant-b/ordinary-uploads/${runId}-cross-tenant.txt`;
  const clientApp = initializeApp({
    apiKey: 'demo-api-key',
    projectId,
    storageBucket: bucketName,
  }, `storage-rules-client-${runId}`);
  const adminApp = initializeAdminApp({ projectId, storageBucket: bucketName }, `storage-rules-admin-${runId}`);
  const auth = getAuth(clientApp);
  const storage = getStorage(clientApp);
  const adminBucket = getAdminStorage(adminApp).bucket(bucketName);
  const adminDb = getAdminFirestore(adminApp);
  let memberRef: DocumentReference;

  beforeAll(async () => {
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (!authHost || !storageHost) {
      throw new Error('Auth and Storage emulators are required for Storage rules integration tests');
    }
    const [storageHostname, storagePort] = storageHost.split(':');
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    connectStorageEmulator(storage, storageHostname, Number(storagePort));
    const credential = await createUserWithEmailAndPassword(auth, `storage-rules-${runId}@mysc.co.kr`, 'local-test-password');
    memberRef = adminDb.doc(`orgs/tenant-a/members/${credential.user.uid}`);
    await memberRef.set({
      uid: credential.user.uid,
      email: credential.user.email,
      role: 'pm',
      status: 'ACTIVE',
      tenantId: 'tenant-a',
    });
    await adminBucket.file(protectedPath).save(Buffer.from('private'), { resumable: false });
    await adminBucket.file(canonicalProtectedPath).save(Buffer.from('canonical-private'), { resumable: false });
    await adminBucket.file(ordinaryPath).save(Buffer.from('ordinary'), { resumable: false });
    await adminBucket.file(crossTenantPath).save(Buffer.from('cross-tenant'), { resumable: false });
  });

  afterAll(async () => {
    await signOut(auth).catch(() => undefined);
    await Promise.all([deleteApp(clientApp), deleteAdminApp(adminApp)]);
  });

  it('denies authenticated MYSC users on private drafts while allowing ordinary org objects', async () => {
    const protectedRef = ref(storage, protectedPath);
    const ordinaryRef = ref(storage, ordinaryPath);

    await expect(uploadBytes(protectedRef, Buffer.from('blocked'))).rejects.toMatchObject({
      code: 'storage/unauthorized',
    });
    await expect(getBytes(protectedRef)).rejects.toMatchObject({ code: 'storage/unauthorized' });

    await uploadBytes(ordinaryRef, Buffer.from('allowed'));
    const ordinaryBytes = await getBytes(ordinaryRef);
    expect(new Uint8Array(ordinaryBytes)).toEqual(new Uint8Array(Buffer.from('allowed')));
  });

  it('denies direct client reads and writes on canonical private registration documents', async () => {
    const canonicalRef = ref(storage, canonicalProtectedPath);

    await expect(uploadBytes(canonicalRef, Buffer.from('blocked'))).rejects.toMatchObject({
      code: 'storage/unauthorized',
    });
    await expect(getBytes(canonicalRef)).rejects.toMatchObject({ code: 'storage/unauthorized' });
  });

  it('requires an exact active canonical tenant membership for ordinary org objects', async () => {
    const ordinaryRef = ref(storage, ordinaryPath);
    const invalidStatuses = ['INACTIVE', '', null, 7, 'active', ' ACTIVE '];
    await adminBucket.file(ordinaryPath).save(Buffer.from('ordinary'), { resumable: false });

    await expect(getBytes(ref(storage, crossTenantPath))).rejects.toMatchObject({
      code: 'storage/unauthorized',
    });
    await expect(uploadBytes(
      ref(storage, `orgs/tenant-b/ordinary-uploads/${runId}-cross-tenant-write.txt`),
      Buffer.from('blocked'),
    )).rejects.toMatchObject({ code: 'storage/unauthorized' });

    for (const status of invalidStatuses) {
      await memberRef.set({ status }, { merge: true });
      await expect(getBytes(ordinaryRef)).rejects.toMatchObject({ code: 'storage/unauthorized' });
      await expect(uploadBytes(
        ref(storage, `orgs/tenant-a/ordinary-uploads/${runId}-${String(status)}-blocked.txt`),
        Buffer.from('blocked'),
      )).rejects.toMatchObject({ code: 'storage/unauthorized' });
    }

    await memberRef.delete();
    await expect(getBytes(ordinaryRef)).rejects.toMatchObject({ code: 'storage/unauthorized' });

    await memberRef.set({
      uid: auth.currentUser!.uid,
      email: auth.currentUser!.email,
      role: 'pm',
      tenantId: 'tenant-a',
    });
    expect(new Uint8Array(await getBytes(ordinaryRef))).toEqual(new Uint8Array(Buffer.from('ordinary')));
    await uploadBytes(
      ref(storage, `orgs/tenant-a/ordinary-uploads/${runId}-legacy-allowed.txt`),
      Buffer.from('legacy-allowed'),
    );

    await memberRef.set({ status: 'ACTIVE' }, { merge: true });
  });
});
