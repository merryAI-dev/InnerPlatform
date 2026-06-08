#!/usr/bin/env node
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const ALLOWED_ROLES = new Set([
  'admin',
  'finance',
  'pm',
  'auditor',
  'viewer',
  'tenant_admin',
  'support',
  'security',
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const [rawKey, inlineValue] = value.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) continue;
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`Invalid role '${value}'. Allowed: ${Array.from(ALLOWED_ROLES).join(', ')}`);
  }
  return role;
}

function parseServiceAccount(env) {
  const rawJson = normalizeText(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const rawBase64 = normalizeText(env.FIREBASE_SERVICE_ACCOUNT_BASE64);
  const raw = rawJson || (rawBase64 ? Buffer.from(rawBase64, 'base64').toString('utf8') : '');
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function resolveProjectId(env) {
  return normalizeText(env.FIREBASE_PROJECT_ID)
    || normalizeText(env.VITE_FIREBASE_PROJECT_ID)
    || normalizeText(env.GOOGLE_CLOUD_PROJECT)
    || normalizeText(env.GCLOUD_PROJECT);
}

function initAdmin(env) {
  if (getApps().length > 0) return getApps()[0];
  const projectId = resolveProjectId(env);
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required.');
  }
  const serviceAccount = parseServiceAccount(env);
  if (serviceAccount) {
    return initializeApp({ projectId, credential: cert(serviceAccount) });
  }
  return initializeApp({ projectId, credential: applicationDefault() });
}

async function resolveUid(auth, args) {
  const uid = normalizeText(args.uid || process.env.FIREBASE_CLAIMS_UID);
  if (uid) return uid;
  const email = normalizeText(args.email || process.env.FIREBASE_CLAIMS_EMAIL).toLowerCase();
  if (!email) {
    throw new Error('--uid or --email is required.');
  }
  return (await auth.getUserByEmail(email)).uid;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  initAdmin(process.env);
  const auth = getAuth();
  const uid = await resolveUid(auth, args);
  const tenantId = normalizeText(args['tenant-id'] || args.tenantId || process.env.FIREBASE_CLAIMS_TENANT_ID).toLowerCase();
  const role = normalizeRole(args.role || process.env.FIREBASE_CLAIMS_ROLE);
  const dryRun = Boolean(args['dry-run'] || args.dryRun);
  const replace = Boolean(args.replace);

  if (!tenantId) {
    throw new Error('--tenant-id is required.');
  }

  const existingUser = await auth.getUser(uid);
  const previousClaims = existingUser.customClaims || {};
  const nextClaims = replace ? {} : { ...previousClaims };
  nextClaims.tenantId = tenantId;
  nextClaims.role = role;

  const result = {
    uid,
    tenantId,
    role,
    dryRun,
    replace,
    previousClaims,
    nextClaims,
  };

  if (!dryRun) {
    await auth.setCustomUserClaims(uid, nextClaims);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`[sync-firebase-member-claims] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
