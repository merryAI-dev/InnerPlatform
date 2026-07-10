import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
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
  const ordinaryPath = `orgs/tenant-a/ordinary-uploads/${runId}-allowed.txt`;
  const clientApp = initializeApp({
    apiKey: 'demo-api-key',
    projectId,
    storageBucket: bucketName,
  }, `storage-rules-client-${runId}`);
  const adminApp = initializeAdminApp({ projectId, storageBucket: bucketName }, `storage-rules-admin-${runId}`);
  const auth = getAuth(clientApp);
  const storage = getStorage(clientApp);
  const adminBucket = getAdminStorage(adminApp).bucket(bucketName);

  beforeAll(async () => {
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (!authHost || !storageHost) {
      throw new Error('Auth and Storage emulators are required for Storage rules integration tests');
    }
    const [storageHostname, storagePort] = storageHost.split(':');
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    connectStorageEmulator(storage, storageHostname, Number(storagePort));
    await createUserWithEmailAndPassword(auth, `storage-rules-${runId}@mysc.co.kr`, 'local-test-password');
    await adminBucket.file(protectedPath).save(Buffer.from('private'), { resumable: false });
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
});
