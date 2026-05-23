# MYSCube Android TWA Package

## Purpose

This directory reserves the Android Trusted Web Activity packaging track for MYSCube.

The web PWA remains the source of truth. The Android package should only wrap the live PWA after the production domain and Play signing fingerprint are locked.

## Planned Values

- App name: `MYSCube`
- Package name: `kr.mysc.myscube`
- Manifest URL: `https://<production-domain>/manifest.webmanifest`
- Start URL: `https://<production-domain>/`
- Install guide endpoint: `https://<production-domain>/install/android`

## Build Flow

Run after the production domain is confirmed:

```bash
npx @bubblewrap/cli init --manifest=https://<production-domain>/manifest.webmanifest
```

Then build the release bundle:

```bash
./gradlew bundleRelease
```

## Digital Asset Links

Do not publish `/.well-known/assetlinks.json` with a placeholder fingerprint.

After Play App Signing is enabled:

1. Get the Play signing SHA-256 fingerprint.
2. Copy `android-twa/assetlinks.template.json`.
3. Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`.
4. Deploy it to `public/.well-known/assetlinks.json`.
5. Verify on a physical Android device that TWA opens fullscreen without a URL bar.

## QA

Required before Play internal testing:

```bash
npm run pwa:qa
npm test
npm run policy:verify
```

Android device checks:

```text
Chrome install works from /install/android.
Launcher icon uses MYSCube logo.
Business-card capture opens camera/photo picker.
API responses and business-card images are not served from service worker cache.
Digital Asset Links verification passes after assetlinks.json is deployed.
```
