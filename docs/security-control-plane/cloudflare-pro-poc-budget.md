# Cloudflare Pro POC Budget

Status: `candidate`

Decision: buy a dedicated security/DevOps control-plane domain and attach Cloudflare Pro. Do not use `mysc.co.kr` for the POC. Do not make the new domain the public MYSCube product domain.

Primary domain: `myscguard.app`

Registration completed on 2026-06-19 through Cloudflare Registrar. The domain expires on 2027-06-19 and auto-renewal is enabled.

## Budget

| Item | Decision | Cost |
|---|---|---:|
| Cloudflare plan | Pro | USD 20/month |
| Domain | `myscguard.app` registered | paid through 2027-06-19 |
| Vercel Advanced Deployment Protection | Out of scope | USD 0 |
| Vercel Enterprise | Out of scope | USD 0 |
| Cloudflare Log Explorer | Not required for POC; use dashboard Security Events first | USD 0 |

Expected first-year POC budget: about `USD 250-270`.

## Domain Role

This domain is for MYSC security operations, DevOps, and audit control plane workloads:

| Hostname | Role |
|---|---|
| `myscube.myscguard.app` | Security operations console |
| `devops.myscguard.app` | Deployment and infrastructure operations |
| `drive.myscguard.app` | Google Drive permission and sharing monitoring |
| `github.myscguard.app` | GitHub repository and Actions monitoring |
| `firestore.myscguard.app` | Firestore rules, access, and anomaly monitoring |
| `audit.myscguard.app` | Audit and evidence review |
| `edge.myscguard.app` | WAF/canary edge tests |

## Explicit Non-Goals

- This does not replace `cube.mysc.co.kr` or any future MYSCube product domain.
- This does not put MYSCube customer traffic behind Cloudflare yet.
- This does not technically eliminate direct `*.vercel.app` access for product apps.

## POC Scope

Vercel project: `inner-platform`

Initial hostnames:

- `myscube.myscguard.app`
- `devops.myscguard.app`
- `drive.myscguard.app`
- `github.myscguard.app`
- `firestore.myscguard.app`
- `audit.myscguard.app`
- `edge.myscguard.app`

Use Cloudflare dashboard Security Events during POC. Add Logpush later only if the POC graduates.
