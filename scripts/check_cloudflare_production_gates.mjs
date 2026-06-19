/* global console, process */

import fs from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
}

function fail(message) {
  failures.push(message);
}

const failures = [];
const warnings = [];
const tfvarsPath = fs.existsSync("infra/cloudflare/production.tfvars")
  ? "infra/cloudflare/production.tfvars"
  : "infra/cloudflare/production.tfvars.example";
const tfvars = fs.readFileSync(tfvarsPath, "utf8");
const allowProPocCompensatingControls = process.env.CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS === "1";
const securityDomainPoc = process.env.CLOUDFLARE_SECURITY_DOMAIN_POC === "1";
const applyApproved = process.env.CLOUDFLARE_EDGE_APPLY_APPROVED === "1";
const requireSmoke = process.env.CLOUDFLARE_EDGE_REQUIRE_SMOKE === "1" || applyApproved;
const hasCloudflareToken = Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim());
const hasPlaceholderZoneId = /replace-with-cloudflare-zone-id|00000000000000000000000000000000/.test(tfvars);
const productionGateDoc = fs.existsSync("docs/security-control-plane/cloudflare-production-gates.md")
  ? fs.readFileSync("docs/security-control-plane/cloudflare-production-gates.md", "utf8")
  : "";

if (!fs.existsSync("docs/security-control-plane/cloudflare-production-gates.md")) {
  fail("Missing Cloudflare/Vercel production gate document.");
}

if (/Status:\s*`draft`/i.test(productionGateDoc)) {
  fail("Production gates are still marked draft.");
}

if (/Status:\s*`candidate`/i.test(productionGateDoc) && !applyApproved) {
  fail("Production gates are candidate-only. Set CLOUDFLARE_EDGE_APPLY_APPROVED=1 only after explicit human approval.");
}

if (applyApproved && !/Status:\s*`approved`/i.test(productionGateDoc)) {
  fail("Production apply approval requires docs/security-control-plane/cloudflare-production-gates.md to be marked Status: `approved`.");
}

if (/config_status\s*=\s*"draft"/.test(tfvars)) {
  fail(`${tfvarsPath} has config_status = "draft".`);
}

if (/TBD|owner-review-required|not-applicable-until|example\.com|replace-with-cloudflare-zone-id|00000000000000000000000000000000/.test(tfvars)) {
  fail(`${tfvarsPath} still contains placeholder values.`);
}

const terraform = run("terraform", ["-version"]);
if (terraform.status !== 0) {
  fail("terraform is not installed or not available on PATH.");
} else {
  const fmt = run("terraform", ["fmt", "-check", "-recursive", "infra/cloudflare"]);
  if (fmt.status !== 0) fail("terraform fmt -check -recursive infra/cloudflare failed.");

  const init = run("terraform", ["-chdir=infra/cloudflare", "init", "-backend=false"]);
  if (init.status !== 0) {
    fail("terraform init -backend=false failed.");
  } else {
    const validate = run("terraform", ["-chdir=infra/cloudflare", "validate"]);
    if (validate.status !== 0) fail("terraform validate failed.");
  }

  const planFile = fs.existsSync("infra/cloudflare/production.tfvars")
    ? "production.tfvars"
    : "production.tfvars.example";
  if (hasPlaceholderZoneId) {
    warnings.push(`Skipping terraform plan in gate guard because ${tfvarsPath} still has a placeholder Cloudflare zone id.`);
  } else if (!hasCloudflareToken && !applyApproved) {
    warnings.push("Skipping terraform plan because CLOUDFLARE_API_TOKEN is not set. Final apply gate requires the token.");
  } else if (!hasCloudflareToken && applyApproved) {
    fail("CLOUDFLARE_API_TOKEN is required for approved production apply gate.");
  } else {
    const plan = run("terraform", ["-chdir=infra/cloudflare", "plan", `-var-file=${planFile}`]);
    if (plan.status !== 0) fail(`terraform plan -var-file=${planFile} failed.`);
  }
}

const inventoryPath = "tmp/edge-inventory/vercel-edge-inventory.md";
if (!fs.existsSync(inventoryPath)) {
  warnings.push("No tmp/edge-inventory/vercel-edge-inventory.md found. Run node scripts/collect_vercel_edge_inventory.mjs first.");
} else {
  const inventory = fs.readFileSync(inventoryPath, "utf8");
  if (/\| yes \|/.test(inventory) && !allowProPocCompensatingControls && !securityDomainPoc) {
    fail("Inventory still shows direct *.vercel.app production routes.");
  } else if (/\| yes \|/.test(inventory)) {
    warnings.push("Direct *.vercel.app routes are accepted only under the Cloudflare Pro POC compensating-control decision.");
  }
  if (/TBD|owner-review-required|not-applicable-until/.test(inventory) && !securityDomainPoc) {
    fail("Inventory still has unapproved domain/origin/owner fields.");
  } else if (/TBD|owner-review-required|not-applicable-until/.test(inventory)) {
    warnings.push("Product app inventory has unresolved owner/origin fields; this is out of scope for the security-domain POC.");
  }
}

if (failures.length) {
  console.error("Cloudflare/Vercel production gate: BLOCKED");
  for (const item of failures) console.error(`- ${item}`);
  for (const item of warnings) console.error(`- Warning: ${item}`);
  process.exit(1);
}

if (requireSmoke) {
  const smokePath = "tmp/edge-smoke/cloudflare-edge-smoke.json";
  if (!fs.existsSync(smokePath)) {
    fail("Missing edge smoke evidence. Run npm run security:edge-smoke first.");
  } else {
    const smoke = JSON.parse(fs.readFileSync(smokePath, "utf8"));
    const ageMs = Date.now() - Date.parse(smoke.generatedAt || 0);
    if (!smoke.ok) fail("Edge smoke evidence exists but did not pass.");
    if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) {
      fail("Edge smoke evidence is older than 24 hours.");
    }
    if (process.env.CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE === "1" && !smoke.requireCloudflare) {
      fail("Edge smoke evidence was not captured with CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1.");
    }
    if (process.env.CLOUDFLARE_EDGE_REQUIRE_REDIRECTS === "1" && !smoke.requireRedirects) {
      fail("Edge smoke evidence was not captured with CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1.");
    }
  }
}

if (failures.length) {
  console.error("Cloudflare/Vercel production gate: BLOCKED");
  for (const item of failures) console.error(`- ${item}`);
  for (const item of warnings) console.error(`- Warning: ${item}`);
  process.exit(1);
}

console.log("Cloudflare/Vercel production gate: pass");
for (const item of warnings) console.log(`Warning: ${item}`);
