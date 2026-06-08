#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function fail(errors) {
  for (const error of errors) {
    console.error(`[frontend-exposure-policy] ${error}`);
  }
  process.exit(1);
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const policyPath = path.resolve(process.cwd(), 'policies/frontend-exposure-policy.json');
if (!fs.existsSync(policyPath)) {
  fail([`policy file not found: ${policyPath}`]);
}

let policy;
try {
  policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
} catch (error) {
  fail([`invalid policy JSON: ${error instanceof Error ? error.message : String(error)}`]);
}

const checkedPaths = Array.isArray(policy.checkedPaths) ? policy.checkedPaths : [];
const excludedGlobs = Array.isArray(policy.excludedGlobs) ? policy.excludedGlobs.map(String) : [];
const bannedTerms = Array.isArray(policy.bannedFrontendTerms) ? policy.bannedFrontendTerms.map(String).filter(Boolean) : [];
const errors = [];

if (checkedPaths.length === 0) errors.push('checkedPaths must not be empty');
if (bannedTerms.length === 0) errors.push('bannedFrontendTerms must not be empty');

const files = checkedPaths.flatMap((relativePath) => walk(path.resolve(process.cwd(), relativePath)))
  .filter((filePath) => !excludedGlobs.some((needle) => filePath.includes(needle)));

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const term of bannedTerms) {
      if (line.includes(term)) {
        errors.push(`${path.relative(process.cwd(), filePath)}:${index + 1} exposes internal term "${term}"`);
      }
    }
  });
}

if (errors.length > 0) {
  fail(errors);
}

console.log(`[frontend-exposure-policy] ok: ${files.length} frontend files checked`);
