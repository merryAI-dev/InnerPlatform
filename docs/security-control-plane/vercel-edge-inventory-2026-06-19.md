# Security Control Plane Edge Inventory Snapshot

Status: `candidate evidence`

Original Vercel inventory was collected from:

```bash
node scripts/collect_vercel_edge_inventory.mjs tmp/edge-inventory
```

Scope: `merryai-devs-projects`

Generated locally: `2026-06-19T01:42:16.908Z`

## Direction Change

The POC no longer uses `mysc.co.kr` or `cube.mysc.co.kr`.

The selected path is a dedicated security/DevOps control-plane domain:

- Registered POC domain: `myscguard.app`
- Vercel project: `inner-platform`

`myscguard.app` was registered through Cloudflare Registrar on 2026-06-19. Expiration is 2027-06-19 with auto-renewal enabled.

## Control Plane Hostnames

| Hostname | Role | Vercel project | Status |
|---|---|---|---|
| `myscube.myscguard.app` | Security operations console | `inner-platform` | Canonical host selected; Cloudflare DNS/proxy apply and edge smoke pending |
| `devops.myscguard.app` | Deployment and infrastructure operations | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied |
| `drive.myscguard.app` | Google Drive permission and sharing monitoring | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied |
| `github.myscguard.app` | GitHub repository and Actions monitoring | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied |
| `firestore.myscguard.app` | Firestore rules, access, and anomaly monitoring | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied |
| `audit.myscguard.app` | Audit and evidence review | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied |
| `edge.myscguard.app` | WAF/canary edge tests | `inner-platform` | Vercel alias points to `inner-platform-h799435np-merryai-devs-projects.vercel.app`; Cloudflare proxied; scanner-path/query WAF smoke passed |

## Original Vercel Inventory Findings

- The authoritative Vercel project count was 16.
- 11 projects exposed latest production URLs through direct `*.vercel.app` hostnames.
- `inner-platform` latest production URL was `https://submit-mysc.com`.
- These product app routes are out of scope for the security-domain POC.

## Cleanup Completed

- `cube.mysc.co.kr` was removed from Firebase Auth authorized domains after the direction changed.
- The temporary Vercel `mysc.co.kr` domain entry was removed.

## Remaining Evidence Needed

- Deploy the updated production workflow from `main`, apply Cloudflare DNS/proxy, and rerun edge smoke so `myscube.myscguard.app` becomes the official production gate URL.
