Canonical production repo: `/Users/boram/InnerPlatform`

Rules:
- Use this repo for `main` and production deploys.
- Run `npm run deploy:prod:safe` for production deploys.
- Do not relink other local clones to the shared Vercel project.
- Official production URL: `https://inner-platform.vercel.app`
- `npm run deploy:prod:safe` now verifies that the latest production deployment is aligned to `inner-platform.vercel.app` before it returns success.
