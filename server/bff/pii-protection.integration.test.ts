import { describe, expect, it } from 'vitest';
import { createPiiProtector } from './pii-protection.mjs';

describe('pii protection (local key mode)', () => {
  const keyV1 = Buffer.alloc(32, 1).toString('base64');
  const keyV2 = Buffer.alloc(32, 2).toString('base64');

  it('encrypts and decrypts text with local keyring', async () => {
    const pii = createPiiProtector({
      env: {
        PII_MODE: 'local',
        PII_LOCAL_KEYRING: `v1:${keyV1}`,
        PII_LOCAL_CURRENT_KEY_ID: 'v1',
      } as any,
    });

    expect(pii.enabled).toBe(true);
    const encrypted = await pii.encryptText('secret@example.com');
    expect(encrypted?.ciphertext).toContain('enc:v1:v1:');
    const plain = await pii.decryptText(encrypted!.ciphertext);
    expect(plain).toBe('secret@example.com');
  });

  it('rotates ciphertext to current key', async () => {
    const oldPii = createPiiProtector({
      env: {
        PII_MODE: 'local',
        PII_LOCAL_KEYRING: `v1:${keyV1},v2:${keyV2}`,
        PII_LOCAL_CURRENT_KEY_ID: 'v1',
      } as any,
    });
    const oldEncrypted = await oldPii.encryptText('rotate-me');
    expect(oldEncrypted?.keyRef).toBe('v1');

    const newPii = createPiiProtector({
      env: {
        PII_MODE: 'local',
        PII_LOCAL_KEYRING: `v1:${keyV1},v2:${keyV2}`,
        PII_LOCAL_CURRENT_KEY_ID: 'v2',
      } as any,
    });

    expect(newPii.needsRotation(oldEncrypted!.ciphertext)).toBe(true);
    const rotated = await newPii.rotateCiphertext(oldEncrypted!.ciphertext);
    expect(rotated.changed).toBe(true);
    expect(newPii.extractKeyRef(rotated.ciphertext)).toBe('v2');
    const plain = await newPii.decryptText(rotated.ciphertext);
    expect(plain).toBe('rotate-me');
  });
});
