Canonical production repo: `/Users/boram/InnerPlatform`

Rules:
- Use this repo for `main` and production deploys.
- Production deploys must run through GitHub Actions `Production Deploy` on `main`.
- Use `npm run deploy:prod:verify -- <deployment-url-or-host>` only to verify an existing deployment.
- Do not run `npm run deploy:prod:safe`, `node deploy-prod-align.mjs`, or `vercel --prod` from a local worktree.
- Do not relink other local clones to the shared Vercel project.
- Official production URL: `https://inner-platform.vercel.app`
- GitHub Actions verifies that the production deployment is aligned to `inner-platform.vercel.app` before it returns success.
