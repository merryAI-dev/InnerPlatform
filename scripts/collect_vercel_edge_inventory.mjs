/* global console, process */

import fs from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function extractDomainRefs() {
  const result = run("rg", [
    "-n",
    "vercel\\.app|firebaseapp\\.com|web\\.app|BFF_ALLOWED_ORIGINS|__/auth|allowedOrigins",
    "server",
    "src",
    "vercel.json",
    ".env.example",
    ".env.development",
    "docs",
  ]);
  return result.ok || result.stdout ? result.stdout.trim().split("\n").filter(Boolean) : [];
}

function extractDeploymentProject(url) {
  const host = String(url || "").replace(/^https?:\/\//, "").split("/")[0];
  if (!host.endsWith(".vercel.app")) return "";
  return host.replace(/-[a-z0-9]+-merryai-devs-projects\.vercel\.app$/i, "").replace(/\.vercel\.app$/i, "");
}

const scope = process.env.VERCEL_SCOPE || "merryai-devs-projects";
const outputDir = process.argv[2] || "tmp/edge-inventory";
fs.mkdirSync(outputDir, { recursive: true });

const projectList = run("vercel", ["project", "list", "--scope", scope, "--format", "json"]);
if (!projectList.ok) {
  console.error(projectList.stderr || "vercel project list failed");
  process.exit(projectList.status || 1);
}

const deploymentList = run("vercel", ["ls", "--yes", "--scope", scope]);
const projectsPayload = parseJson(projectList.stdout, { projects: [] });
const projects = Array.isArray(projectsPayload.projects) ? projectsPayload.projects : [];
const deploymentUrls = deploymentList.stdout
  .trim()
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("https://"));
const codeRefs = extractDomainRefs();

const projectRows = projects.map((project) => ({
  projectName: project.name || "",
  projectId: project.id || "",
  latestProductionUrl: project.latestProductionUrl || "",
  nodeVersion: project.nodeVersion || "",
  deprecated: project.deprecated ?? "",
  directVercelProduction:
    typeof project.latestProductionUrl === "string" && project.latestProductionUrl.endsWith(".vercel.app"),
  productionDomain: "",
  previewDomainPolicy: "owner-review-required",
  firebaseAuthDomain: "not-applicable-until-auth-confirmed",
  bffAllowedOrigin: "not-applicable-until-bff-confirmed",
  cloudflareHostname: "owner-review-required",
  owner: "owner-review-required",
  cutoverStatus: "draft",
}));

const csv = [
  [
    "projectName",
    "projectId",
    "latestProductionUrl",
    "directVercelProduction",
    "productionDomain",
    "previewDomainPolicy",
    "firebaseAuthDomain",
    "bffAllowedOrigin",
    "cloudflareHostname",
    "owner",
    "cutoverStatus",
  ].map(csvCell).join(","),
  ...projectRows.map((row) => [
    row.projectName,
    row.projectId,
    row.latestProductionUrl,
    row.directVercelProduction,
    row.productionDomain,
    row.previewDomainPolicy,
    row.firebaseAuthDomain,
    row.bffAllowedOrigin,
    row.cloudflareHostname,
    row.owner,
    row.cutoverStatus,
  ].map(csvCell).join(",")),
].join("\n");

const markdown = [
  "# Vercel Edge Inventory",
  "",
  `Scope: \`${scope}\``,
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Projects",
  "",
  "| Project | Latest production URL | Direct *.vercel.app? | Production domain | Firebase auth domain | BFF allowed origin | Cloudflare hostname | Status |",
  "|---|---|---:|---|---|---|---|---|",
  ...projectRows.map((row) => (
    `| \`${row.projectName}\` | ${row.latestProductionUrl || "-"} | ${row.directVercelProduction ? "yes" : "no"} | ${row.productionDomain || "owner-review-required"} | ${row.firebaseAuthDomain} | ${row.bffAllowedOrigin} | ${row.cloudflareHostname} | ${row.cutoverStatus} |`
  )),
  "",
  "## Recent Deployment URLs",
  "",
  ...deploymentUrls.map((url) => `- ${url} (${extractDeploymentProject(url) || "unknown"})`),
  "",
  "## Code References Requiring Cutover Review",
  "",
  ...codeRefs.slice(0, 500).map((line) => `- \`${line.replace(/`/g, "\\`")}\``),
  "",
  "## Production Gate Status",
  "",
  "- [ ] Authoritative Vercel project/domain/environment inventory complete",
  "- [ ] Production domain, preview domain, Firebase auth domain, BFF allowed origin table reviewed",
  "- [ ] Direct `*.vercel.app`, `*.firebaseapp.com`, `*.web.app` operational paths removed or explicitly exception-approved",
  "- [ ] Terraform provider v5 `fmt`, `validate`, and `plan` pass",
  "- [ ] Login, Firebase auth redirect, API, upload smoke scenarios pass in monitor mode",
  "- [ ] Cloudflare WAF/log/challenge events ingestion and owner model approved",
  "- [ ] Production apply explicitly approved",
  "",
].join("\n");

fs.writeFileSync(`${outputDir}/vercel-edge-inventory.json`, JSON.stringify({
  scope,
  generatedAt: new Date().toISOString(),
  projects,
  deploymentUrls,
  codeRefs,
}, null, 2));
fs.writeFileSync(`${outputDir}/vercel-edge-inventory.csv`, `${csv}\n`);
fs.writeFileSync(`${outputDir}/vercel-edge-inventory.md`, markdown);

console.log(JSON.stringify({
  scope,
  projectCount: projects.length,
  deploymentUrlCount: deploymentUrls.length,
  codeReferenceCount: codeRefs.length,
  outputDir,
}, null, 2));
