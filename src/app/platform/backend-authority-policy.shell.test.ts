import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('backend authority policy', () => {
  it('keeps implementation and database product names out of ERP frontend surfaces', () => {
    const policy = JSON.parse(readText('policies/frontend-exposure-policy.json')) as {
      bannedFrontendTerms: string[];
    };

    expect(policy.bannedFrontendTerms).toEqual(expect.arrayContaining([
      'BFF',
      'Java ORM',
      'SQL Connect',
      'Data Connect',
      'Cloud SQL',
      'PostgreSQL',
      'Postgres',
      'Firestore direct',
    ]));
  });

  it('defines Java ORM as the only command authority and BFF as removable transport', () => {
    const source = readText('docs/architecture/weekly-expense-backend-authority-gate-2026-06-08.md');

    expect(source).toContain('React UI -> Java ORM command/read model');
    expect(source).toContain('BFF: optional legacy transport adapter only');
    expect(source).toContain('must keep working when the BFF route is removed');
    expect(source).toContain('GET  /api/v1/weekly-expenses/{projectId}/statuses');
    expect(source).toContain('scripts/sync_firebase_member_claims.mjs');
    expect(source).toContain('Rejected layers:');
    expect(source).toContain('BFF validation, calculation, idempotency, audit, projection, actual, or persistence authority');
    expect(source).toContain('BFF-only authentication or private-network dependency');
    expect(source).toContain('Java ORM backend: validate cells and rows, persist commands, calculate actual');
    expect(source).toContain('weeklyExpense.cells.copy');
  });

  it('requires Java Firebase Bearer auth for BFF-free weekly expense operation', () => {
    const filterSource = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/InternalServiceTokenFilter.java');
    const verifierSource = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/FirebaseBearerTokenVerifier.java');
    const cloudBuild = readText('cloudbuild.jvm-weekly-api.yaml');
    const apiClient = readText('src/app/platform/api-client.ts');
    const requestContext = readText('src/app/platform/request-context.ts');
    const platformBffClient = readText('src/app/lib/platform-bff-client.ts');

    expect(filterSource).toContain('firebaseBearerTokenVerifier.verify(parseBearer');
    expect(filterSource).toContain('withTrustedActorHeaders');
    expect(filterSource).toContain('tenant_mismatch');
    expect(filterSource).toContain('actor_mismatch');
    expect(verifierSource).toContain('verifyIdToken(token, true)');
    expect(verifierSource).not.toContain('verifySessionCookie(cookie, true)');
    expect(apiClient).toContain("credentials: 'omit'");
    expect(apiClient).toContain('includeFirebaseBearer');
    expect(apiClient).toContain('firebaseIdTokenProvider');
    expect(requestContext).toContain('input.includeFirebaseBearer');
    expect(platformBffClient).toContain('includeFirebaseBearer: true');
    expect(platformBffClient).toContain('firebaseIdTokenProvider');
    expect(platformBffClient).not.toContain('auth(?:');
    expect(requestContext).toContain("headers.set('authorization', `Bearer ${idToken}`)");
    expect(verifierSource).toContain('tenantId');
    expect(verifierSource).toContain('role');
    expect(filterSource).toContain('internalApiTokenEnabled && tokensMatch');
    expect(filterSource).not.toContain('weekly_expense_csrf_origin_required');
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=false');
    expect(cloudBuild).toContain('--ingress all');
    expect(cloudBuild).toContain('--allow-unauthenticated');
    expect(cloudBuild).not.toContain('--no-allow-unauthenticated');
    expect(cloudBuild).not.toContain('roles/run.invoker');
  });

  it('removes Java member profile sync from Firebase login and portal entry', () => {
    const authStore = readText('src/app/data/auth-store.tsx');
    const portalStore = readText('src/app/data/portal-store.tsx');
    const clientSource = readText('src/app/lib/platform-bff-client.ts');
    const controller = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseController.java');
    const applicationYml = readText('server/jvm-weekly-api/src/main/resources/application.yml');

    expect(authStore).not.toContain('syncMemberProfileViaBff');
    expect(authStore).not.toContain("console.error('[Auth] Failed to sync member profile:', err);");
    expect(authStore).not.toContain('/api/v1/identity/member-profile');
    expect(authStore).toContain("console.error('[Auth] Failed to establish Firebase auth context:', err);");
    expect(authStore).not.toContain("getOrgDocumentPath(currentUser.tenantId || DEFAULT_ORG_ID, 'members'");
    expect(authStore).not.toContain('getDoc(memberRef)');
    expect(authStore).not.toContain('setDoc(');
    expect(portalStore).not.toContain('buildWorkspacePreferencePatch');
    expect(portalStore).toContain("if (allowFrontendProjectAssignment) {\n      await setDoc(doc(db, getOrgDocumentPath(orgId, 'members', authUser.uid))");
    expect(portalStore).toContain("if (isPlatformApiEnabled()) {\n          const nextPortalUser");
    expect(portalStore).not.toContain("...(isPlatformApiEnabled()\n            ? buildWorkspacePreferencePatch");
    expect(clientSource).not.toContain('/api/v1/identity/member-profile');
    expect(clientSource).not.toContain('identity\\/member-profile');
    expect(clientSource).not.toContain('MemberProfileSyncResult');
    expect(clientSource).not.toContain('syncMemberProfileViaBff');
    expect(clientSource).toContain('^\\/api\\/v1\\/(?:weekly-expenses(?:\\/|$)|cashflow(?:\\/|$))');
    expect(controller).not.toContain('/identity/member-profile');
    expect(applicationYml).not.toContain('member-profile-backend');
    expect(applicationYml).not.toContain('JVM_WEEKLY_MEMBER_PROFILE_BACKEND');
  });

  it('requires trusted Firebase role claims for privileged Java API roles', () => {
    const filterSource = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/InternalServiceTokenFilter.java');
    const controllerTest = readText('server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseControllerTest.java');

    expect(filterSource).toContain('actor_role_claim_required');
    expect(filterSource).toContain('isPrivilegedRole(actorRole)');
    expect(controllerTest).toContain('browserDirectFirebaseTokenRejectsPrivilegedRequestRoleWhenRoleClaimIsMissing');
  });

  it('keeps weekly status and Firebase claims operation BFF-free', () => {
    const controller = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/WeeklyExpenseController.java');
    const clientSource = readText('src/app/lib/platform-bff-client.ts');
    const portalStore = readText('src/app/data/portal-store.tsx');
    const portalWeeklyPage = readText('src/app/components/portal/PortalWeeklyExpensePage.tsx');
    const claimsScript = readText('scripts/sync_firebase_member_claims.mjs');

    expect(controller).toContain('/weekly-expenses/{projectId}/statuses');
    expect(controller).toContain('WEEKLY_STATUS_READ_COMMAND');
    expect(clientSource).toContain('fetchWeeklyExpenseStatusesViaBff');
    expect(portalStore).toContain('fetchWeeklyExpenseStatusesViaBff');
    expect(portalStore).not.toContain('if (isPlatformApiEnabled()) {\n      setWeeklySubmissionStatuses([]);');
    expect(portalWeeklyPage).not.toContain('upsertTransactionViaBff');
    expect(portalWeeklyPage).not.toContain('provisionTransactionEvidenceDriveViaBff');
    expect(portalWeeklyPage).not.toContain('syncTransactionEvidenceDriveViaBff');
    expect(portalWeeklyPage).not.toContain('uploadTransactionEvidenceDriveViaBff');
    expect(portalWeeklyPage).not.toContain('fetchBudgetSuggestionViaBff');
    expect(portalWeeklyPage).not.toContain('onEnsureTransactionPersisted=');
    expect(portalWeeklyPage).not.toContain('onFetchBudgetSuggestion=');
    expect(portalWeeklyPage).not.toContain('useCashflowWeeks');
    expect(portalWeeklyPage).not.toContain('submitWeekAsPm');
    expect(portalWeeklyPage).not.toContain('updateVarianceFlag');
    expect(portalWeeklyPage).not.toContain('VarianceFlagBanner');
    expect(portalWeeklyPage).not.toContain('onSubmitWeek=');
    expect(portalWeeklyPage).not.toContain('onChangeTransactionState=');
    expect(portalWeeklyPage).not.toContain('changeTransactionState(');
    expect(portalWeeklyPage).not.toContain('GoogleSheetMigrationWizard');
    expect(claimsScript).toContain('setCustomUserClaims');
    expect(claimsScript).not.toContain('../server/bff/');
  });

  it('blocks stage/live frontend builds from falling back to Vercel BFF rewrites', () => {
    const productionWorkflow = readText('.github/workflows/production-deploy.yml');
    const ciWorkflow = readText('.github/workflows/ci.yml');
    const verifier = readText('scripts/verify_weekly_direct_vercel_env.mjs');

    expect(productionWorkflow).toContain('env pull .env.production.local --environment=production');
    expect(productionWorkflow).toContain('node scripts/verify_weekly_direct_vercel_env.mjs .env.production.local');
    expect(ciWorkflow).toContain('VITE_PLATFORM_API_BASE_URL: https://ci-innerplatform-jvm-weekly-api.example.run.app');
    expect(verifier).toContain('VITE_PLATFORM_API_ENABLED must be true');
    expect(verifier).toContain('must bypass Vercel/BFF rewrites');
    expect(verifier).toContain("host.endsWith('.vercel.app')");
  });

  it('requires stage/live weekly smoke to use Firebase browser-direct identity tokens', () => {
    const cloudBuild = readText('cloudbuild.jvm-weekly-api.yaml');
    const deployScript = readText('scripts/deploy_jvm_weekly_api_cloud_run.sh');
    const smokeScript = readText('scripts/smoke_jvm_weekly_api.mjs');
    const tokenScript = readText('scripts/create_firebase_smoke_id_token.mjs');

    expect(cloudBuild).toContain('eval "$(node scripts/create_firebase_smoke_id_token.mjs --env)"');
    expect(cloudBuild).toContain('--require-identity-token');
    expect(cloudBuild).not.toContain('secretEnv:\n      - JVM_WEEKLY_INTERNAL_API_TOKEN');
    expect(deployScript).toContain('SMOKE_AUTH_ENV="$(');
    expect(deployScript).toContain('eval "$SMOKE_AUTH_ENV"');
    expect(deployScript).toContain('--require-identity-token');
    expect(smokeScript).toContain('--require-identity-token forbids service token fallback');
    expect(smokeScript).not.toContain('/api/v1/auth/session');
    expect(smokeScript).not.toContain('cookie: sessionCookie');
    expect(smokeScript).toContain('authorization: `Bearer ${identityToken}`');
    expect(tokenScript).toContain('accounts:signInWithPassword');
    expect(tokenScript).toContain('export JVM_WEEKLY_SMOKE_ACTOR_ID');
  });

  it('allows SQL Connect/Data Connect only as a read and realtime channel', () => {
    const source = readText('docs/architecture/weekly-expense-backend-authority-gate-2026-06-08.md');

    expect(source).toContain('Firebase SQL Connect / Data Connect Policy');
    expect(source).toContain('must not become a second write authority');
    expect(source).toContain('realtime read updates from PostgreSQL after Java ORM commands commit');
    expect(source).toContain('must not mutate');
  });

  it('keeps weekly expense frontend save and edit paths free of local derivation hooks', () => {
    const portalSettlementStore = readText('src/app/data/portal-store.settlement.ts');
    const settlementLedgerPage = readText('src/app/components/cashflow/SettlementLedgerPage.tsx');
    const importEditor = readText('src/app/components/cashflow/ImportEditor.tsx');

    expect(portalSettlementStore).not.toContain('deriveSettlementRowsLocally');
    expect(settlementLedgerPage).not.toContain('onDeriveRows');
    expect(importEditor).not.toContain('onDeriveRows');
    expect(importEditor).not.toContain('buildSettlementDerivationContext');
  });

  it('keeps server clipboard copy as a named audited Java ORM action', () => {
    const actionPolicy = JSON.parse(readText('policies/actions-policy.json')) as {
      actions: Record<string, { owner: string; audit: boolean; status: string }>;
    };
    const readme = readText('server/jvm-weekly-api/README.md');

    expect(actionPolicy.actions['weeklyExpense.cells.copy']).toMatchObject({
      owner: 'java-orm-api',
      audit: true,
      status: 'implemented',
    });
    expect(readme).toContain('/commands/copy');
    expect(readme).toContain('server-built clipboard payload');
  });

  it('keeps typed BFF data channels for every Java ORM sheet command', () => {
    const clientSource = readText('src/app/lib/platform-bff-client.ts');

    expect(clientSource).toContain('patchWeeklyExpenseCellsViaBff');
    expect(clientSource).toContain('copyWeeklyExpenseCellsViaBff');
    expect(clientSource).toContain('pasteWeeklyExpenseCellsViaBff');
    expect(clientSource).toContain('cutWeeklyExpenseCellsViaBff');
    expect(clientSource).toContain('insertWeeklyExpenseRowsViaBff');
    expect(clientSource).toContain('deleteWeeklyExpenseRowsViaBff');
    expect(clientSource).toContain('/commands/cell-patch');
    expect(clientSource).toContain('/commands/copy');
    expect(clientSource).toContain('/commands/paste');
    expect(clientSource).toContain('/commands/cut');
    expect(clientSource).toContain('/commands/row-insert');
    expect(clientSource).toContain('/commands/row-delete');
  });

  it('keeps stage/live audit export on the Java weekly route without the legacy cashflow export wrapper', () => {
    const bffApp = readText('server/bff/app.mjs');
    const clientSource = readText('src/app/lib/platform-bff-client.ts');
    const projectSheetSource = readText('src/app/components/cashflow/CashflowProjectSheet.tsx');

    expect(bffApp).not.toContain('mountCashflowExportRoutes');
    expect(bffApp).not.toContain("routes/cashflow-exports");
    expect(clientSource).not.toContain('/api/v1/cashflow-exports');
    expect(clientSource).toContain('/api/v1/weekly-expenses/${encodeURIComponent(params.body.projectId)}/audit-export');
    expect(projectSheetSource).toContain('import.meta.env.PROD');
    expect(projectSheetSource).toContain('감사용 다운로드 경로를 확인할 수 없습니다.');
  });

  it('keeps inherited Firestore weekly storage collision-safe for bank import batches', () => {
    const persistence = readText('server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/storage/FirestoreInheritedWeeklyExpensePersistence.java');

    expect(persistence).toContain('UUID.randomUUID()');
    expect(persistence).not.toContain('"bank-import-" + Instant.now().toEpochMilli()');
  });
});
