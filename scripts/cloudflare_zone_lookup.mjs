/* global console, process */

const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const zoneName = process.argv[2] || "myscguard.app";

if (!token) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN.");
  process.exit(1);
}

const response = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`, {
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});

const payload = await response.json();
if (!response.ok || !payload.success) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const zone = payload.result?.[0];
if (!zone) {
  console.error(`No Cloudflare zone found for ${zoneName}. Add the zone to Cloudflare first.`);
  process.exit(1);
}

console.log(JSON.stringify({
  id: zone.id,
  name: zone.name,
  status: zone.status,
  nameServers: zone.name_servers,
  originalNameServers: zone.original_name_servers,
}, null, 2));
