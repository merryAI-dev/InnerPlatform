#!/usr/bin/env node

const STAGE_AUTH_PROJECT_ID = 'mysc-bmp-14173451';

function readText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function fail(message) {
  console.error(`[firebase-smoke-id-token] ${message}`);
  process.exit(1);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const authProjectId = readText(process.env.JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID);
if (authProjectId !== STAGE_AUTH_PROJECT_ID) {
  fail(`Stage-only Firebase smoke auth requires ${STAGE_AUTH_PROJECT_ID}`);
}

const apiKey = readText(process.env.FIREBASE_WEB_API_KEY, process.env.VITE_FIREBASE_API_KEY);
const email = readText(process.env.JVM_WEEKLY_SMOKE_EMAIL, process.env.FIREBASE_SMOKE_EMAIL);
const password = readText(process.env.JVM_WEEKLY_SMOKE_PASSWORD, process.env.FIREBASE_SMOKE_PASSWORD);
const envOutput = process.argv.includes('--env');

if (!apiKey) fail('FIREBASE_WEB_API_KEY is required.');
if (!email) fail('JVM_WEEKLY_SMOKE_EMAIL is required.');
if (!password) fail('JVM_WEEKLY_SMOKE_PASSWORD is required.');

const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
  redirect: 'error',
});
const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.idToken || !payload?.localId) {
  fail(`Firebase smoke sign-in failed: ${JSON.stringify(payload)}`);
}

if (envOutput) {
  process.stdout.write(`export JVM_WEEKLY_SMOKE_ID_TOKEN=${shellQuote(payload.idToken)}\n`);
  process.stdout.write(`export JVM_WEEKLY_SMOKE_ACTOR_ID=${shellQuote(payload.localId)}\n`);
  if (payload.email) process.stdout.write(`export JVM_WEEKLY_SMOKE_ACTOR_EMAIL=${shellQuote(payload.email)}\n`);
  process.exit(0);
}
process.stdout.write(`${payload.idToken}\n`);
