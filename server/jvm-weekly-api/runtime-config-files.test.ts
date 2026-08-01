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
