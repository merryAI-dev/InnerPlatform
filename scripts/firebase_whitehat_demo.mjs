#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_OUTPUT_DIR = "tmp/firebase-whitehat-demo";
const DEFAULT_ORG_ID = "mysc";
const DEFAULT_TIMEOUT_MS = 10_000;
const CANARY_ID = "whitehat-canary-deny-probe";

function parseArgs(argv) {
  const args = {
    allowProd: false,
    allowWriteProbes: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    orgId: process.env.FIREBASE_WHITEHAT_ORG_ID || process.env.VITE_DEFAULT_ORG_ID || DEFAULT_ORG_ID,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || "",
    apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || "",
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-prod") args.allowProd = true;
    else if (arg === "--allow-write-probes") args.allowWriteProbes = true;
    else if (arg === "--org") args.orgId = requireValue(argv, ++i, arg);
    else if (arg === "--project") args.projectId = requireValue(argv, ++i, arg);
    else if (arg === "--api-key") args.apiKey = requireValue(argv, ++i, arg);
    else if (arg === "--storage-bucket") args.storageBucket = requireValue(argv, ++i, arg);
    else if (arg === "--output-dir") args.outputDir = requireValue(argv, ++i, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp() {
  console.log(`Firebase white-hat demo harness

Usage:
  npm run security:firebase:whitehat -- [options]

Options:
  --org <orgId>              Tenant/org id to probe. Default: ${DEFAULT_ORG_ID}
  --project <projectId>      Firebase/GCP project id. Defaults to env.
  --api-key <key>            Firebase Web API key. Defaults to env.
  --storage-bucket <bucket>  Firebase Storage bucket. Defaults to env.
  --allow-prod               Required for projects that look like live/prod.
  --allow-write-probes       Also send expected-denied write requests.
  --output-dir <dir>         Report output directory. Default: ${DEFAULT_OUTPUT_DIR}

Safety:
  - No real document bodies are printed.
  - Read probes are unauthenticated or fake-token only.
  - Write probes are disabled unless --allow-write-probes is set.
  - Production-looking projects require --allow-prod.
`);
}

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function loadLocalEnv() {
  for (const candidate of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    loadDotEnvFile(path.resolve(candidate));
  }
}

function looksProduction(projectId) {
  return /prod|live|bmp|14173451/i.test(projectId);
}

function assertSafeTarget(args) {
  if (!args.projectId) throw new Error("Missing Firebase project id. Set VITE_FIREBASE_PROJECT_ID or pass --project.");
  if (looksProduction(args.projectId) && !args.allowProd) {
    throw new Error(`Project '${args.projectId}' looks like production/live. Re-run with --allow-prod after explicit approval.`);
  }
}

function firestoreDocUrl(projectId, documentPath) {
  const encodedPath = documentPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodedPath}`;
}

function firestoreCollectionUrl(projectId, collectionPath) {
  return `${firestoreDocUrl(projectId, collectionPath)}?pageSize=1`;
}

function storageObjectUrl(bucket, objectPath) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`;
}

function authLookupUrl(apiKey) {
  return `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function classifyStatus(status, expected) {
  if (expected.includes(status)) return "PASS";
  if (status === 200) return "FAIL_OPEN";
  return "REVIEW";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbe(probe) {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetchWithTimeout(probe.url, {
      method: probe.method || "GET",
      headers: probe.headers || {},
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    });
    const body = await response.text();
    const status = response.status;
    const result = classifyStatus(status, probe.expectedStatuses);
    return {
      id: probe.id,
      title: probe.title,
      risk: probe.risk,
      method: probe.method || "GET",
      target: probe.safeTarget,
      expectedStatuses: probe.expectedStatuses,
      status,
      result,
      bodyByteLength: Buffer.byteLength(body),
      bodySha256: sha256(body),
      startedAt,
      endedAt: new Date().toISOString(),
      evidence: response.status === 200
        ? "Unexpected 200. Body intentionally withheld."
        : "No response body printed by design.",
    };
  } catch (error) {
    return {
      id: probe.id,
      title: probe.title,
      risk: probe.risk,
      method: probe.method || "GET",
      target: probe.safeTarget,
      expectedStatuses: probe.expectedStatuses,
      status: "NETWORK_ERROR",
      result: "REVIEW",
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
}

function buildProbes(args) {
  const org = args.orgId;
  const project = args.projectId;
  const probes = [
    {
      id: "firestore-unauth-members-read",
      title: "Unauthenticated direct read of org membership",
      risk: "Tenant membership discovery",
      safeTarget: `firestore: orgs/${org}/members/${CANARY_ID}`,
      url: firestoreDocUrl(project, `orgs/${org}/members/${CANARY_ID}`),
      expectedStatuses: [401, 403, 404],
    },
    {
      id: "firestore-unauth-projects-list",
      title: "Unauthenticated collection list of projects",
      risk: "Bulk business data exposure",
      safeTarget: `firestore: orgs/${org}/projects?pageSize=1`,
      url: firestoreCollectionUrl(project, `orgs/${org}/projects`),
      expectedStatuses: [401, 403],
    },
    {
      id: "firestore-bff-only-contacts-read",
      title: "Direct client read of BFF-only contacts collection",
      risk: "Business-card PII exposure",
      safeTarget: `firestore: orgs/${org}/contacts/${CANARY_ID}`,
      url: firestoreDocUrl(project, `orgs/${org}/contacts/${CANARY_ID}`),
      expectedStatuses: [401, 403, 404],
    },
    {
      id: "firestore-audit-logs-read",
      title: "Unauthenticated audit log read",
      risk: "Security event disclosure",
      safeTarget: `firestore: orgs/${org}/audit_logs/${CANARY_ID}`,
      url: firestoreDocUrl(project, `orgs/${org}/audit_logs/${CANARY_ID}`),
      expectedStatuses: [401, 403, 404],
    },
    {
      id: "firestore-top-level-tenants-read",
      title: "Top-level tenants read",
      risk: "Cross-tenant discovery",
      safeTarget: `firestore: tenants/${CANARY_ID}`,
      url: firestoreDocUrl(project, `tenants/${CANARY_ID}`),
      expectedStatuses: [401, 403, 404],
    },
    {
      id: "firestore-fake-token-projects-list",
      title: "Fake bearer token collection list",
      risk: "Authentication spoofing",
      safeTarget: `firestore: orgs/${org}/projects?pageSize=1`,
      url: firestoreCollectionUrl(project, `orgs/${org}/projects`),
      headers: { Authorization: "Bearer not-a-real-firebase-id-token" },
      expectedStatuses: [401, 403],
    },
  ];

  if (args.apiKey) {
    probes.push({
      id: "auth-fake-token-lookup",
      title: "Firebase Auth fake idToken lookup",
      risk: "Authentication token spoofing",
      safeTarget: "identitytoolkit: accounts:lookup(fake idToken)",
      url: authLookupUrl(args.apiKey),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { idToken: "not-a-real-firebase-id-token" },
      expectedStatuses: [400, 401, 403],
    });
  }

  if (args.storageBucket) {
    probes.push({
      id: "storage-business-card-direct-read",
      title: "Direct read of business-card source image path",
      risk: "Storage PII image exposure",
      safeTarget: `storage: gs://${args.storageBucket}/orgs/${org}/business-cards/${CANARY_ID}.png`,
      url: storageObjectUrl(args.storageBucket, `orgs/${org}/business-cards/${CANARY_ID}.png`),
      expectedStatuses: [401, 403, 404],
    });
  }

  if (args.allowWriteProbes) {
    probes.push({
      id: "firestore-unauth-write-canary",
      title: "Unauthenticated write to canary document",
      risk: "Unauthorized data tampering",
      safeTarget: `firestore: orgs/${org}/whitehat_canary/${CANARY_ID}`,
      url: firestoreDocUrl(project, `orgs/${org}/whitehat_canary/${CANARY_ID}`),
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: {
        fields: {
          probe: { stringValue: "expected-denied" },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      },
      expectedStatuses: [401, 403],
    });
  }

  return probes;
}

