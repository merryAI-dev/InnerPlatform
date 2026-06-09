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
const authStore = read('src/app/data/auth-store.tsx');
const platformApiBaseUrl = read('src/app/platform/platform-api-base-url.ts');
const featureFlags = read('src/app/config/feature-flags.ts');
const envExample = read('.env.example');
const claimsScript = read('scripts/sync_firebase_member_claims.mjs');
const vercelEnvScript = read('scripts/verify_weekly_direct_vercel_env.mjs');
const productionDeployWorkflow = read('.github/workflows/production-deploy.yml');
const ciWorkflow = read('.github/workflows/ci.yml');
const controller = read('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseController.java');
const controllerTest = read('server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseControllerTest.java');
const portalStore = read('src/app/data/portal-store.tsx');
const portalWeeklyPage = read('src/app/components/portal/PortalWeeklyExpensePage.tsx');
const cashflowWeeksStore = read('src/app/data/cashflow-weeks-store.tsx');
const cashflowWeeklyPage = read('src/app/components/cashflow/CashflowWeeklyPage.tsx');
const cashflowMonitorPage = read('src/app/components/cashflow/CashflowMonitorPage.tsx');
const cashflowExportPage = read('src/app/components/cashflow/CashflowExportPage.tsx');

for (const source of [cloudBuild, deployScript]) {
  requireIncludes(source, '--ingress all', 'public Java Cloud Run ingress');
  requireIncludes(source, '--allow-unauthenticated', 'public Java Cloud Run entrypoint guarded by app auth');
  requireNotIncludes(source, '--no-allow-unauthenticated', 'private Cloud Run IAM dependency');
  requireNotIncludes(source, 'roles/run.invoker', 'BFF Cloud Run invoker dependency');
}

