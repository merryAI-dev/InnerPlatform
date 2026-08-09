import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/jvm-production-deploy.yml'),
  'utf8',
);
describe('JVM production deploy workflow', () => {
  it('smokes the legacy live read before promoting traffic', () => {
    expect(workflow.indexOf('--no-traffic')).toBeGreaterThan(-1);
    expect(workflow.indexOf('/month-close/dashboard-source')).toBeGreaterThan(workflow.indexOf('--no-traffic'));
    expect(workflow.indexOf('update-traffic')).toBeGreaterThan(workflow.indexOf('/month-close/dashboard-source'));
    expect(workflow).toContain('workload_identity_provider');
    expect(workflow).toContain('token_format: id_token');
    expect(workflow).toContain('ID_TOKEN: ${{ steps.auth.outputs.id_token }}');
    expect(workflow).not.toContain('gcloud auth print-identity-token');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain("java-version: '21'");
    expect(workflow).not.toContain('service_account_key');
    expect(workflow).toContain('CASHFLOW_PROJECT_ID: p1773817948751');
    expect(workflow).toContain('CASHFLOW_YEAR_MONTH: 2026-07');
    expect(workflow).toContain('JVM_WEEKLY_EDIT_LEASES_ENABLED=true');
    expect(workflow).not.toContain('${{ inputs.project_id }}');
    expect(workflow).toContain('.monthClose.yearMonth == env.CASHFLOW_YEAR_MONTH');
    expect(workflow).toContain('gcloud auth configure-docker asia-northeast3-docker.pkg.dev');
    expect(workflow).toContain('-f server/jvm-weekly-api/Dockerfile');
    // preflight 가 확정한 SHA 로 태그한다. workflow_run 의 github.sha 는 트리거 시점
    // 기본 브랜치 head 라 배포 대상과 어긋날 수 있다.
    expect(workflow).toContain('docker push "${IMAGE}:${DEPLOY_SHA}"');
    expect(workflow).toContain('DEPLOY_SHA: ${{ needs.preflight.outputs.sha }}');
    expect(workflow).not.toContain('${GITHUB_SHA}');
    expect(workflow).not.toContain('gcloud builds submit');
    expect(workflow.indexOf('Verify canonical service after promotion')).toBeGreaterThan(workflow.indexOf('update-traffic'));
    expect(workflow).toContain("if: failure() && steps.promote.outcome == 'success'");
    expect(workflow).toContain('--to-revisions "${PREVIOUS_REVISION}=100"');
  });

  it('auto-deploys only a green main commit whose JVM sources actually changed', () => {
    // 자동 트리거: main 의 CI 가 초록일 때만, 그리고 push 로 돈 CI 만.
    expect(workflow).toMatch(/workflow_run:\n\s+workflows: \[CI\]/);
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    // 배포 대상은 CI 가 검증한 SHA 이고, 그것이 아직 main head 일 때만 나간다.
    expect(workflow).toContain('CI_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(workflow).toContain('head="$(git rev-parse origin/main)"');
    expect(workflow).toContain('skipping superseded');
    expect(workflow).toContain("if: needs.preflight.outputs.proceed == 'true'");
    // JVM 소스가 바뀐 커밋일 때만. 무변경 재배포는 Cloud Run 롤아웃 위험만 반복한다.
    expect(workflow).toContain('JVM_SOURCE_PATHS: server/jvm-weekly-api');
    expect(workflow).toContain('git diff --quiet "${last}" "${sha}" -- ${JVM_SOURCE_PATHS}');
    expect(workflow).toContain('No JVM source change between');
    // 강제 배포는 dispatch 입력으로만. shell 안에서 직접 보간하지 않는다.
    expect(workflow).toContain('FORCE: ${{ inputs.force }}');
    expect(workflow).not.toContain('${{ inputs.force }} ');
  });
});
