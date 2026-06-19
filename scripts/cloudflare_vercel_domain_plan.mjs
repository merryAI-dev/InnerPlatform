/* global console, process */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function printUsage() {
  console.log(`Usage:
  node scripts/cloudflare_vercel_domain_plan.mjs <manifest.json> [--apply]

Manifest shape:
[
  { "project": "inner-platform", "hostname": "myscube.myscguard.app" }
]

Without --apply this prints the Vercel commands only.

Vercel CLI v54 adds domains to the linked project. The --apply path links
each project in tmp/vercel-domain-links/<project> before adding hostnames, so
the repository's existing .vercel link is not changed.
`);
}

const manifestPath = process.argv[2];
const shouldApply = process.argv.includes("--apply");

if (!manifestPath) {
  printUsage();
  process.exit(1);
}

if (shouldApply && process.env.CLOUDFLARE_EDGE_APPLY_APPROVED !== "1") {
  console.error("Refusing --apply. Set CLOUDFLARE_EDGE_APPLY_APPROVED=1 only after the production gates are approved.");
  process.exit(1);
}

const apps = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(apps)) {
  throw new Error("Manifest must be a JSON array.");
}

const linkedProjects = new Set();

for (const app of apps) {
  const project = String(app.project || "").trim();
  const hostname = String(app.hostname || "").trim();
  if (!project || !hostname) {
    throw new Error(`Invalid app entry: ${JSON.stringify(app)}`);
  }
  if (shouldApply && (/\.example\.com$/i.test(hostname) || hostname.toUpperCase() === "TBD")) {
    throw new Error(`Refusing to apply placeholder hostname: ${hostname}`);
  }

  const linkDir = path.join("tmp", "vercel-domain-links", project);
  const linkArgs = ["link", "--yes", "--scope", "merryai-devs-projects", "--project", project, "--cwd", linkDir];
  const addArgs = ["domains", "add", hostname, "--scope", "merryai-devs-projects", "--cwd", linkDir];
  if (!linkedProjects.has(project)) {
    console.log(`mkdir -p ${linkDir}`);
    console.log(`vercel ${linkArgs.join(" ")}`);
  }
  console.log(`vercel ${addArgs.join(" ")}`);
  if (!shouldApply) {
    linkedProjects.add(project);
    continue;
  }

  fs.mkdirSync(linkDir, { recursive: true });
  if (!linkedProjects.has(project)) {
    const linkResult = spawnSync("vercel", linkArgs, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (linkResult.status !== 0) {
      process.exit(linkResult.status || 1);
    }
    linkedProjects.add(project);
  }

  const result = spawnSync("vercel", addArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
