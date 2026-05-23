---
id: business-card-db-pwa-commercial-packaging
status: implemented
depends_on:
  - business-card-db-pwa-mobile-capture
  - business-card-db-security-privacy-rbac
---

# 08 PWA Commercial Packaging

## Scope Boundary

MYSCube InnerPlatform remains a desktop-first operations platform.

Only the business-card DB capture/review workflow is treated as a mobile-first installable PWA surface. The project dashboard, finance/cashflow screens, admin permission screens, and other InnerPlatform workspaces do not need to behave like mobile apps for this release.

## Non-Goals For This Release

- Do not optimize the full admin dashboard for mobile.
- Do not build an iOS native wrapper.
- Do not publish Android TWA until Play Store distribution is explicitly required.
- Do not make offline image queues part of v1.
- Do not expose original business-card images through Firebase public download URLs.

## Release Policy

The business-card DB ships web-first as an installable MYSCube PWA on the existing HTTPS production domain.

Commercial order:

1. PWA install endpoints on the live web app.
2. Real iPhone/Android browser install QA.
3. Android Trusted Web Activity only when Play Store distribution is needed.
4. iOS native wrapper only if native-only capabilities become necessary.

## Install Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/install` | Device-aware PWA install landing page |
| `/install/ios` | iPhone Safari Add to Home Screen instructions |
| `/install/android` | Android Chrome install instructions and TWA readiness notes |
| `/business-cards` | Admin/LAB business-card capture and review entry |
| `/portal/business-cards` | PM-facing business-card capture and review entry |
| `/manifest.webmanifest` | Browser PWA package contract |

## PWA Package Contract

- `public/manifest.webmanifest` provides app identity, start URL, scope, standalone display, Korean language metadata, square icons, maskable icon, and shortcuts.
- `public/pwa/myscube-icon-192.png` and `public/pwa/myscube-icon-512.png` are generated from the approved MYSCube logo.
- `public/pwa/myscube-icon-maskable-512.png` keeps safe-zone padding for Android launcher masks.
- `public/sw.js` caches only shell assets and brand assets.

## Sensitive Data Cache Policy

- Do not cache `/api/**`.
- Do not cache `/business-card-imports/**`.
- Do not cache original business-card images.
- Cache only `/assets/**` and `/brand/**`.

## Runtime Header Policy

The live Vercel response must allow same-origin camera access for the business-card capture screen:

```text
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

This does not grant microphone or location access. It only prevents the production header from blocking browser camera capture after the user grants permission.

## Verification

Local package check:

```bash
npm run pwa:qa
```

This runs:

```bash
npm run build
npm run pwa:verify
```

`pwa:verify` checks:

- required manifest fields
- 192px, 512px, and maskable 512px PNG icons
- Korean HTML metadata
- Apple touch icon
- service worker private cache bypasses
- `/install`, `/install/ios`, `/install/android`, and `/business-cards` route registration
- same-origin camera permissions policy in `vercel.json`

Live package check after deployment/alias:

```bash
npm run pwa:verify:live -- https://inner-platform.vercel.app
```

`deploy:prod:safe` runs this live check automatically after confirming the canonical Vercel alias. Set `VERCEL_SKIP_PWA_LIVE_VERIFY=true` only for emergency rollback or non-PWA infrastructure deploys.

`pwa:verify:live` checks:

- `/install`, `/install/ios`, `/install/android`, and `/business-cards` return the app shell over HTTPS
- live manifest fields and icon references
- live PNG icon dimensions
- service worker private cache bypasses
- live `Permissions-Policy` allows same-origin camera capture

## Mobile QA Matrix

| Platform | Browser | Required Result |
| --- | --- | --- |
| iPhone | Safari | Add to Home Screen creates MYSCube icon and launches standalone |
| Android | Chrome | Install creates launcher icon and launches standalone |
| Desktop | Chrome/Edge | Install opens standalone app window |

## Android TWA Readiness

The Android Play Store route is intentionally separate from the web PWA release.

Before serving `/.well-known/assetlinks.json` publicly:

- lock the production domain
- create the Android package ID, currently planned as `kr.mysc.myscube`
- enable Play App Signing
- obtain the Play signing SHA-256 fingerprint
- replace the fingerprint in `android-twa/assetlinks.template.json`
- verify Digital Asset Links on a physical Android device

Do not publish a placeholder `assetlinks.json`.

## Go/No-Go Checklist

- `npm run pwa:qa` passes.
- `npm run pwa:verify:live -- https://inner-platform.vercel.app` passes after alias confirmation.
- `npm test` passes.
- `npm run policy:verify` passes.
- Firebase rules dry run passes.
- Real iPhone capture/upload/review/confirm flow passes.
- Real Android capture/upload/review/confirm flow passes.
- Gemini quota and fallback errors are visible in logs.
