# MYSCube myscguard Cutover Retrospective

Date: 2026-06-19
Status: active policy

## Summary

`myscube.myscguard.app` cutover took longer than expected because app deployment, Firebase Auth, Vercel custom-domain certificate issuance, Cloudflare DNS/proxy mode, Vercel alias promotion, and stage redirect smoke were handled as one moving target.

The financeWeek code change itself was already merged and tested. The long tail came from release infrastructure state that was not aligned before the stage/live deploy attempts started.

## What Made It Slow

1. Domain requirements changed during deploy verification.
   - The release started with `soc.myscguard.app` still active.
   - `myscube.myscguard.app` was added during the same change window.
   - Firebase Auth, BFF origins, Vercel aliases, Cloudflare DNS, and stage redirect expectations all had to move together.

2. Stage smoke expected the new canonical host before the edge path was fully ready.
   - Stage artifact and alias promotion succeeded.
   - The visible failure was the stage host redirecting to `soc.myscguard.app` while the workflow expected `myscube.myscguard.app`.
   - The fix was to deploy the commit containing the updated `vercel.json` redirect and verify the actual stage host after alias promotion.

3. Production was retried before all gates were ready.
   - One production run started before the exact `main` CI run had completed.
   - Later production artifacts deployed successfully, but alias promotion failed until the `myscube.myscguard.app` DNS and certificate path were prepared.

4. Vercel certificate issuance needed a DNS-only bootstrap.
   - Cloudflare proxied `A` records can produce `525` until Vercel has issued the certificate for the custom domain.
   - The working sequence was:
     - create the Cloudflare record,
     - temporarily set `myscube.myscguard.app` to DNS-only,
     - run production deploy so Vercel can issue and verify the certificate,
     - return the record to proxied,
     - verify Cloudflare edge returns 200.

5. BFF origin configuration and runtime safety were a separate live blocker.
   - Live BFF must allow the actual browser origin.
   - During the cutover, `BFF_ALLOWED_ORIGINS` and `BFF_LIVE_ALLOWED_ORIGINS` had to include the active Cloudflare hosts.
   - Any mismatch surfaces as live BFF health/API failure even when the frontend artifact is correct.

6. Firebase Auth authorized domains were checked against the wrong project first.
   - `mysc-bmp-14173451` had `myscube.myscguard.app`, but live users were using Firebase project `inner-platform-live-20260316`.
   - The correct live Identity Toolkit project number was `969339097899`.
   - `soc.myscguard.app` and `myscube.myscguard.app` both had to be present in the live project's Firebase Auth authorized domains before Google login could work.

7. Frontend Firebase allowed-host env is build-time configuration.
   - `VITE_FIREBASE_AUTH_ALLOWED_HOSTS` is compiled into the Vite bundle.
   - Updating Vercel env alone does not change the already-deployed JS.
   - After updating production env, a fresh GitHub Actions Production Deploy is required.
   - Browser network logs showing an old `assets/index-*.js` from disk cache mean the user is still running the previous bundle.

8. Some existing docs referenced stale Vercel route commands.
   - The documented `vercel routes` command was not available in the current CLI.
   - Current deployment protection is primarily through deployment `vercel.json` redirects and the fixed stage/live alias workflow.
   - Do not spend time trying to make a missing CLI subcommand work during a hotfix; verify the actual deployed routing surface instead.

9. Local resolver cache produced a false negative.
   - Public DNS and Cloudflare API showed the new `myscube` record correctly.
   - macOS `getaddrinfo` remained stale, so local `curl` and the final live PWA verify fetch failed.
   - Use `dig @1.1.1.1`, `dig @8.8.8.8`, Cloudflare API evidence, and `curl --resolve` when local resolver cache disagrees.

10. Stage-only UI/API work was merged to `main`, so production inherited it.
   - `feat(cashflow): add stage guide dialog` and `fix(stage): merge rescue cashflow snapshot into main` put the cashflow sheet-lab surface on the shared production branch.
   - Stage and live can share financeWeek policy code, but stage-only UX and experimental API surfaces must have an explicit live exposure guard.
   - A production deploy from `main` is enough to expose stage-only UI unless the route, navigation, embedded component, and BFF mount are all guarded.

## Policy For Next Time

Do not start repeated stage/live retries until this preflight is complete.

1. Canonical host is fixed in one place.
   - Confirm the active host name.
   - Confirm whether legacy hosts stay alive or are removed.
   - Confirm the stage redirect expectation before running the stage workflow.

2. Firebase Auth is ready before user-facing verification.
   - Confirm every active login host is in Firebase Auth authorized domains for the actual Firebase project used by the deployed browser bundle.
   - Pull or inspect production env to confirm `VITE_FIREBASE_PROJECT_ID` before editing Identity Toolkit config.
   - For this POC, both `soc.myscguard.app` and `myscube.myscguard.app` may remain authorized during transition.

3. Browser and BFF live origins are ready before production deploy.
   - Confirm `VITE_FIREBASE_AUTH_ALLOWED_HOSTS` includes the active Cloudflare host.
   - Confirm `VITE_FIREBASE_AUTH_FALLBACK_URL` points to the canonical host.
   - Confirm Vercel production env includes the active Cloudflare host.
   - Do not rely on source-code defaults alone during a domain cutover.

4. New Vercel custom domains use DNS-only for certificate bootstrap.
   - Create Cloudflare DNS record.
   - Set new host DNS-only while Vercel issues the certificate.
   - Promote the Vercel production alias.
   - Verify the alias is READY.
   - Return the DNS record to proxied.
   - Confirm Terraform plan returns no changes.

