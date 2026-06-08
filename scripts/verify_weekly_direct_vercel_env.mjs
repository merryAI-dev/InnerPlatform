#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`[weekly-direct-vercel-env] ${message}`);
  process.exit(1);
}

function parseEnvFile(path) {
  const env = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const envPath = process.argv[2];
if (!envPath) {
  fail('usage: node scripts/verify_weekly_direct_vercel_env.mjs <env-file>');
}

const env = parseEnvFile(envPath);
const enabled = String(env.VITE_PLATFORM_API_ENABLED || '').trim().toLowerCase();
const baseUrl = String(env.VITE_PLATFORM_API_BASE_URL || '').trim();
const host = hostOf(baseUrl);
const allowlist = String(process.env.WEEKLY_DIRECT_API_HOST_ALLOWLIST || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

if (enabled !== 'true') {
  fail('VITE_PLATFORM_API_ENABLED must be true for stage/live BFF-free operation.');
}
if (!baseUrl || !baseUrl.startsWith('https://') || !host) {
  fail('VITE_PLATFORM_API_BASE_URL must be an absolute https Java API URL.');
}
if (
  host === 'inner-platform.vercel.app'
  || host.endsWith('.vercel.app')
  || host === 'localhost'
  || host === '127.0.0.1'
  || host === '0.0.0.0'
) {
  fail(`VITE_PLATFORM_API_BASE_URL must bypass Vercel/BFF rewrites, got ${baseUrl}`);
}
if (allowlist.length > 0 && !allowlist.includes(host)) {
  fail(`VITE_PLATFORM_API_BASE_URL host ${host} is not in WEEKLY_DIRECT_API_HOST_ALLOWLIST.`);
}

console.log(`[weekly-direct-vercel-env] ok: ${host}`);
