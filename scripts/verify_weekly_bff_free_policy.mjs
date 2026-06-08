#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    console.error(`[weekly-bff-free-policy] missing ${label}: ${needle}`);
    process.exit(1);
  }
}

function requireNotIncludes(source, needle, label) {
  if (source.includes(needle)) {
    console.error(`[weekly-bff-free-policy] forbidden ${label}: ${needle}`);
    process.exit(1);
  }
}

const cloudBuild = read('cloudbuild.jvm-weekly-api.yaml');
const deployScript = read('scripts/deploy_jvm_weekly_api_cloud_run.sh');
const smokeScript = read('scripts/smoke_jvm_weekly_api.mjs');
const smokeTokenScript = read('scripts/create_firebase_smoke_id_token.mjs');
const filter = read('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/InternalServiceTokenFilter.java');
const verifier = read('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/FirebaseBearerTokenVerifier.java');
const cors = read('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/WeeklyApiCorsConfiguration.java');
const client = read('src/app/platform/request-context.ts');
const platformClient = read('src/app/lib/platform-bff-client.ts');
const featureFlags = read('src/app/config/feature-flags.ts');
const envExample = read('.env.example');
const claimsScript = read('scripts/sync_firebase_member_claims.mjs');
const vercelEnvScript = read('scripts/verify_weekly_direct_vercel_env.mjs');
const productionDeployWorkflow = read('.github/workflows/production-deploy.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const controller = read('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseController.java');
const portalStore = read('src/app/data/portal-store.tsx');
const portalWeeklyPage = read('src/app/components/portal/PortalWeeklyExpensePage.tsx');

for (const source of [cloudBuild, deployScript]) {
  requireIncludes(source, '--ingress all', 'public Java Cloud Run ingress');
  requireIncludes(source, '--allow-unauthenticated', 'public Java Cloud Run entrypoint guarded by app auth');
  requireNotIncludes(source, '--no-allow-unauthenticated', 'private Cloud Run IAM dependency');
  requireNotIncludes(source, 'roles/run.invoker', 'BFF Cloud Run invoker dependency');
}

requireIncludes(cloudBuild, 'JVM_WEEKLY_FIREBASE_PROJECT_ID', 'Java Firebase project env');
requireIncludes(cloudBuild, 'JVM_WEEKLY_ALLOWED_ORIGINS', 'Java CORS env');
requireIncludes(cloudBuild, 'eval "$(node scripts/create_firebase_smoke_id_token.mjs --env)"', 'stage smoke Firebase ID token and UID minting');
requireIncludes(cloudBuild, '--require-identity-token', 'stage smoke browser-direct auth requirement');
requireNotIncludes(cloudBuild, 'secretEnv:\n      - JVM_WEEKLY_INTERNAL_API_TOKEN', 'stage smoke service token secret env');
requireIncludes(deployScript, 'SMOKE_AUTH_ENV="$(', 'manual deploy Firebase ID token and UID minting');
requireIncludes(deployScript, 'eval "$SMOKE_AUTH_ENV"', 'manual deploy smoke auth env export');
requireIncludes(deployScript, '--require-identity-token', 'manual deploy browser-direct auth requirement');
requireIncludes(smokeScript, 'requireIdentityToken', 'smoke identity-token-only mode');
requireIncludes(smokeScript, '--require-identity-token forbids service token fallback', 'smoke service-token fallback rejection');
requireIncludes(smokeTokenScript, 'accounts:signInWithPassword', 'Firebase smoke ID token REST sign-in');
requireIncludes(smokeTokenScript, 'export JVM_WEEKLY_SMOKE_ACTOR_ID', 'Firebase smoke UID actor binding');
requireIncludes(filter, 'firebaseBearerTokenVerifier.verify', 'Java Firebase bearer authentication');
requireIncludes(filter, 'withTrustedActorHeaders', 'server-derived actor header injection');
requireIncludes(filter, 'tenant_mismatch', 'tenant spoof rejection');
requireIncludes(filter, 'actor_mismatch', 'actor spoof rejection');
requireIncludes(verifier, 'verifyIdToken(token, true)', 'revocation-aware Firebase token verification');
requireIncludes(verifier, 'tenantId', 'Firebase tenant claim contract');
requireIncludes(verifier, 'role', 'Firebase role claim contract');
requireIncludes(cors, 'https://inner-platform.vercel.app', 'live frontend CORS origin');
requireIncludes(client, "headers.set('authorization', `Bearer ${input.actor.idToken}`)", 'frontend bearer token channel');
requireIncludes(platformClient, 'VITE_PLATFORM_API_BASE_URL is required for stage/live platform API operation.', 'production API base URL fail-fast');
requireIncludes(platformClient, 'fetchWeeklyExpenseStatusesViaBff', 'Java weekly status read channel');
requireIncludes(featureFlags, 'parseFeatureFlag(env.VITE_PLATFORM_API_ENABLED, isProductionBuild)', 'production platform API default');
requireIncludes(envExample, 'VITE_PLATFORM_API_ENABLED=true', 'stage/live platform API enabled default');
requireNotIncludes(envExample, 'VITE_PLATFORM_API_ENABLED=false', 'stage/live platform API disabled default');
requireIncludes(controller, 'WEEKLY_STATUS_READ_COMMAND', 'Java weekly status authorization');
requireIncludes(controller, '/weekly-expenses/{projectId}/statuses', 'Java weekly status endpoint');
requireIncludes(portalStore, 'fetchWeeklyExpenseStatusesViaBff', 'portal weekly status Java read model');
requireNotIncludes(portalStore, 'if (isPlatformApiEnabled()) {\n      setWeeklySubmissionStatuses([]);', 'platform weekly status empty fallback');
for (const forbidden of [
  'upsertTransactionViaBff',
  'provisionTransactionEvidenceDriveViaBff',
  'syncTransactionEvidenceDriveViaBff',
  'uploadTransactionEvidenceDriveViaBff',
  'fetchBudgetSuggestionViaBff',
  'onEnsureTransactionPersisted=',
  'onFetchBudgetSuggestion=',
  'onProvisionEvidenceDrive=',
  'onUploadEvidenceDrive=',
]) {
  requireNotIncludes(portalWeeklyPage, forbidden, 'BFF-only weekly expense page operation');
}
requireIncludes(claimsScript, 'setCustomUserClaims', 'BFF-free Firebase custom claims update');
requireIncludes(claimsScript, 'FIREBASE_SERVICE_ACCOUNT_JSON', 'claims script service account support');
requireNotIncludes(claimsScript, '../server/bff/', 'claims script BFF import dependency');
requireIncludes(vercelEnvScript, 'VITE_PLATFORM_API_ENABLED must be true', 'stage/live platform API enabled env gate');
requireIncludes(vercelEnvScript, 'must bypass Vercel/BFF rewrites', 'same-origin BFF rewrite rejection');
requireIncludes(productionDeployWorkflow, 'vercel@50.14.0', 'pinned Vercel CLI');
requireIncludes(productionDeployWorkflow, 'env pull .env.production.local --environment=production', 'production Vercel env pull');
requireIncludes(productionDeployWorkflow, 'node scripts/verify_weekly_direct_vercel_env.mjs .env.production.local', 'production direct Java env verification');
requireIncludes(ciWorkflow, 'VITE_PLATFORM_API_BASE_URL: https://ci-innerplatform-jvm-weekly-api.example.run.app', 'CI direct API production build guard');

console.log('[weekly-bff-free-policy] ok');