requireIncludes(cloudBuild, 'JVM_WEEKLY_FIREBASE_PROJECT_ID', 'Java Firebase project env');
requireIncludes(cloudBuild, 'JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID', 'Java Firebase auth project env');
requireIncludes(cloudBuild, '_JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID: mysc-bmp-14173451', 'stage Firebase Auth project pin');
requireIncludes(cloudBuild, 'stage must verify Firebase Auth tokens from mysc-bmp-14173451', 'stage Firebase Auth project mismatch guard');
requireIncludes(cloudBuild, 'JVM_WEEKLY_FIRESTORE_PROJECT_ID', 'Java Firestore storage project env');
requireIncludes(cloudBuild, 'JVM_WEEKLY_ALLOWED_ORIGINS', 'Java CORS env');
requireIncludes(cloudBuild, 'JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=false', 'stage Java service-token disabled by default');
requireIncludes(cloudBuild, 'eval "$(node scripts/create_firebase_smoke_id_token.mjs --env)"', 'stage smoke Firebase ID token and UID minting');
requireIncludes(cloudBuild, '--require-identity-token', 'stage smoke browser-direct auth requirement');
requireNotIncludes(cloudBuild, 'secretEnv:\n      - JVM_WEEKLY_INTERNAL_API_TOKEN', 'stage smoke service token secret env');
requireIncludes(deployScript, 'SMOKE_AUTH_ENV="$(', 'manual deploy Firebase ID token and UID minting');
requireIncludes(deployScript, 'STAGE_FIREBASE_AUTH_PROJECT_ID="mysc-bmp-14173451"', 'manual deploy stage Firebase Auth project pin');
requireIncludes(deployScript, 'stage must verify Firebase Auth tokens from $STAGE_FIREBASE_AUTH_PROJECT_ID', 'manual deploy stage Firebase Auth project mismatch guard');
requireIncludes(deployScript, 'eval "$SMOKE_AUTH_ENV"', 'manual deploy smoke auth env export');
requireIncludes(deployScript, '--require-identity-token', 'manual deploy browser-direct auth requirement');
requireIncludes(smokeScript, 'requireIdentityToken', 'smoke identity-token-only mode');
requireIncludes(smokeScript, '--require-identity-token forbids service token fallback', 'smoke service-token fallback rejection');
requireNotIncludes(smokeScript, '/api/v1/auth/session', 'removed smoke session-cookie creation');
requireNotIncludes(smokeScript, 'cookie: sessionCookie', 'removed smoke session-cookie command channel');
requireIncludes(smokeScript, 'authorization: `Bearer ${identityToken}`', 'smoke Firebase Bearer command channel');
requireIncludes(smokeTokenScript, 'accounts:signInWithPassword', 'Firebase smoke ID token REST sign-in');
requireIncludes(smokeTokenScript, 'export JVM_WEEKLY_SMOKE_ACTOR_ID', 'Firebase smoke UID actor binding');
requireIncludes(filter, 'firebaseBearerTokenVerifier.verify(parseBearer', 'Java Firebase Bearer authentication');
requireIncludes(filter, 'withTrustedActorHeaders', 'server-derived actor header injection');
requireIncludes(filter, 'tenant_mismatch', 'tenant spoof rejection');
requireIncludes(filter, 'actor_mismatch', 'actor spoof rejection');
requireIncludes(verifier, 'verifyIdToken(token, true)', 'revocation-aware Firebase token verification');
requireIncludes(verifier, 'tenantId', 'Firebase tenant claim contract');
requireIncludes(verifier, 'role', 'Firebase role claim contract');
requireIncludes(filter, 'internalApiTokenEnabled && tokensMatch', 'Java shared service-token path disabled unless explicitly enabled');
requireIncludes(filter, 'weekly_expense_service_token_not_allowed', 'service token rejected on weekly user routes');
requireIncludes(filter, 'isInternalServiceEndpoint', 'service token scoped to internal endpoints');
requireIncludes(filter, 'path.startsWith("/api/v1/internal/")', 'service token internal endpoint namespace');
requireIncludes(filter, 'actor_role_claim_required', 'privileged browser role fallback rejection');
requireIncludes(filter, 'isPrivilegedRole(actorRole)', 'privileged role claim gate');
requireIncludes(controllerTest, 'internalServiceTokenDoesNotAuthorizeWeeklyUserRoutes', 'service token user-route rejection regression');
requireIncludes(controllerTest, 'browserDirectFirebaseTokenRejectsPrivilegedRequestRoleWhenRoleClaimIsMissing', 'privileged role claim regression');
requireIncludes(cors, 'https://inner-platform.vercel.app', 'live frontend CORS origin');
requireIncludes(client, "headers.set('authorization', `Bearer ${idToken}`)", 'frontend per-request bearer token channel');
requireIncludes(client, 'input.includeFirebaseBearer', 'frontend Bearer channel must be explicitly scoped');
requireIncludes(read('src/app/platform/api-client.ts'), "credentials: 'omit'", 'frontend stateless Bearer channel');
requireIncludes(read('src/app/platform/api-client.ts'), 'includeFirebaseBearer', 'frontend Java API Bearer opt-in');
requireIncludes(read('src/app/platform/api-client.ts'), 'firebaseIdTokenProvider', 'frontend Java API fresh token provider');
requireNotIncludes(read('src/app/platform/api-session.ts'), '/api/v1/auth/session', 'frontend login-time Java session creation');
requireIncludes(platformApiBaseUrl, 'is required for stage/live platform API operation.', 'production API base URL fail-fast');
requireIncludes(platformClient, 'rejectBrowserRewriteHosts: enabled && isProductionBuild', 'frontend Java API runtime same-origin rejection');
requireIncludes(platformClient, 'includeFirebaseBearer: true', 'Java weekly client Bearer opt-in');
requireIncludes(platformClient, 'firebaseIdTokenProvider', 'Java weekly client fresh token provider');
requireNotIncludes(platformClient, 'auth(?:', 'removed Java auth route prefix');
requireIncludes(platformApiBaseUrl, "host.endsWith('.vercel.app')", 'Vercel Java API base URL rejection');
requireIncludes(platformApiBaseUrl, 'must bypass Vercel/BFF rewrites', 'same-origin Java API base URL rejection error');
requireIncludes(platformClient, 'fetchWeeklyExpenseStatusesViaBff', 'Java weekly status read channel');
requireIncludes(platformClient, '/api/v1/identity/member-profile', 'Java member profile sync route');
requireIncludes(platformClient, 'identity\\/member-profile', 'member profile sync Java route classifier');
requireIncludes(authStore, 'syncMemberProfileViaBff', 'login member profile server sync');
requireNotIncludes(authStore, "getOrgDocumentPath(currentUser.tenantId || DEFAULT_ORG_ID, 'members'", 'workspace preference frontend members write');
requireNotIncludes(authStore, 'getDoc(memberRef)', 'login frontend members read');
requireNotIncludes(authStore, 'setDoc(', 'auth-store frontend Firestore write');
requireNotIncludes(portalStore, 'buildWorkspacePreferencePatch', 'portal platform members workspace write');
requireIncludes(portalStore, "if (allowFrontendProjectAssignment) {\n      await setDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid))", 'portal member write confined to non-platform project assignment');
requireIncludes(portalStore, "if (isPlatformApiEnabled()) {\n          const nextPortalUser", 'portal platform member registration avoids Firestore member write');
requireIncludes(cashflowWeeksStore, 'ensureProjectCashflowSnapshots', 'cashflow aggregate Java snapshot hydration action');
requireIncludes(cashflowWeeksStore, 'fetchWeeklyExpenseCashflowViaBff', 'cashflow Java read snapshot channel');
requireIncludes(cashflowWeeksStore, 'fetchWeeklyExpenseStatusesViaBff', 'cashflow Java weekly status read channel');
requireIncludes(cashflowWeeksStore, 'mergeWeeklyStatusesIntoCashflowWeeks', 'cashflow weekly status merge');
requireIncludes(cashflowWeeksStore, 'byWeekId.set(weekId, {', 'cashflow status-only week creation');
requireIncludes(cashflowWeeksStore, 'pmSubmitted: Boolean(status.pmSubmitted)', 'cashflow PM submission status merge');
requireIncludes(cashflowWeeksStore, 'adminClosed: Boolean(status.adminClosed)', 'cashflow admin close status merge');
requireNotIncludes(cashflowWeeksStore, "if (isPlatformApiEnabled() && user.source !== 'dev_harness') {\n      setWeeks([]);", 'platform cashflow month navigation empty fallback');
requireNotIncludes(cashflowWeeksStore, "if (isPlatformApiEnabled() && user.source !== 'dev_harness') {\n      setReadModels({});", 'platform cashflow month navigation read model clear');
requireIncludes(cashflowWeeklyPage, 'void ensureProjectCashflowSnapshots(projectIds)', 'weekly aggregate Java hydration call');
requireIncludes(cashflowWeeklyPage, 'projects.map((project) => project.id)', 'weekly aggregate project hydration scope');
requireIncludes(cashflowMonitorPage, 'void ensureProjectCashflowSnapshots(projectIds)', 'cashflow monitor Java hydration call');
requireIncludes(cashflowMonitorPage, 'projects.map((project) => project.id)', 'cashflow monitor project hydration scope');
requireIncludes(cashflowExportPage, 'void ensureProjectCashflowSnapshots(targetProjectIds)', 'cashflow export Java hydration call');
requireIncludes(cashflowExportPage, 'targetProjects.map((project) => project.id)', 'cashflow export target hydration scope');
for (const source of [cashflowWeeklyPage, cashflowMonitorPage, cashflowExportPage]) {
  requireNotIncludes(source, 'computeCashflowTotals', 'cashflow aggregate/export local totals calculation');
  requireNotIncludes(source, 'chooseCashflowSheetForNet', 'cashflow aggregate/export local net calculation');
}
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