5. Do not rerun the same failing workflow without changing the failed external state.
   - If production fails at CI gate, wait for CI success.
   - If production fails at alias/certificate, fix DNS/custom-domain state first.
   - If stage fails at redirect smoke, verify the deployment `vercel.json` and actual stage alias target first.

6. Deployment authority remains GitHub Actions.
   - Local production deployment is still forbidden.
   - Local verification and Cloudflare DNS/Terraform operations are allowed only when the relevant production gate has explicit approval.

7. Record run IDs and external changes as part of the release note.
   - CI run ID
   - stage workflow run ID
   - Production Deploy run ID
   - Vercel deployment URL
   - Cloudflare DNS record id and final proxied state
   - Firebase Auth authorized-domain evidence

8. Keep stage-only product surfaces out of live by default.
   - Do not merge a stage-only UI/API to `main` without a live exposure guard.
   - The guard must cover all entry points: nav item, direct route, embedded component, and BFF route mount.
   - The guard must not branch financeWeek calculation, financeYear, financeMonth, or financeWeek persistence logic.
   - Add tests that prove live hosts hide the stage-only UI and live BFF returns 404 for the stage-only API.
   - If the stage-only surface should become live, ship a separate release note and verification checklist that explicitly says it is no longer stage-only.

## Required Cutover Order

Use this order for the next canonical-host or live-origin change.

```text
1. Merge code to main.
2. Wait for CI success on the exact commit.
3. Confirm Firebase Auth authorized domains.
4. Confirm Vercel production build env:
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_AUTH_ALLOWED_HOSTS`
   - `VITE_FIREBASE_AUTH_FALLBACK_URL`
   - BFF allowed origins
5. Add or update Vercel custom domain.
6. Add Cloudflare DNS record as DNS-only for new custom domains.
7. Run Production Deploy from GitHub Actions.
8. Confirm production alias points to the new deployment.
9. Confirm the live HTML references a new `assets/index-*.js` and that the new JS contains the active host.
10. Switch Cloudflare record back to proxied.
11. Run Terraform plan and require "No changes".
12. Run the stage release workflow from GitHub Actions.
13. Verify stage redirects to the canonical host.
14. Verify live root, health, PWA package, and critical BFF API paths.
15. Only then report completion.
```

If step 7 is not possible because CI has not passed, stop. Do not start production deploy.

If step 8 fails because of certificate issuance, stop and re-check DNS-only custom-domain bootstrap. Do not keep rerunning production deploy against a proxied-only hostname.

## FinanceWeek Release-Specific Guard

For financeWeek changes, stage and live must use the same shared code path.

Required checks:

```bash
node --input-type=module - <<'NODE'
import { resolveFinanceWeekForDate, getMonthFinanceWeeks } from './src/app/platform/cashflow-week-core.mjs';
console.log(resolveFinanceWeekForDate('2026-06-29'));
console.log(resolveFinanceWeekForDate('2026-07-01'));
console.log(resolveFinanceWeekForDate('2026-08-31'));
console.log(getMonthFinanceWeeks('2026-08'));
NODE

npm test -- \
  src/app/platform/cashflow-weeks.test.ts \
  server/bff/cashflow-canonical-store.test.mjs \
  server/bff/cashflow-export.test.mjs \
  server/bff/routes/cashflow-sheet-lab.test.mjs
```

Expected results:

- `2026-06-29` -> `financeMonth 6`, `financeWeek 5`
- `2026-07-01` -> `financeMonth 7`, `financeWeek 1`
- `2026-08-31` -> `rawWeek 6`, `financeWeek 5`
- `2026-08` week 5 spans `2026-08-24` through `2026-08-31`

## Verification Evidence From This Cutover

- CI: `27809537585`, success, commit `1fa2109b08bed7e4fdd9310e60c1fd75cc8636e1`
- Stage release workflow: `27809537572`, success
- Production Deploy: `27810019703`, success
- Production alias: `myscube.myscguard.app` -> `inner-platform-c6l6kne74-merryai-devs-projects.vercel.app`
- Follow-up Production Deploy after live Firebase env correction:
  - `27810428034` rebuilt production with `VITE_FIREBASE_AUTH_ALLOWED_HOSTS` containing `myscube.myscguard.app`.
  - Vercel alias promotion succeeded and `myscube.myscguard.app` pointed to `inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app`.
  - The workflow failed only at the PWA smoke step because Cloudflare returned `403` to the GitHub Actions runner. Direct browser-path checks through Cloudflare returned 200.
- Live bundle after Firebase env correction:
  - `assets/index-DlYCdEEq.js`
  - contains `soc.myscguard.app` and `myscube.myscguard.app` in `VITE_FIREBASE_AUTH_ALLOWED_HOSTS`.
- Cloudflare DNS: `myscube.myscguard.app`, `A 76.76.21.21`, proxied `true`
- Terraform final plan: `No changes`
- Live Firebase Auth project `inner-platform-live-20260316` authorized domains include:
  - `soc.myscguard.app`
  - `myscube.myscguard.app`
- Fixed stage alias redirects:
  - the stage Vercel alias root -> `https://myscube.myscguard.app/`
- Live health:
  - `https://myscube.myscguard.app/api/v1/health` returned 200 through Cloudflare edge

## Operator Notes

- Never paste secrets into docs, commits, logs, or issue comments.
- When a secret is supplied in chat, use it only for the immediate operation and do not persist it.
- If a global Cloudflare key is used, prefer replacing it with a scoped API token after the incident.
