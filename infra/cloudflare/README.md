# Cloudflare Edge WAF

This directory contains the Cloudflare edge security baseline for MYSCube and related MYSC web apps.

Do not apply this blindly. First confirm:

- The production custom domain is active in Cloudflare.
- The domain is added to Vercel/Firebase as a custom domain.
- `cloudflare_zone_id` points to the production zone.
- DNS records that serve web traffic are proxied.
- Origin TLS works with Cloudflare SSL/TLS mode `Full (strict)`.
- `npm run security:edge-gate` passes from the repository root.

## Required Secrets

For zone lookup only, set a Cloudflare token that can read the target zone:

```bash
export CLOUDFLARE_API_TOKEN=...
npm run security:cloudflare:zone
```

For Terraform plan/apply against the real zone, the token needs DNS edit, zone settings edit, and ruleset edit permissions for the target zone.

## Dry Run

```bash
terraform init
terraform plan \
  -var-file=production.tfvars
```

## Apply

Production apply is forbidden while the gate document remains `candidate` or `draft`.

```bash
terraform apply \
  -var-file=production.tfvars
```

## Production Cutover Order

1. Add the custom domain to Vercel/Firebase origin first.
2. Lower existing DNS TTL before migration when possible.
3. Create Cloudflare DNS records with `proxied = true`. Vercel CLI 54.14.2 requested A records to `76.76.21.21` for the `myscguard.app` subdomains.
4. Set SSL/TLS mode to `Full (strict)`.
5. Enable managed WAF and rate limiting rules.
6. Smoke test login, Firebase auth redirects, BFF API, and PWA assets.
7. Keep Vercel rollback URL ready, but route users only through the Cloudflare domain.
