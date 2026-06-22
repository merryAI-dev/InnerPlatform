/* global console, process */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_ZONE_ID = "a7daef3458ea2eaabdaf2ef8e78e1e3c";
const DEFAULT_ZONE_NAME = "myscguard.app";
const DEFAULT_OUTPUT_DIR = "tmp/cloudflare-security-reports";

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadLocalEnv("infra/cloudflare/.env.cloudflare.local");

const zoneId = process.env.CLOUDFLARE_ZONE_ID || DEFAULT_ZONE_ID;
const zoneName = process.env.CLOUDFLARE_ZONE_NAME || DEFAULT_ZONE_NAME;
const hours = Number(process.env.CLOUDFLARE_SECURITY_REPORT_HOURS || 24);
const lagMinutes = Number(process.env.CLOUDFLARE_SECURITY_REPORT_LAG_MINUTES || 5);
const outputDir = process.env.CLOUDFLARE_SECURITY_REPORT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
const now = new Date();
const end = new Date(now.getTime() - lagMinutes * 60 * 1000);
const start = new Date(end.getTime() - Math.min(hours, 23.9) * 60 * 60 * 1000);

function isoNoMs(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function cloudflareHeaders() {
  if (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) {
    return {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    };
  }

  if (process.env.CLOUDFLARE_EMAIL && process.env.CLOUDFLARE_API_KEY) {
    return {
      "X-Auth-Email": process.env.CLOUDFLARE_EMAIL,
      "X-Auth-Key": process.env.CLOUDFLARE_API_KEY,
      "Content-Type": "application/json",
    };
  }

  throw new Error("Missing Cloudflare credentials. Set CLOUDFLARE_API_TOKEN, or CLOUDFLARE_EMAIL plus CLOUDFLARE_API_KEY.");
}

async function graphql(query, variables) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: cloudflareHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors || payload, null, 2));
  }
  return payload.data.viewer.zones[0];
}

async function queryHttpAggregates() {
  return graphql(`
    query($zone: String!, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          total: httpRequestsAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) { count }
          bySecurity: httpRequestsAdaptiveGroups(
            limit: 20
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) { count dimensions { securityAction securitySource } }
          topPaths: httpRequestsAdaptiveGroups(
            limit: 20
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [count_DESC]
          ) { count dimensions { clientRequestHTTPHost clientRequestPath edgeResponseStatus originResponseStatus } }
          passedPaths: httpRequestsAdaptiveGroups(
            limit: 50
            filter: { datetime_geq: $start, datetime_leq: $end, securityAction: "unknown" }
            orderBy: [count_DESC]
          ) { count dimensions { clientRequestHTTPHost clientRequestPath edgeResponseStatus originResponseStatus userAgent clientIP clientCountryName } }
          passedUserAgents: httpRequestsAdaptiveGroups(
            limit: 20
            filter: { datetime_geq: $start, datetime_leq: $end, securityAction: "unknown" }
            orderBy: [count_DESC]
          ) { count dimensions { userAgent } }
        }
      }
    }
  `, {
    zone: zoneId,
    start: isoNoMs(start),
    end: isoNoMs(end),
  });
}

async function queryFirewallEvents() {
  return graphql(`
    query($zone: String!, $start: Time!, $end: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          events: firewallEventsAdaptive(
            limit: 1000
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_DESC]
          ) {
            action
            source
            ref
            description
            clientIP
            clientCountryName
            clientASNDescription
            clientRequestHTTPHost
            clientRequestHTTPMethodName
            clientRequestPath
            edgeResponseStatus
            originResponseStatus
            userAgent
            datetime
            rayName
          }
        }
      }
    }
  `, {
    zone: zoneId,
    start: isoNoMs(start),
    end: isoNoMs(end),
  });
}

function topBy(items, keyFn, limit = 10) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item) || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + (item.count || 1));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

const suspiciousPathPattern = /(\.env|%2eenv|\.git|\.docker|\.terraform|terraform\.tfstate|dockerfile|docker-compose|stripe\.env|aws\.json|aws\.env|aws-ses\.json|s3\.(yaml|yml|properties)|\.boto|team-provider-info\.json|constants\.yml|serverless\.(yaml|yml)|phpinfo|settings\.py|credentials\.go|parameters\.ya?ml|backend\/env\.js|\/webhooks?\/|%5c)/i;

function dimension(row, name) {
  return row.dimensions?.[name];
}

