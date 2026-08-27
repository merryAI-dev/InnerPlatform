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
    // 서비스 호출 토큰의 audience 는 배포 뒤 확정된 서비스 URL. 리전을 옮기면 URL 이 바뀌므로 변수로 못 박지 않는다.
    expect(workflow).toContain('ID_TOKEN: ${{ steps.service_auth.outputs.id_token }}');
    expect(workflow).toContain('id_token_audience: ${{ steps.target.outputs.service_url }}');
    expect(workflow).not.toContain('id_token_audience: ${{ vars.');
    expect(workflow).not.toContain('gcloud auth print-identity-token');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain("java-version: '21'");
    expect(workflow).not.toContain('service_account_key');
    expect(workflow).toContain('CASHFLOW_PROJECT_ID: ${{ vars.JVM_SETTLEMENT_CANARY_PROJECT_ID_LIVE }}');
    expect(workflow).toContain('CASHFLOW_YEAR_MONTH: ${{ vars.JVM_SETTLEMENT_CANARY_CYCLE_YEAR_MONTH_LIVE }}');
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
    expect(workflow).toContain('.capabilities | index("settlement-cycle-v1") != null');
    expect(workflow).toContain('yearMonth=${CASHFLOW_YEAR_MONTH}&settlementCycle=true');
    expect(workflow).toContain('.settlementCycle.cycleYearMonth == env.CASHFLOW_YEAR_MONTH');
    expect(workflow).toContain('(.settlementCycle.health | type == "string" and length > 0)');
    expect(workflow.lastIndexOf('- name: Verify canonical service after promotion'))
      .toBeGreaterThan(workflow.indexOf('- name: Promote verified candidate'));
    expect(workflow).toContain('id: canonical_canary');
    expect(workflow).toContain("if: always() && steps.target.outcome == 'success'");
    expect(workflow).toContain('PROMOTE_OUTCOME: ${{ steps.promote.outcome }}');
    expect(workflow).toContain('CANARY_OUTCOME: ${{ steps.canonical_canary.outcome }}');
    expect(workflow).toContain('candidate_percent=');
    expect(workflow).toContain('previous_percent=');
    expect(workflow).toContain('[ "${candidate_percent}" = "100" ]');
    expect(workflow).toContain('test "${previous_percent}" = "100"');
    expect(workflow).not.toContain("steps.promote.outcome == 'success' && steps.previous.outputs.revision != ''");
    expect(workflow).toContain('--to-revisions "${PREVIOUS_REVISION}=100"');
    // 데이터(Firestore nam5) 옆 리전. 운영 서비스/기존 100% revision 없이는 배포를 시작하지 않는다.
    expect(workflow).toContain('REGION: us-central1');
    expect(workflow).toContain('if [ -z "${PREVIOUS_REVISION}" ]; then');
    expect(workflow).not.toContain('traffic_flag=""');
  });

  it('blocks promotion until the JVM-first settlement inventory and future BFF adapter agree', () => {
    expect(workflow).toContain('JVM_SETTLEMENT_CANARY_ACTOR_UID_LIVE');
    expect(workflow).toContain('node scripts/audit-cashflow-settlement-cycle-rollout.mjs');
    expect(workflow).not.toContain('npm run cashflow:settlement-cycle:audit');
    expect(workflow).toContain('--verify-cutover');
    expect(workflow).toContain('--jvm-base-url "${CANDIDATE_URL}"');
    expect(workflow).toContain('--jvm-audience "${JVM_AUDIENCE}"');
    expect(workflow).toContain('JVM_WEEKLY_API_ID_TOKEN: ${{ steps.service_auth.outputs.id_token }}');
    expect(workflow.indexOf('Verify settlement-cycle inventory and BFF read compatibility'))
      .toBeGreaterThan(workflow.indexOf('Deploy candidate without live traffic'));
    expect(workflow.indexOf('Promote verified candidate'))
      .toBeGreaterThan(workflow.indexOf('Verify settlement-cycle inventory and BFF read compatibility'));
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
    // min-instances 1 은 같은 인스턴스를 계속 살려둔다. 행이 걸리면 liveness probe 가
    // 죽여서 교체해야 한다 - 이게 없으면 행 걸린 인스턴스가 장애를 영구 보존한다.
    expect(workflow).toContain('--no-cpu-throttling');
    expect(workflow).toContain("--liveness-probe 'httpGet.path=/api/v1/health");
    expect(workflow).toContain('No JVM source change between');
    // 강제 배포는 dispatch 입력으로만. shell 안에서 직접 보간하지 않는다.
    expect(workflow).toContain('FORCE: ${{ inputs.force }}');
    expect(workflow).not.toContain('${{ inputs.force }} ');
  });

  it('shares the same split-release guard before building or resuming a candidate', () => {
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('Verify cashflow settlement split-release boundary');
    expect(workflow).toContain('verify-cashflow-settlement-release-boundary.mjs');
    expect(workflow).toContain('--jvm-base "${JVM_DEPLOY_BASE_SHA}"');
    expect(workflow).toContain('--bff-base "${BFF_DEPLOY_BASE_SHA}"');
    expect(workflow).toContain('gcloud run services describe "${SERVICE}"');
    expect(workflow).toContain('node deploy-prod-align.mjs --print-current-target');
    expect(workflow).toContain('inspect "${bff_deployment_host}" --json');
    expect(workflow).toContain('.meta.githubCommitSha');
    expect(workflow).toContain('JVM_SPLIT_RELEASE_BASE_SHA_LIVE');
    expect(workflow).toContain('status.imageDigest');
    expect(workflow).not.toContain('git hash-object -t tree /dev/null');
    expect(workflow).toContain('per_page=100');
    expect(workflow.indexOf('Verify cashflow settlement split-release boundary'))
      .toBeLessThan(workflow.indexOf('Build tested image'));
  });

  it('can resume the exact zero-traffic candidate for an explicitly approved migration', () => {
    expect(workflow).toContain('resume_candidate_revision:');
    expect(workflow).toContain('apply_settlement_migrations:');
    expect(workflow).toContain('settlement_migration_projects:');
    expect(workflow).toContain('settlement_migration_reason:');
    expect(workflow).toContain('RESUME_CANDIDATE_REVISION: ${{ inputs.resume_candidate_revision }}');
    expect(workflow).toContain('APPLY_SETTLEMENT_MIGRATIONS: ${{ inputs.apply_settlement_migrations }}');
    expect(workflow).toContain("if: needs.preflight.outputs.resume_revision == ''");
    expect(workflow).toContain("if: needs.preflight.outputs.resume_revision != ''");
    expect(workflow).toContain('Resolve existing zero-traffic candidate');
    expect(workflow).toContain('expected_revision="${SERVICE}-hotfix-${DEPLOY_SHA::8}"');
    expect(workflow).toContain('revision="${RESUME_CANDIDATE_REVISION}"');
    expect(workflow).toContain('id: target');
    expect(workflow).toContain('id_token_audience: ${{ steps.target.outputs.service_url }}');
    expect(workflow).toContain('expected_digest=');
    expect(workflow).toContain('actual_image=');
    expect(workflow).toContain('myscube-deploy-sha');
    expect(workflow).toContain('JVM_WEEKLY_COMMIT_SHA=${DEPLOY_SHA}');
    expect(workflow).toContain('select(.name == "JVM_WEEKLY_COMMIT_SHA")');
    expect(workflow).toContain('test "${actual_image}" = "${IMAGE}@${expected_digest}"');
    expect(workflow).toContain('test "${actual_sha}" = "${DEPLOY_SHA}"');
  });

  it('fails closed when the production Cloud Run service is absent, split, or ambiguous', () => {
    expect(workflow).toContain('positive_revision_count=');
    expect(workflow).toContain('total_percent=');
    expect(workflow).toContain('test "${positive_revision_count}" = "1"');
    expect(workflow).toContain('test "${total_percent}" = "100"');
    expect(workflow).not.toContain('service_exists=false');
    expect(workflow).not.toContain('SERVICE_EXISTS: ${{ steps.previous.outputs.service_exists }}');
    expect(workflow).not.toContain('traffic_flag=""');
    expect(workflow).toContain('--no-traffic');
    const candidateBlock = workflow.slice(
      workflow.indexOf('Deploy candidate without live traffic'),
      workflow.indexOf('Resolve existing zero-traffic candidate'),
    );
    expect(candidateBlock).not.toContain('if [ -z "${PREVIOUS_REVISION}" ]; then');
  });

  it('does not expose the internal API token to checkout, build, or dependency install', () => {
    const deployJobStart = workflow.indexOf('  deploy:');
    const jobEnv = workflow.slice(
      workflow.indexOf('    env:', deployJobStart),
      workflow.indexOf('    steps:', deployJobStart),
    );
    expect(jobEnv).not.toContain('${{ secrets.');
    expect(workflow.indexOf('Install rollout audit dependencies'))
      .toBeLessThan(workflow.indexOf('google-github-actions/auth@v3'));
    const buildBlock = workflow.slice(workflow.indexOf('Build tested image'), workflow.indexOf('Deploy candidate without live traffic'));
    expect(buildBlock).not.toContain('JVM_WEEKLY_INTERNAL_API_TOKEN_LIVE');
    expect(workflow).toContain('JVM_WEEKLY_INTERNAL_API_TOKEN: ${{ secrets.JVM_WEEKLY_INTERNAL_API_TOKEN_LIVE }}');
  });

  it('routes an unexpected promoted topology through rollback and verifies the restored service', () => {
    const reconcile = workflow.slice(workflow.indexOf('Reconcile promotion traffic or roll back'));
    expect(reconcile).toContain('for attempt in {1..10}; do');
    expect(reconcile).toContain('[ "${candidate_percent}" = "100" ]');
    expect(reconcile).toContain('[ "${positive_revision_count}" = "1" ]');
    expect(reconcile).toContain('[ "${total_percent}" = "100" ]');
    expect(reconcile).toContain('--to-revisions "${PREVIOUS_REVISION}=100"');
    expect(reconcile).toContain('test "${candidate_percent}" = "0"');
    expect(reconcile).toContain('test "${previous_percent}" = "100"');
    expect(reconcile).toContain('Verify restored canonical service after rollback');
  });

  it('keeps migration write access manual, allowlisted, and ahead of cutover verification', () => {
    expect(workflow).toContain('Apply explicitly approved settlement head migrations');
    expect(workflow).toContain("if: needs.preflight.outputs.apply_migrations == 'true'");
    expect(workflow).toContain('--apply');
    expect(workflow).toContain('--confirm-project "${PROJECT_ID}"');
    expect(workflow).toContain('--confirm-tenant mysc');
    expect(workflow).toContain('--allow-projects "${SETTLEMENT_MIGRATION_PROJECTS}"');
    expect(workflow).toContain('--reason "${SETTLEMENT_MIGRATION_REASON}"');
    expect(workflow.indexOf('Apply explicitly approved settlement head migrations'))
      .toBeLessThan(workflow.indexOf('Verify settlement-cycle inventory and BFF read compatibility'));
    expect(workflow.indexOf('Verify settlement-cycle inventory and BFF read compatibility'))
      .toBeLessThan(workflow.indexOf('Promote verified candidate'));
  });
});
