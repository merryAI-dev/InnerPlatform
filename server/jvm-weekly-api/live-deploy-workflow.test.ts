import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/jvm-production-deploy.yml'),
  'utf8',
);
const cloudBuild = readFileSync(
  resolve(process.cwd(), 'cloudbuild.jvm-weekly-api-live.yaml'),
  'utf8',
);

describe('JVM production deploy workflow', () => {
  it('smokes the legacy live read before promoting traffic', () => {
    expect(workflow.indexOf('--no-traffic')).toBeGreaterThan(-1);
    expect(workflow.indexOf('/month-close/dashboard-source')).toBeGreaterThan(workflow.indexOf('--no-traffic'));
    expect(workflow.indexOf('update-traffic')).toBeGreaterThan(workflow.indexOf('/month-close/dashboard-source'));
    expect(workflow).toContain('workload_identity_provider');
    expect(workflow).not.toContain('service_account_key');
    expect(workflow).toContain('--config cloudbuild.jvm-weekly-api-live.yaml');
    expect(cloudBuild).toContain('server/jvm-weekly-api/Dockerfile');
    expect(cloudBuild).not.toContain('gcloud run deploy');
  });
});
