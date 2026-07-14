const STAGE_PROJECT_ID = 'mysc-bmp-14173451';
const LIVE_PROJECT_ID = 'inner-platform-live-20260316';
const STAGE_JVM_SERVICE = 'innerplatform-jvm-weekly-api-lease-stage';

function text(value) {
  return String(value || '').trim();
}

export function evaluateStageEditLeaseRuntime(env = process.env) {
  const failures = [];
  const dataProjectId = text(env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID);
  const jvmProjectId = text(env.JVM_WEEKLY_FIRESTORE_PROJECT_ID);
  const authMode = text(env.JVM_WEEKLY_AUTH_MODE).toLowerCase();
  const jvmUrl = text(env.JVM_WEEKLY_API_BASE_URL);
  const serviceToken = text(env.JVM_WEEKLY_INTERNAL_API_TOKEN);
  const idTokenAudience = text(env.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE);
  const invokerCredential = text(env.JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON);

  if (text(env.BFF_DEPLOY_ENV) !== 'stage') failures.push('BFF_DEPLOY_ENV must be stage');
  if (text(env.BFF_EDIT_LEASES_ENABLED) !== 'true') failures.push('BFF_EDIT_LEASES_ENABLED must be true');
  if (text(env.VERCEL_TARGET_ENV) !== 'preview') failures.push('Vercel target must be preview');
  if (dataProjectId !== STAGE_PROJECT_ID) failures.push(`data project must be ${STAGE_PROJECT_ID}`);
  if (jvmProjectId !== STAGE_PROJECT_ID) failures.push(`JVM Firestore project must be ${STAGE_PROJECT_ID}`);
  if (authMode !== 'strict') failures.push('JVM weekly auth mode must be strict');
  if (dataProjectId === LIVE_PROJECT_ID || jvmProjectId === LIVE_PROJECT_ID) failures.push('Live data project is forbidden');
  if (serviceToken.length < 32) failures.push('JVM stage service token must be at least 32 characters');
  if (idTokenAudience.replace(/\/$/, '') !== jvmUrl.replace(/\/$/, '')) {
    failures.push('JVM ID token audience must match the Stage JVM URL');
  }
  if (!invokerCredential) failures.push('JVM Stage invoker credential must be configured');
  try {
    const url = new URL(jvmUrl);
    if (
      url.protocol !== 'https:'
      || !url.hostname.endsWith('.run.app')
      || !url.hostname.startsWith(STAGE_JVM_SERVICE)
    ) failures.push(`JVM URL must target ${STAGE_JVM_SERVICE} on Cloud Run`);
  } catch {
    failures.push('JVM stage URL must be a valid HTTPS URL');
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = evaluateStageEditLeaseRuntime();
  if (failures.length) {
    for (const failure of failures) console.error(`[stage-edit-lease-guard] ${failure}`);
    process.exit(1);
  }
  console.log('[stage-edit-lease-guard] Stage-only edit lease runtime confirmed.');
}
