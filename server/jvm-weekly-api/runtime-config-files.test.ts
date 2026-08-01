import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('JVM weekly API runtime config files', () => {
  it('keeps local smoke execution isolated from the PostgreSQL production default', () => {
    const pom = readRepoFile('server/jvm-weekly-api/pom.xml');
    const localConfig = readRepoFile('server/jvm-weekly-api/src/main/resources/application-local.yml');

    expect(pom).toContain('<id>local-smoke</id>');
    expect(localConfig).toContain('jdbc:h2:mem:jvm_weekly_api_local');
    expect(localConfig).toContain('local-weekly-api-token');
  });

  it('builds the Java service as its own deployable container', () => {
    const dockerfile = readRepoFile('server/jvm-weekly-api/Dockerfile');

    expect(dockerfile).toContain('maven:3.9-eclipse-temurin-21');
    expect(dockerfile).toContain('eclipse-temurin:21-jre');
    expect(dockerfile).not.toContain('eclipse-temurin:21-jre-alpine');
    expect(dockerfile).toContain('ENV WEEKLY_API_PORT=8080');
    expect(dockerfile).toContain('useradd --system');
    expect(dockerfile).toContain('USER app');
    expect(dockerfile).toContain('ENTRYPOINT ["java", "-jar", "/app/jvm-weekly-api.jar"]');
  });

  it('pins the JVM runtime to the isolated Stage project, service and data authority', () => {
    const pom = readRepoFile('server/jvm-weekly-api/pom.xml');
    const applicationConfig = readRepoFile('server/jvm-weekly-api/src/main/resources/application.yml');
    const cloudBuild = readRepoFile('cloudbuild.jvm-weekly-api.yaml');
    const deployScript = readRepoFile('scripts/deploy_jvm_weekly_api_cloud_run.sh');
    const packageJson = readRepoFile('package.json');
    const smokeScript = readRepoFile('scripts/smoke_jvm_weekly_api.mjs');
    const smokeTokenScript = readRepoFile('scripts/create_firebase_smoke_id_token.mjs');

    expect(pom).toContain('<artifactId>flyway-database-postgresql</artifactId>');
    expect(cloudBuild).toContain('mvn -f server/jvm-weekly-api/pom.xml test');
    expect(cloudBuild).toContain('inner-platform-qa-20260310');
    expect(cloudBuild).toContain('innerplatform-jvm-weekly-api-lease-stage');
    expect(cloudBuild).not.toContain('gcr.io/$PROJECT_ID/innerplatform-jvm-weekly-api:${_IMAGE_TAG}');
    expect(cloudBuild).toContain('Stage-only JVM build requires project inner-platform-qa-20260310');
    expect(cloudBuild.indexOf('Stage-only JVM build requires project inner-platform-qa-20260310'))
      .toBeLessThan(cloudBuild.indexOf('mvn -f server/jvm-weekly-api/pom.xml test'));
    expect(cloudBuild.indexOf('mvn -f server/jvm-weekly-api/pom.xml test'))
      .toBeLessThan(cloudBuild.indexOf('gcr.io/$PROJECT_ID/innerplatform-jvm-weekly-api-lease-stage:${_IMAGE_TAG}'));
    expect(cloudBuild.indexOf('gcr.io/$PROJECT_ID/innerplatform-jvm-weekly-api-lease-stage:${_IMAGE_TAG}'))
      .toBeLessThan(cloudBuild.indexOf('gcloud run deploy innerplatform-jvm-weekly-api-lease-stage'));
    expect(cloudBuild).toContain('--ingress all');
    expect(cloudBuild).not.toContain('--allow-unauthenticated');
    expect(cloudBuild).not.toContain('_JVM_WEEKLY_DATABASE_URL');
    expect(cloudBuild).not.toContain('_CLOUD_SQL_INSTANCE');
    expect(cloudBuild).not.toContain('_SERVERLESS_VPC_CONNECTOR');
    expect(cloudBuild).toContain('JVM_WEEKLY_DEPLOY_ENV=stage');
    expect(applicationConfig).toContain('legacy-week-close-enabled: false');
    expect(cloudBuild).toContain('JVM_WEEKLY_EDIT_LEASES_ENABLED=true');
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=true');
    expect(cloudBuild).toContain('JVM_WEEKLY_STORAGE_BACKEND=firestore');
    expect(cloudBuild).toContain('JVM_WEEKLY_PROJECT_ACCESS_BACKEND=firestore');
    expect(cloudBuild).toContain('JVM_WEEKLY_FIREBASE_PROJECT_ID=mysc-bmp-14173451');
    expect(cloudBuild).toContain('JVM_WEEKLY_FIRESTORE_PROJECT_ID=mysc-bmp-14173451');
    expect(cloudBuild).toContain('JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID=mysc-bmp-14173451');
    expect(cloudBuild).toContain('JVM_WEEKLY_ALLOWED_ORIGINS=https://inner-platform-internal-stage-merryai-devs-projects.vercel.app');
    expect(cloudBuild).not.toContain('https://inner-platform.vercel.app');
    expect(cloudBuild).not.toContain('https://inner-platform-stage-merryai-devs-projects.vercel.app');
    expect(cloudBuild).not.toContain('node scripts/smoke_jvm_weekly_api.mjs --mode=deploy');
    expect(cloudBuild).not.toContain('gcloud auth print-identity-token');
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN');
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN=${_JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET}:latest');
    expect(cloudBuild).toContain('JVM_WEEKLY_CASHFLOW_SETTLED_WEEK_CONFIRMATION_KEY=${_JVM_WEEKLY_CASHFLOW_SETTLED_WEEK_CONFIRMATION_KEY_SECRET}:latest');

    expect(deployScript).toContain('STAGE_GCP_PROJECT_ID="inner-platform-qa-20260310"');
    expect(deployScript).toContain('STAGE_SERVICE_NAME="innerplatform-jvm-weekly-api-lease-stage"');
    expect(deployScript).toContain('STAGE_FIREBASE_AUTH_PROJECT_ID="mysc-bmp-14173451"');
    expect(deployScript).toContain('STAGE_ALLOWED_ORIGIN="https://inner-platform-internal-stage-merryai-devs-projects.vercel.app"');
    expect(deployScript).toContain('Stage-only JVM deploy requires project $STAGE_GCP_PROJECT_ID');
    expect(deployScript).toContain('Stage-only JVM deploy requires service $STAGE_SERVICE_NAME');
    expect(deployScript).toContain('JVM_WEEKLY_DEPLOY_ENV=stage');
    expect(deployScript).toContain('JVM_WEEKLY_EDIT_LEASES_ENABLED=true');
    expect(deployScript).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=true');
    expect(deployScript).toContain('JVM_WEEKLY_STORAGE_BACKEND=firestore');
    expect(deployScript).not.toContain('JVM_WEEKLY_DATABASE_URL is required');
    expect(deployScript).not.toContain('CLOUD_SQL_INSTANCE');
    expect(deployScript).not.toContain('SERVERLESS_VPC_CONNECTOR');
    expect(deployScript).toContain('--ingress all');
    expect(deployScript).not.toContain('--allow-unauthenticated');
    expect(deployScript).not.toContain('node scripts/smoke_jvm_weekly_api.mjs --mode=deploy');
    expect(deployScript).not.toContain('gcloud secrets versions access latest');
    expect(deployScript).not.toContain('gcloud auth print-identity-token');
    expect(deployScript).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET');
    expect(deployScript).toContain('JVM_WEEKLY_CASHFLOW_SETTLED_WEEK_CONFIRMATION_KEY_SECRET');

    expect(packageJson).toContain('"weekly-api:smoke": "node scripts/smoke_jvm_weekly_api.mjs"');
    expect(smokeScript).toContain("const DEPLOY_MODE = 'deploy'");
    expect(smokeScript).toContain("const LEASE_MODE = 'lease'");
    expect(smokeScript).toContain('/api/v1/health');
    expect(smokeScript).toContain('/api/v1/edit-leases/cashflow/');
    expect(smokeScript).toContain('/api/v1/cashflow-edit-drafts/');
    expect(smokeScript).toContain("'x-edit-finalize': 'true'");
    expect(smokeScript).toContain('edit_lease_held');
    expect(smokeScript).toContain('innerplatform-jvm-weekly-api-lease-stage');
    expect(smokeScript).toContain('inner-platform-internal-stage-merryai-devs-projects.vercel.app');
    expect(smokeScript).not.toContain('inner-platform.vercel.app');
    expect(smokeTokenScript).toContain("const STAGE_AUTH_PROJECT_ID = 'mysc-bmp-14173451'");
  });

  it('deploys the Firestore index used by Java weekly recent audit reads', () => {
    const indexes = JSON.parse(readRepoFile('firebase/firestore.indexes.json')) as {
      indexes: Array<{
        collectionGroup?: string;
        fields?: Array<{ fieldPath?: string; order?: string }>;
      }>;
    };

    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'weekly_api_audit_events',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'projectId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    });
  });
});
