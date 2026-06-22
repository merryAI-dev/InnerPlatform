# Cloudflare Security Daily Report Runbook

## Purpose

Generate a daily Cloudflare security report for `myscguard.app` and send it to Slack.

## Schedule

GitHub Actions workflow:

- `.github/workflows/cloudflare-security-daily-report.yml`
- Runs daily at `00:00 UTC` / `09:00 Asia/Seoul`
- Can also be run manually with `workflow_dispatch`

## Required GitHub Secrets

Prefer scoped API tokens over global API keys.

Required:

- `CLOUDFLARE_ZONE_ID`
- `CLOUDFLARE_API_TOKEN`

Alternative Cloudflare auth:

- `CLOUDFLARE_EMAIL`
- `CLOUDFLARE_API_KEY`

Slack delivery:

- `SLACK_WEBHOOK_URL`

## Local Run

Local credentials may be stored in:

- `infra/cloudflare/.env.cloudflare.local`

Run:

```bash
npm run security:cloudflare:daily-report
```

Output:

- `tmp/cloudflare-security-reports/*.md`
- `tmp/cloudflare-security-reports/*.json`

If `SLACK_WEBHOOK_URL` is set, the script sends the Markdown summary to Slack.

## Report Signals

The report tracks:

- total HTTP requests
- Cloudflare security actions
- blocked requests
- managed challenges
- top blocking rules
- top blocked IPs
- suspicious paths that passed without security action

The most important daily field is:

```text
주의: 보안 액션 없이 통과한 suspicious path
```

If this is not `없음`, review the path and add/adjust WAF rules.

## Notes

- `unknown/unknown` means Cloudflare did not apply a security action. It does not mean compromise.
- `originResponseStatus=0` on blocked events is evidence that Cloudflare handled the response before origin returned content.
- SPA fallback HTML `200` is not itself data leakage, but suspicious probing paths should still be blocked at the edge.
