#!/usr/bin/env npx tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FIRESTORE_SCHEMAS } from './config/firestore-schema.js';
import { SHEET_PROFILES } from './config/sheet-profiles.js';

const REQUIRED_QUERY_COLLECTIONS = ['projects', 'transactions', 'cashflow_weeks', 'members'];
const STALE_COLLECTIONS = ['cashflowWeekSheets'];

function readOrgCollectionValues() {
  const source = readFileSync(resolve('src/app/lib/firebase.ts'), 'utf8');
  const block = source.match(/export const ORG_COLLECTIONS = \{([\s\S]*?)\} as const;/)?.[1] || '';
  return new Set(Array.from(block.matchAll(/:\s*['"]([^'"]+)['"]/g), (match) => match[1]));
}

function main() {
  const orgCollections = readOrgCollectionValues();
  const schemaCollections = new Set(FIRESTORE_SCHEMAS.map((schema) => schema.collection));
  const profileTargets = new Set(SHEET_PROFILES.map((profile) => profile.targetCollection).filter(Boolean));
  const errors: string[] = [];

  for (const collection of REQUIRED_QUERY_COLLECTIONS) {
    if (!orgCollections.has(collection)) errors.push(`ORG_COLLECTIONS missing ${collection}`);
    if (!schemaCollections.has(collection)) errors.push(`FIRESTORE_SCHEMAS missing ${collection}`);
  }

  for (const collection of STALE_COLLECTIONS) {
    if (schemaCollections.has(collection)) errors.push(`FIRESTORE_SCHEMAS still uses stale ${collection}`);
    if (profileTargets.has(collection)) errors.push(`SHEET_PROFILES still uses stale ${collection}`);
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  console.log(`query read model schema OK: ${REQUIRED_QUERY_COLLECTIONS.join(', ')}`);
}

main();
