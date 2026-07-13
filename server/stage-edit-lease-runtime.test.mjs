import { describe, expect, it } from 'vitest';
import { evaluateStageEditLeaseRuntime } from '../scripts/assert-stage-edit-lease-runtime.mjs';

const valid = {
  BFF_DEPLOY_ENV: 'stage',
  BFF_EDIT_LEASES_ENABLED: 'true',
  VERCEL_TARGET_ENV: 'preview',
  FIREBASE_PROJECT_ID: 'mysc-bmp-14173451',
  JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'mysc-bmp-14173451',
  JVM_WEEKLY_API_BASE_URL: 'https://innerplatform-jvm-weekly-api-lease-stage-abc.a.run.app',
  JVM_WEEKLY_INTERNAL_API_TOKEN: 'a'.repeat(32),
  JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: 'https://innerplatform-jvm-weekly-api-lease-stage-abc.a.run.app',
  JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'stage-invoker@example.iam.gserviceaccount.com' }),
};

describe('stage edit lease runtime guard', () => {
  it('accepts only the isolated Stage data and JVM runtime', () => {
    expect(evaluateStageEditLeaseRuntime(valid)).toEqual([]);
    expect(evaluateStageEditLeaseRuntime({
      ...valid,
      VERCEL_TARGET_ENV: 'production',
      FIREBASE_PROJECT_ID: 'inner-platform-live-20260316',
      JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'inner-platform-live-20260316',
      JVM_WEEKLY_API_BASE_URL: 'https://innerplatform-jvm-weekly-api.run.app',
      JVM_WEEKLY_INTERNAL_API_TOKEN: 'short',
      JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: '',
      JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: '',
    })).toEqual(expect.arrayContaining([
      'Vercel target must be preview',
      'data project must be mysc-bmp-14173451',
      'JVM Firestore project must be mysc-bmp-14173451',
      'Live data project is forbidden',
      'JVM stage service token must be at least 32 characters',
      'JVM URL must target innerplatform-jvm-weekly-api-lease-stage on Cloud Run',
      'JVM ID token audience must match the Stage JVM URL',
      'JVM Stage invoker credential must be configured',
    ]));
  });
});
