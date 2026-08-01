/* global console, process */

import fs from "node:fs";

const CANONICAL_PRODUCTION_ORIGIN = "https://myscube.myscguard.app";
const CANONICAL_PRODUCTION_DESTINATION = `${CANONICAL_PRODUCTION_ORIGIN}/:path*`;
const INTERNAL_STAGE_HOST = "inner-platform-internal-stage-merryai-devs-projects.vercel.app";
const LEGACY_STAGE_HOST = "inner-platform-stage-merryai-devs-projects.vercel.app";
const ROUTE_VERSION_ALIAS = "inner-platform-f52434-routes-merryai-devs-projects.vercel.app";
const REQUIRED_PROTECTED_OR_REDIRECT_HOSTS = [
  "submit-mysc.com",
  "inner-platform-merryai-devs-projects.vercel.app",
  "inner-platform-merryai-dev-merryai-devs-projects.vercel.app",
];

const REQUIRED_PRODUCTION_DIRECT_HOSTS = [
  "inner-platform.vercel.app",
  "inner-platform-h799435np-merryai-devs-projects.vercel.app",
  "inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app",
  "inner-platform-gq6813nqh-merryai-devs-projects.vercel.app",
  "inner-platform-k2x121b33-merryai-devs-projects.vercel.app",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeHost(host) {
  return String(host || "").trim().toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values.map(normalizeHost).filter(Boolean))].sort();
}

function readText(path) {
  return fs.readFileSync(path, "utf8");
}

function productionRedirectHosts(vercelConfig) {
  const hosts = [];
  for (const redirect of asArray(vercelConfig.redirects)) {
    if (redirect.destination !== CANONICAL_PRODUCTION_DESTINATION) continue;
    if (redirect.permanent !== false) continue;
    for (const predicate of asArray(redirect.has)) {
      if (predicate?.type === "host") hosts.push(predicate.value);
    }
  }
  return uniqueSorted(hosts);
}

function extractDefaultDirectHosts(smokeScriptText) {
  const match = smokeScriptText.match(/const\s+defaultDirectHosts\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  const hosts = [];
  const stringLiteral = /["']([^"']+)["']/g;
  let literal;
  while ((literal = stringLiteral.exec(match[1]))) hosts.push(literal[1]);
  return uniqueSorted(hosts);
}

function missingFrom(actual, expected) {
  const actualSet = new Set(actual.map(normalizeHost));
  return expected.map(normalizeHost).filter((host) => !actualSet.has(host));
}

function unexpectedFrom(actual, expected) {
  const expectedSet = new Set(expected.map(normalizeHost));
  return actual.map(normalizeHost).filter((host) => !expectedSet.has(host));
}

export function isRemovedVercelDeployment(status, vercelError) {
  return status === 404
    || (status === 410 && ["GONE", "DEPLOYMENT_NOT_FOUND"].includes(String(vercelError || "").toUpperCase()));
}

export function isVercelProtectedRedirect(status, location) {
  return status === 302 && String(location || "").startsWith("https://vercel.com/sso-api?");
}

export function evaluateVercelEdgeRoutePolicy({
  vercelConfig,
  stageWorkflowText,
  smokeScriptText,
}) {
  const failures = [];
  const warnings = [];
  const stageHosts = uniqueSorted([INTERNAL_STAGE_HOST, LEGACY_STAGE_HOST]);
  const routeHosts = productionRedirectHosts(vercelConfig);
  const smokeHosts = extractDefaultDirectHosts(smokeScriptText);
  const requiredDirectHosts = uniqueSorted(REQUIRED_PRODUCTION_DIRECT_HOSTS);
  const requiredSmokeHosts = uniqueSorted([
    ...REQUIRED_PRODUCTION_DIRECT_HOSTS,
    ...REQUIRED_PROTECTED_OR_REDIRECT_HOSTS,
    ROUTE_VERSION_ALIAS,
  ]);

  const routedStageHosts = routeHosts.filter((host) => stageHosts.includes(host));
  if (routedStageHosts.length) {
    failures.push(`Stage hosts must not redirect to ${CANONICAL_PRODUCTION_ORIGIN}: ${routedStageHosts.join(", ")}`);
  }

  const smokeStageHosts = smokeHosts.filter((host) => stageHosts.includes(host));
  if (smokeStageHosts.length) {
    failures.push(`Stage hosts must not be included in production direct-origin smoke hosts: ${smokeStageHosts.join(", ")}`);
  }

  const missingProductionRoutes = missingFrom(routeHosts, requiredDirectHosts);
  if (missingProductionRoutes.length) {
    failures.push(`Missing production direct-origin redirects: ${missingProductionRoutes.join(", ")}`);
  }

  const unexpectedProductionRoutes = unexpectedFrom(routeHosts, requiredDirectHosts);
  if (unexpectedProductionRoutes.length) {
    failures.push(`Unexpected production direct-origin redirects: ${unexpectedProductionRoutes.join(", ")}`);
  }

  const missingSmokeHosts = missingFrom(smokeHosts, requiredSmokeHosts);
  if (missingSmokeHosts.length) {
    failures.push(`Missing production direct-origin smoke hosts: ${missingSmokeHosts.join(", ")}`);
  }

  const unexpectedSmokeHosts = unexpectedFrom(smokeHosts, requiredSmokeHosts);
  if (unexpectedSmokeHosts.length) {
    failures.push(`Unexpected production direct-origin smoke hosts: ${unexpectedSmokeHosts.join(", ")}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    routeHosts,
    smokeHosts,
    requiredDirectHosts,
    requiredSmokeHosts,
  };
}

export function evaluateRepoVercelEdgeRoutePolicy({
  vercelPath = "vercel.json",
  smokeScriptPath = "scripts/smoke_cloudflare_edge.mjs",
} = {}) {
  return evaluateVercelEdgeRoutePolicy({
    vercelConfig: JSON.parse(readText(vercelPath)),
    smokeScriptText: readText(smokeScriptPath),
  });
}

function main() {
  const result = evaluateRepoVercelEdgeRoutePolicy();
  if (!result.ok) {
    console.error("Vercel edge route policy: BLOCKED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Vercel edge route policy: pass");
  console.log(`Production direct-origin redirects: ${result.routeHosts.join(", ")}`);
  console.log(`Strict smoke direct-origin hosts: ${result.smokeHosts.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
