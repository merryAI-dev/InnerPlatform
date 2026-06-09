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

  it('keeps stage deployment database and service-token authority out of frontend config', () => {
    const pom = readRepoFile('server/jvm-weekly-api/pom.xml');
    const cloudBuild = readRepoFile('cloudbuild.jvm-weekly-api.yaml');
    const deployScript = readRepoFile('scripts/deploy_jvm_weekly_api_cloud_run.sh');
    const packageJson = readRepoFile('package.json');
    const smokeScript = readRepoFile('scripts/smoke_jvm_weekly_api.mjs');

    expect(pom).toContain('<artifactId>flyway-database-postgresql</artifactId>');
    expect(cloudBuild).toContain('mvn -f server/jvm-weekly-api/pom.xml test');
    expect(cloudBuild).toContain('--ingress');
    expect(cloudBuild).toContain('--ingress all');
    expect(cloudBuild).toContain('_JVM_WEEKLY_DATABASE_URL is required');
    expect(cloudBuild).toContain('must not point at localhost');
    expect(cloudBuild).toContain('_JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID, _JVM_WEEKLY_FIREBASE_PROJECT_ID, or PROJECT_ID is required for browser-direct auth');
    expect(cloudBuild).toContain('_JVM_WEEKLY_FIRESTORE_PROJECT_ID, _JVM_WEEKLY_FIREBASE_PROJECT_ID, or PROJECT_ID is required for Firestore storage');
    expect(cloudBuild).toContain('_JVM_WEEKLY_ALLOWED_ORIGINS is required for browser-direct CORS');
    expect(cloudBuild).toContain("_JVM_WEEKLY_DATABASE_URL: ''");
    expect(cloudBuild).not.toContain('jdbc:postgresql://127.0.0.1:5432/innerplatform_weekly');
    expect(cloudBuild).toContain('--vpc-connector');
    expect(cloudBuild).toContain('--add-cloudsql-instances');
    expect(cloudBuild).toContain('--allow-unauthenticated');
    expect(cloudBuild).not.toContain('--no-allow-unauthenticated');
    expect(cloudBuild).not.toContain('roles/run.invoker');
    expect(cloudBuild).toContain('node scripts/smoke_jvm_weekly_api.mjs');
    expect(cloudBuild).not.toContain('gcloud auth print-identity-token');
    expect(cloudBuild).toContain('deployed service URL is required for smoke');
    expect(cloudBuild).toContain('availableSecrets');
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN');
    expect(cloudBuild).toContain('JVM_WEEKLY_DATABASE_URL=${_JVM_WEEKLY_DATABASE_URL}');
    expect(cloudBuild).toContain('JVM_WEEKLY_STORAGE_BACKEND=${_JVM_WEEKLY_STORAGE_BACKEND}');
    expect(cloudBuild).toContain('JVM_WEEKLY_PROJECT_ACCESS_BACKEND=${_JVM_WEEKLY_PROJECT_ACCESS_BACKEND}');
    expect(cloudBuild).toContain("_JVM_WEEKLY_STORAGE_BACKEND: firestore");
    expect(cloudBuild).toContain("_JVM_WEEKLY_PROJECT_ACCESS_BACKEND: firestore");
    expect(cloudBuild).toContain('JVM_WEEKLY_FIREBASE_PROJECT_ID=$${FIRESTORE_PROJECT_ID}');
    expect(cloudBuild).toContain('JVM_WEEKLY_FIRESTORE_PROJECT_ID=$${FIRESTORE_PROJECT_ID}');
    expect(cloudBuild).toContain('JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID=$${AUTH_PROJECT_ID}');
    expect(cloudBuild).toContain('JVM_WEEKLY_ALLOWED_ORIGINS=${_JVM_WEEKLY_ALLOWED_ORIGINS}');
    expect(cloudBuild).toContain("_JVM_WEEKLY_ALLOWED_ORIGINS: 'https://inner-platform-stage-merryai-devs-projects.vercel.app,https://inner-platform.vercel.app'");
    expect(cloudBuild).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN=${_JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET}:latest');
    expect(deployScript).toContain('JVM_WEEKLY_DATABASE_URL is required for stage deploy');
    expect(deployScript).toContain('JVM_WEEKLY_STORAGE_BACKEND="${JVM_WEEKLY_STORAGE_BACKEND:-firestore}"');
    expect(deployScript).toContain('JVM_WEEKLY_PROJECT_ACCESS_BACKEND="${JVM_WEEKLY_PROJECT_ACCESS_BACKEND:-firestore}"');
    expect(deployScript).toContain('JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID="${JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID:-$JVM_WEEKLY_FIREBASE_PROJECT_ID}"');
    expect(deployScript).toContain('JVM_WEEKLY_FIRESTORE_PROJECT_ID="${JVM_WEEKLY_FIRESTORE_PROJECT_ID:-$JVM_WEEKLY_FIREBASE_PROJECT_ID}"');
    expect(deployScript).toContain('must not point at localhost for Cloud Run');
    expect(deployScript).toContain('--ingress all');
    expect(deployScript).toContain('--allow-unauthenticated');
    expect(deployScript).not.toContain('--no-allow-unauthenticated');
    expect(deployScript).not.toContain('roles/run.invoker');
    expect(deployScript).toContain('JVM_WEEKLY_FIREBASE_PROJECT_ID="${JVM_WEEKLY_FIREBASE_PROJECT_ID:-$PROJECT_ID}"');
    expect(deployScript).toContain('JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID is required for browser-direct auth');
    expect(deployScript).toContain('JVM_WEEKLY_FIRESTORE_PROJECT_ID is required for Firestore storage');
    expect(deployScript).toContain('JVM_WEEKLY_ALLOWED_ORIGINS="${JVM_WEEKLY_ALLOWED_ORIGINS:-https://inner-platform-stage-merryai-devs-projects.vercel.app,https://inner-platform.vercel.app}"');
    expect(deployScript).toContain('--set-env-vars "^|^WEEKLY_API_PORT=8080');
    expect(deployScript).toContain('node scripts/smoke_jvm_weekly_api.mjs');
    expect(deployScript).toContain('gcloud secrets versions access latest');
    expect(deployScript).not.toContain('gcloud auth print-identity-token');
    expect(deployScript).toContain('JVM_WEEKLY_SMOKE_URL="$SERVICE_URL"');
    expect(deployScript).toContain('JVM_WEEKLY_DATABASE_PASSWORD_SECRET');
    expect(deployScript).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_SECRET');
    expect(packageJson).toContain('"weekly-api:smoke": "node scripts/smoke_jvm_weekly_api.mjs"');
    expect(smokeScript).toContain('/api/v1/health');
    expect(smokeScript).toContain('/commands/cell-patch');
    expect(smokeScript).toContain('/commands/copy');
    expect(smokeScript).toContain('/commands/paste');
    expect(smokeScript).toContain('/commands/cut');
    expect(smokeScript).toContain('/commands/row-insert');
    expect(smokeScript).toContain('/commands/row-delete');
    expect(smokeScript).toContain('/bank-statements/import-batch');
    expect(smokeScript).toContain('/bank-statements/apply-items');
    expect(smokeScript).toContain('/submit');
    expect(smokeScript).toContain('/close');
    expect(smokeScript).toContain('/api/v1/cashflow/');
    expect(smokeScript).toContain('/audit-export');
    expect(smokeScript).toContain('weeklyExpense.auditExport.create');
  });
});