function renderMarkdown(report) {
  const rows = report.results.map((item) => (
    `| ${item.result} | ${item.status} | ${item.id} | ${item.risk} | ${item.target} |`
  )).join("\n");
  const failOpen = report.results.filter((item) => item.result === "FAIL_OPEN");
  const review = report.results.filter((item) => item.result === "REVIEW");
  return `# Firebase White-Hat Demo Report

- Generated at: ${report.generatedAt}
- Firebase project: ${report.projectId}
- Org: ${report.orgId}
- Mode: ${report.mode}
- Total probes: ${report.results.length}
- PASS: ${report.summary.pass}
- FAIL_OPEN: ${report.summary.failOpen}
- REVIEW: ${report.summary.review}

## Executive Summary

This harness performs bounded, non-destructive probes against Firebase public APIs.
It does not dump Firestore documents, print response bodies, or attempt persistence.
Any HTTP 200 is treated as FAIL_OPEN because a protected path responded successfully.

${failOpen.length === 0 ? "No protected probe returned HTTP 200." : `FAIL_OPEN probes require immediate review: ${failOpen.map((item) => item.id).join(", ")}`}

${review.length === 0 ? "No probes require manual review." : `Manual review probes: ${review.map((item) => `${item.id}(${item.status})`).join(", ")}`}

## Probe Results

| Result | HTTP status | Probe | Risk | Target |
| --- | ---: | --- | --- | --- |
${rows}

## Notes

- Response bodies are intentionally withheld.
- Body hashes and byte lengths are available in the JSON report for evidence without exposing data.
- Run write probes only with explicit approval: \`--allow-write-probes\`.
`;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  assertSafeTarget(args);

  const probes = buildProbes(args);
  const results = [];
  for (const probe of probes) {
    results.push(await runProbe(probe));
  }

  const summary = {
    pass: results.filter((item) => item.result === "PASS").length,
    failOpen: results.filter((item) => item.result === "FAIL_OPEN").length,
    review: results.filter((item) => item.result === "REVIEW").length,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    projectId: args.projectId,
    orgId: args.orgId,
    mode: args.allowWriteProbes ? "read-plus-expected-denied-write" : "read-only",
    summary,
    results,
  };

  mkdirSync(args.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(args.outputDir, `firebase-whitehat-${stamp}.json`);
  const mdPath = path.join(args.outputDir, `firebase-whitehat-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));

  console.log(`Firebase white-hat demo complete: ${summary.pass}/${results.length} pass, ${summary.failOpen} fail-open, ${summary.review} review`);
  console.log(`Markdown: ${mdPath}`);
  console.log(`JSON: ${jsonPath}`);

  if (summary.failOpen > 0) process.exitCode = 2;
  else if (summary.review > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
