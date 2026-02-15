import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLocalKeyring(raw) {
  const keyring = new Map();
  for (const item of parseCsv(raw)) {
    const [keyId, base64Key] = item.split(':');
    if (!keyId || !base64Key) continue;

    let decoded;
    try {
      decoded = Buffer.from(base64Key, 'base64');
    } catch {
      continue;
    }
    if (decoded.length !== 32) continue;
    keyring.set(keyId.trim(), decoded);
  }
  return keyring;
}

function parseEncryptedLocal(raw) {
  const parts = String(raw || '').split(':');
  if (parts.length !== 6) return null;
  if (parts[0] !== 'enc' || parts[1] !== 'v1') return null;
  return {
    mode: 'local',
    keyRef: parts[2],
    iv: parts[3],
    tag: parts[4],
    ciphertext: parts[5],
  };
}

function parseEncryptedKms(raw) {
  const parts = String(raw || '').split(':');
  if (parts.length !== 4) return null;
  if (parts[0] !== 'enc' || parts[1] !== 'kms') return null;
  return {
    mode: 'kms',
    keyRef: decodeURIComponent(parts[2]),
    ciphertext: parts[3],
  };
}

function parseEncrypted(raw) {
  return parseEncryptedLocal(raw) || parseEncryptedKms(raw);
}

function maskEmail(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return undefined;
  const [local, domain] = normalized.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2) || '*';
  return `${head}***@${domain}`;
}

function maskName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) return undefined;
  if (normalized.length <= 1) return `${normalized}*`;
  return `${normalized.slice(0, 1)}**`;
}

function encryptLocal(localKeyring, currentKeyRef, plaintext) {
  const key = localKeyring.get(currentKeyRef);
  if (!key) {
    throw new Error(`Missing local PII encryption key: ${currentKeyRef}`);
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = `enc:v1:${currentKeyRef}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;

  return {
    ciphertext,
    keyRef: currentKeyRef,
    mode: 'local',
  };
}

function decryptLocal(localKeyring, parsed) {
  const key = localKeyring.get(parsed.keyRef);
  if (!key) {
    throw new Error(`Unable to decrypt PII value: unknown key ${parsed.keyRef}`);
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function createPiiProtector({ env = process.env } = {}) {
  const modeRaw = String(env.PII_MODE || 'auto').trim().toLowerCase();
  const localKeyring = parseLocalKeyring(env.PII_LOCAL_KEYRING);
  const currentLocalKeyRef = String(env.PII_LOCAL_CURRENT_KEY_ID || '');
  const kmsKeys = parseCsv(env.PII_KMS_KEYS);
  const currentKmsKeyRef = String(env.PII_KMS_CURRENT_KEY || kmsKeys[0] || '');

  const localEnabled = localKeyring.size > 0 && !!currentLocalKeyRef;
  const kmsEnabled = kmsKeys.length > 0 && !!currentKmsKeyRef;

  let mode = 'off';
  if (modeRaw === 'local' && localEnabled) mode = 'local';
  else if (modeRaw === 'kms' && kmsEnabled) mode = 'kms';
  else if (modeRaw === 'auto') {
    if (kmsEnabled) mode = 'kms';
    else if (localEnabled) mode = 'local';
  }

  let kmsClientPromise;
  async function getKmsClient() {
    if (!kmsClientPromise) {
      kmsClientPromise = import('@google-cloud/kms')
        .then((mod) => new mod.KeyManagementServiceClient());
    }
    return kmsClientPromise;
  }

  async function encryptKms(plaintext) {
    const client = await getKmsClient();
    const [result] = await client.encrypt({
      name: currentKmsKeyRef,
      plaintext: Buffer.from(plaintext, 'utf8'),
    });

    return {
      ciphertext: `enc:kms:${encodeURIComponent(currentKmsKeyRef)}:${Buffer.from(result.ciphertext).toString('base64')}`,
      keyRef: currentKmsKeyRef,
      mode: 'kms',
    };
  }

  async function decryptKms(parsed) {
    const keyCandidates = parsed.keyRef ? [parsed.keyRef, ...kmsKeys.filter((k) => k !== parsed.keyRef)] : kmsKeys;
    const client = await getKmsClient();

    for (const keyRef of keyCandidates) {
      try {
        const [result] = await client.decrypt({
          name: keyRef,
          ciphertext: Buffer.from(parsed.ciphertext, 'base64'),
        });
        return Buffer.from(result.plaintext).toString('utf8');
      } catch {
        // try next key
      }
    }
    throw new Error('Unable to decrypt PII value with configured KMS keys');
  }

  function getCurrentKeyRef() {
    if (mode === 'local') return currentLocalKeyRef;
    if (mode === 'kms') return currentKmsKeyRef;
    return null;
  }

  return {
    mode,
    enabled: mode !== 'off',
    currentKeyRef: getCurrentKeyRef(),
    maskEmail,
    maskName,

    async encryptText(value) {
      const raw = typeof value === 'string' ? value.trim() : '';
      if (!raw) return null;
      if (mode === 'off') return { ciphertext: raw, keyRef: null, mode: 'off' };
      if (mode === 'local') return encryptLocal(localKeyring, currentLocalKeyRef, raw);
      return encryptKms(raw);
    },

    async decryptText(value) {
      if (typeof value !== 'string' || !value.trim()) return '';
      const parsed = parseEncrypted(value);
      if (!parsed) return value;

      if (parsed.mode === 'local') return decryptLocal(localKeyring, parsed);
      return decryptKms(parsed);
    },

    extractKeyRef(value) {
      const parsed = parseEncrypted(value);
      return parsed ? parsed.keyRef : null;
    },

    needsRotation(value) {
      const parsed = parseEncrypted(value);
      if (!parsed || mode === 'off') return false;
      return parsed.keyRef !== getCurrentKeyRef();
    },

    async rotateCiphertext(value) {
      if (!this.needsRotation(value)) {
        return { changed: false, ciphertext: value };
      }
      const plain = await this.decryptText(value);
      const encrypted = await this.encryptText(plain);
      return {
        changed: true,
        ciphertext: encrypted?.ciphertext || value,
      };
    },
  };
}
