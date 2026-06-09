Canonical production repo: `/Users/boram/InnerPlatform`

Rules:
- Use this repo for `main` and production deploys.
- Production deploys must run through GitHub Actions `Production Deploy` on `main`.
- Use `npm run deploy:prod:verify -- <deployment-url-or-host>` only to verify an existing deployment.
- Do not run `npm run deploy:prod:safe`, `node deploy-prod-align.mjs`, or `vercel --prod` from a local worktree.
- Do not relink other local clones to the shared Vercel project.
- Official production URL: `https://inner-platform.vercel.app`
- GitHub Actions verifies that the production deployment is aligned to `inner-platform.vercel.app` before it returns success.

Stage policy:
- Official stage URL: `https://inner-platform-stage-merryai-devs-projects.vercel.app`
- Do not share random Vercel preview URLs for stage QA.
- After every preview deploy, move the fixed stage alias to the new deployment:
  `npx vercel alias set <deployment-host> inner-platform-stage-merryai-devs-projects.vercel.app --scope merryai-devs-projects`
- Firebase Auth Authorized Domains must include the fixed stage URL host.
- The Java weekly API Cloud Run CORS allowlist must include the fixed stage URL origin.

Stage/live Java API policy:
- `VITE_PLATFORM_API_ENABLED` must be exactly `true`.
- `VITE_PLATFORM_API_BASE_URL` must be an absolute `https://` Java API Cloud Run URL.
- `VITE_PLATFORM_API_BASE_URL` must not be `/`, localhost, `inner-platform.vercel.app`, or any `*.vercel.app` URL; those route through Vercel/BFF rewrites and break `/api/v1/auth/session`.
- `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID` must match the frontend Firebase project that issues browser ID tokens.
- `JVM_WEEKLY_FIRESTORE_PROJECT_ID` must name the Firestore storage project explicitly; do not let auth fixes silently move storage.
- Before stage/live rollout, pull the target Vercel env and run:
  `node scripts/verify_weekly_direct_vercel_env.mjs <env-file>`
- For live, also set `WEEKLY_DIRECT_API_HOST_ALLOWLIST` to the approved Java API host before running the env verification.
