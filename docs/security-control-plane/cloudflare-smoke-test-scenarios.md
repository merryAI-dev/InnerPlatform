# Cloudflare WAF Smoke Test Scenarios

Status: `candidate`

These smoke tests must pass before Cloudflare WAF/rate-limit enforcement can move beyond draft. Run them against the Cloudflare hostname, not the Vercel default hostname.

## Preconditions

- The hostname is a Cloudflare proxied DNS record.
- The hostname is registered as a Vercel custom domain for the correct project.
- Firebase Authorized domains include the Cloudflare hostname where Firebase Auth is used.
- BFF `BFF_ALLOWED_ORIGINS` contains only the approved Cloudflare hostname for live.
- WAF rules are in observe/log mode where possible, or limited to a non-production candidate hostname.
- Cloudflare Security Events and Logpush destination are visible to the security owner.
- For the USD 20/month POC, Cloudflare dashboard Security Events are acceptable before Log Explorer/Logpush is budgeted.

## Scenarios

| Area | Scenario | Expected result |
|---|---|---|
| Page load | Open `/` and key app routes from a clean browser profile. | No challenge loop, 2xx/3xx only for expected redirects. |
| Login | Start email/password or Google login from the Cloudflare hostname. | Login page is reachable; normal user is not challenged before auth completes. |
| Firebase redirect | Complete `/__/auth/handler` redirect flow. | `/__/auth/*` is not blocked or challenged; Firebase session is established. |
| Firebase helper assets | Load `/__/firebase/*` helper paths where used. | Helper assets return expected responses without WAF challenge HTML. |
| BFF API | Call authenticated BFF JSON endpoints. | API returns JSON; Cloudflare does not inject browser challenge pages into API clients. |
| Upload | Upload expected production file types and sizes. | Upload completes; WAF does not block multipart/form-data or signed upload flows. |
| Rate limit | Run intentional login abuse from a controlled test IP. | Rate limit/challenge triggers only after the documented threshold. |
| Injection probes | Send controlled SQLi/XSS/path traversal probes to non-mutating test endpoints. | WAF logs or blocks as configured; application remains stable. |
| PWA | Run live PWA verifier against the Cloudflare hostname. | Manifest, service worker, icons, HTTPS, and camera permission checks pass. |
| Direct origin | Attempt equivalent flow through `*.vercel.app`, `*.firebaseapp.com`, and `*.web.app`. | Not an approved operational path; BFF live CORS and Firebase Auth do not trust direct Vercel origins. |
| Observability | Confirm each test produces expected Cloudflare event visibility. | Security owner can see allow/block/challenge/rate-limit evidence in the agreed destination. |
| Rollback | Execute dry-run rollback procedure. | Owner, command, and DNS/Vercel reversal steps are confirmed before cutover. |

## Pass Criteria

- No user-facing auth loop.
- No API response is replaced with WAF challenge HTML.
- No Firebase Auth helper route is challenged.
- Expected abuse probes produce observable security events.
- False positives are reviewed and assigned before enforcement.
- Rollback owner and command are named in the cutover ticket.
