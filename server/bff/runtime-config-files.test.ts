import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('BFF runtime config files', () => {
  it('does not bake local deploy environment into the production Docker image', () => {
    const dockerfile = readRepoFile('server/bff/Dockerfile');

    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).not.toMatch(/^ENV BFF_DEPLOY_ENV=local$/m);
    expect(dockerfile).toContain('ENV BFF_WORKERS_ENABLED=false');
    expect(dockerfile).toContain('ENV BFF_SCHEDULER_OWNER=disabled');
  });

  it('keeps Cloud Run deployment defaults stage-scoped with disabled workers and explicit origins', () => {
    const script = readRepoFile('scripts/deploy_bff_cloud_run.sh');

    expect(script).toContain('BFF_DEPLOY_ENV="${BFF_DEPLOY_ENV:-stage}"');
    expect(script).toContain('BFF_WORKERS_ENABLED="${BFF_WORKERS_ENABLED:-false}"');
    expect(script).toContain('BFF_SCHEDULER_OWNER="${BFF_SCHEDULER_OWNER:-disabled}"');
    expect(script).toContain('BFF_SERVERLESS_VPC_CONNECTOR');
    expect(script).toContain('--vpc-egress all-traffic');
    expect(script).toContain('JVM_WEEKLY_API_ID_TOKEN_AUDIENCE');
    expect(script).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET');
    expect(script).not.toContain('BFF_ALLOWED_ORIGINS="${BFF_ALLOWED_ORIGINS:-*}"');
  });

  it('keeps Cloud Build BFF deployment defaults stage-scoped with disabled workers', () => {
    const cloudBuild = readRepoFile('cloudbuild.bff.yaml');

    expect(cloudBuild).toContain('_DEPLOY_ENV: stage');
    expect(cloudBuild).toContain("_WORKERS_ENABLED: 'false'");
    expect(cloudBuild).toContain('_SCHEDULER_OWNER: disabled');
    expect(cloudBuild).toContain('_BFF_SERVERLESS_VPC_CONNECTOR');
    expect(cloudBuild).toContain('--vpc-egress all-traffic');
    expect(cloudBuild).toContain('_JVM_WEEKLY_API_ID_TOKEN_AUDIENCE');
    expect(cloudBuild).toContain('_JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET');
    expect(cloudBuild).not.toContain("_ALLOWED_ORIGINS: '*'");
  });
});