function summarize(http, firewall) {
  const total = http.total?.[0]?.count || 0;
  const securityRows = http.bySecurity || [];
  const mitigated = securityRows
    .filter((row) => dimension(row, "securityAction") !== "unknown")
    .reduce((sum, row) => sum + row.count, 0);
  const cleanOrUnknown = total - mitigated;
  const events = firewall.events || [];
  const blocked = events.filter((event) => event.action === "block");
  const challenged = events.filter((event) => event.action?.includes("challenge"));
  const blockedAtEdge = blocked.filter((event) => Number(event.originResponseStatus || 0) === 0);
  const suspiciousPassed = (http.passedPaths || []).filter((row) => (
    suspiciousPathPattern.test(dimension(row, "clientRequestPath") || "")
      && Number(dimension(row, "edgeResponseStatus")) < 400
  ));

  return {
    total,
    mitigated,
    cleanOrUnknown,
    securityRows,
    events,
    blocked,
    challenged,
    blockedAtEdge,
    suspiciousPassed,
    topRules: topBy(events, (event) => `${event.ref || event.source || event.action} | ${event.description || ""}`, 8),
    topBlockedIps: topBy(blocked, (event) => `${event.clientIP} ${event.clientCountryName || ""} ${event.clientASNDescription || ""}`.trim(), 8),
    topBlockedPaths: topBy(blocked, (event) => `${event.clientRequestHTTPHost}${event.clientRequestPath}`, 8),
    topPassedPaths: (http.passedPaths || []).slice(0, 10),
    topPassedUserAgents: (http.passedUserAgents || []).slice(0, 10),
  };
}

function pct(part, whole) {
  if (!whole) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function bulletPairs(pairs, formatter = ([key, count]) => `- ${key}: ${count}`) {
  if (!pairs.length) return "- none";
  return pairs.map(formatter).join("\n");
}

function formatSlackReport(summary) {
  const risk = summary.suspiciousPassed.length ? "주의" : "정상";
  const title = `Cloudflare 관제 리포트 - ${zoneName}`;
  const lines = [
    `*${title}*`,
    `기간: ${isoNoMs(start)} ~ ${isoNoMs(end)} UTC`,
    `상태: *${risk}*`,
    "",
    "*요약*",
    `- 총 요청: ${summary.total}`,
    `- Cloudflare 보안 조치: ${summary.mitigated} (${pct(summary.mitigated, summary.total)})`,
    `- 보안 액션 없음/통과: ${summary.cleanOrUnknown} (${pct(summary.cleanOrUnknown, summary.total)})`,
    `- 차단 이벤트 샘플: ${summary.blocked.length}`,
    `- 챌린지 이벤트 샘플: ${summary.challenged.length}`,
    `- edge 차단 확인(origin=0): ${summary.blockedAtEdge.length}`,
    "",
    "*보안 액션별 집계*",
    ...summary.securityRows.map((row) => (
      `- ${dimension(row, "securitySource")}/${dimension(row, "securityAction")}: ${row.count}`
    )),
    "",
    "*상위 차단 룰*",
    bulletPairs(summary.topRules),
    "",
    "*상위 차단 IP*",
    bulletPairs(summary.topBlockedIps),
    "",
    "*주의: 보안 액션 없이 통과한 suspicious path*",
    summary.suspiciousPassed.length
      ? summary.suspiciousPassed.slice(0, 8).map((row) => (
        `- ${dimension(row, "clientRequestHTTPHost")}${dimension(row, "clientRequestPath")} status=${dimension(row, "edgeResponseStatus")}/${dimension(row, "originResponseStatus")} count=${row.count}`
      )).join("\n")
      : "- 없음",
    "",
    "*판단*",
    summary.suspiciousPassed.length
      ? "- 민감 파일명 probing 중 일부가 보안 액션 없이 통과했습니다. WAF 룰 보강이 필요합니다."
      : "- 현재 집계 기준 민감 파일명 probing의 보안 액션 없는 2xx 통과는 확인되지 않았습니다.",
  ];

  return lines.join("\n").slice(0, 5000);
}

async function postToSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    if (process.env.REQUIRE_SLACK_WEBHOOK === "1") {
      throw new Error("Missing SLACK_WEBHOOK_URL while REQUIRE_SLACK_WEBHOOK=1.");
    }
    return null;
  }
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${await response.text()}`);
  }
  return true;
}

fs.mkdirSync(outputDir, { recursive: true });

const http = await queryHttpAggregates();
const firewall = await queryFirewallEvents();
const summary = summarize(http, firewall);
const report = formatSlackReport(summary);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const markdownPath = path.join(outputDir, `cloudflare-security-${stamp}.md`);
const jsonPath = path.join(outputDir, `cloudflare-security-${stamp}.json`);

fs.writeFileSync(markdownPath, `${report}\n`, "utf8");
fs.writeFileSync(jsonPath, JSON.stringify({
  zoneId,
  zoneName,
  window: { start: isoNoMs(start), end: isoNoMs(end) },
  summary,
  http,
  firewall,
}, null, 2), "utf8");

const sent = await postToSlack(report);
console.log(JSON.stringify({
  ok: true,
  slackSent: Boolean(sent),
  markdownPath,
  jsonPath,
  total: summary.total,
  mitigated: summary.mitigated,
  suspiciousPassed: summary.suspiciousPassed.length,
}, null, 2));
