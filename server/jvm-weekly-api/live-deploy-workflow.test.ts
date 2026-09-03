import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/jvm-production-deploy.yml'),
  'utf8',
);

function extractShellFunction(text: string, name: string) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${name}() {`);
  if (start < 0) throw new Error(`Missing workflow shell function: ${name}`);
  const indent = lines[start].search(/\S/);
  const end = lines.findIndex((line, index) => (
    index > start && line === `${' '.repeat(indent)}}`
  ));
  if (end < 0) throw new Error(`Unclosed workflow shell function: ${name}`);
  return lines.slice(start, end + 1).map((line) => line.slice(indent)).join('\n');
}

function runDigestNormalizer(text: string, imageUri: string, expectedRepository: string) {
  const functionSource = extractShellFunction(text, 'normalize_live_image_digest');
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    functionSource,
    'normalized="$(normalize_live_image_digest "$1" "$2")"',
    'printf \'%s\\n\' "${normalized}"',
  ].join('\n'), 'digest-normalizer', imageUri, expectedRepository], { encoding: 'utf8' });
}

function runJsonNormalizer(text: string, functionName: string, value: unknown) {
  const functionSource = extractShellFunction(text, functionName);
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    functionSource,
    `normalized="$(${functionName} <<< "$1")"`,
    'printf \'%s\\n\' "${normalized}"',
  ].join('\n'), 'json-normalizer', JSON.stringify(value)], { encoding: 'utf8' });
}

function runJsonAssertion(
  text: string,
  functionName: string,
  value: unknown,
  env: Record<string, string>,
) {
  const functionSource = extractShellFunction(text, functionName);
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    functionSource,
    `${functionName} <<< "$1"`,
  ].join('\n'), 'json-assertion', JSON.stringify(value)], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runTextFunction(text: string, functionName: string, value: string) {
  const functionSource = extractShellFunction(text, functionName);
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    functionSource,
    `${functionName} "$1"`,
  ].join('\n'), 'text-function', value], { encoding: 'utf8' });
}

function runJqAssertion(expression: string, value: unknown, env: Record<string, string>) {
  return spawnSync('jq', ['-e', expression], {
    input: JSON.stringify(value),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runLegacyDashboardGate(
  text: string,
  canonical: unknown,
  candidate: unknown,
  env: Record<string, string>,
) {
  const assertionSource = extractShellFunction(text, 'assert_legacy_dashboard_shape');
  const normalizerSource = extractShellFunction(text, 'legacy_dashboard_core');
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    assertionSource,
    normalizerSource,
    'assert_legacy_dashboard_shape <<< "$1"',
    'assert_legacy_dashboard_shape <<< "$2"',
    'canonical_core="$(legacy_dashboard_core <<< "$1")"',
    'candidate_core="$(legacy_dashboard_core <<< "$2")"',
    'test "${candidate_core}" = "${canonical_core}"',
  ].join('\n'), 'legacy-dashboard-gate', JSON.stringify(canonical), JSON.stringify(candidate)], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function extractNamedStep(text: string, name: string) {
  const marker = `      - name: ${name}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const next = text.indexOf('\n      - ', start + marker.length);
  return text.slice(start, next < 0 ? text.length : next);
}

function extractStepIf(step: string) {
  return step.match(/^        if:\s*(.+)$/m)?.[1] ?? null;
}

function assertCandidateLegacyWiring(step: string) {
  expect(step).toMatch(
    /for dashboard in "\$\{canonical_legacy_dashboard\}" "\$\{candidate_legacy_dashboard\}"; do\s+assert_legacy_dashboard_shape <<< "\$\{dashboard\}" >\/dev\/null\s+done/,
  );
  expect(step).toContain('canonical_legacy_dashboard_core="$(legacy_dashboard_core \\');
  expect(step).toContain('candidate_legacy_dashboard_core="$(legacy_dashboard_core \\');
  expect(step).toContain(
    'test "${candidate_legacy_dashboard_core}" = "${canonical_legacy_dashboard_core}"',
  );
}

function assertRollbackLegacyWiring(step: string) {
  expect(step).toMatch(/"\$\{canonical_url\}\/api\/v1\/health" \\\n\s+\| assert_legacy_health >\/dev\/null/);
  expect(step).toMatch(
    /dashboard-source\?yearMonth=\$\{CASHFLOW_YEAR_MONTH\}" \\\n\s+\| assert_legacy_dashboard_shape >\/dev\/null/,
  );
  expect(step).not.toContain('settlementCycle=true');
  expect(step).not.toContain('settlement-cycle-v1');
  expect(step.trimEnd().endsWith('exit 1')).toBe(true);
}

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

  it('promotes the backward-compatible JVM after candidate canaries without using frontend cutover inventory as the automatic gate', () => {
    const identityStep = extractNamedStep(workflow, 'Verify candidate image and commit identity');
    const candidateCanary = extractNamedStep(workflow, 'Verify candidate against legacy live read');
    const inventoryStep = extractNamedStep(
      workflow,
      'Verify settlement-cycle inventory and BFF read compatibility',
    );
    const promoteStep = extractNamedStep(workflow, 'Promote verified candidate');

    expect(workflow).toContain('JVM_SETTLEMENT_CANARY_ACTOR_UID_LIVE');
    expect(workflow).toContain('node scripts/audit-cashflow-settlement-cycle-rollout.mjs');
    expect(workflow).not.toContain('npm run cashflow:settlement-cycle:audit');
    expect(identityStep).toContain('test "${actual_image}" = "${IMAGE}@${expected_digest}"');
    expect(identityStep).toContain('test "${actual_sha}" = "${DEPLOY_SHA}"');
    expect(candidateCanary).toContain('/api/v1/health');
    expect(candidateCanary).toContain('settlement-cycle-v1');
    expect(candidateCanary).toContain('SERVICE_URL: ${{ steps.target.outputs.service_url }}');
    expect(candidateCanary).toContain('legacy_dashboard_path=');
    expect(candidateCanary).toContain('month-close/dashboard-source?yearMonth=${CASHFLOW_YEAR_MONTH}"');
    expect(candidateCanary).toContain('canonical_legacy_dashboard=');
    expect(candidateCanary).toContain('candidate_legacy_dashboard=');
    expect(candidateCanary).toContain('del(.settlementCycle)');
    expect(candidateCanary).toContain('weekly_overview_request=');
    expect(candidateCanary).toContain("'{projectIds: [$projectId], yearMonth: $yearMonth}'");
    expect(candidateCanary).toContain('/api/v1/cashflow/weekly-overview');
    expect(candidateCanary).toContain('canonical_weekly_overview=');
    expect(candidateCanary).toContain('candidate_weekly_overview=');
    expect(candidateCanary).toContain('.version == "1"');
    expect(candidateCanary).toContain('weekly_overview_cycle_request=');
    expect(candidateCanary).toContain("'{projectIds: [$projectId], yearMonth: $yearMonth, settlementCycle: true}'");
    expect(candidateCanary).toContain('candidate_cycle_weekly_overview=');
    expect(candidateCanary).toContain('.version == "2"');
    expect(candidateCanary).toContain('.period == "MONTH"');
    expect(candidateCanary).toContain('legacy_weekly_overview_core');
    expect(candidateCanary).toContain('settlementCycle=true');
    expect(workflow.indexOf('Verify candidate image and commit identity'))
      .toBeLessThan(workflow.indexOf('Verify candidate against legacy live read'));
    expect(workflow.indexOf('Verify candidate against legacy live read'))
      .toBeLessThan(workflow.indexOf('Promote verified candidate'));
    expect(extractStepIf(inventoryStep))
      .toBe("needs.preflight.outputs.apply_migrations == 'true'");
    expect(inventoryStep).toContain('--verify-cutover');
    expect(extractStepIf(promoteStep)).toBeNull();
  });

  it('validates canonical settlement identity, vocabulary, and state-gated capability shape before and after promotion', () => {
    const candidateStep = extractNamedStep(workflow, 'Verify candidate against legacy live read');
    const canonicalStep = extractNamedStep(workflow, 'Verify canonical service after promotion');
    const candidateAssertion = extractShellFunction(candidateStep, 'assert_canonical_settlement_cycle');
    const canonicalAssertion = extractShellFunction(canonicalStep, 'assert_canonical_settlement_cycle');
    const candidatePreviousMonth = extractShellFunction(candidateStep, 'previous_year_month');
    const canonicalPreviousMonth = extractShellFunction(canonicalStep, 'previous_year_month');
    expect(canonicalAssertion).toBe(candidateAssertion);
    expect(canonicalPreviousMonth).toBe(candidatePreviousMonth);
    expect(candidateStep).toContain(
      'assert_canonical_settlement_cycle <<< "${candidate_cycle_item}" >/dev/null',
    );
    expect(candidateStep).toContain(
      'assert_canonical_settlement_cycle <<< "${candidate_cycle_dashboard}" >/dev/null',
    );
    expect(canonicalStep).toContain(
      'assert_canonical_settlement_cycle <<< "${canonical_cycle_dashboard}" >/dev/null',
    );
    for (const step of [candidateStep, canonicalStep]) {
      expect(step).toContain(
        'EXPECTED_MONTH_CLOSE_TARGET_YEAR_MONTH="$(previous_year_month "${CASHFLOW_YEAR_MONTH}")"',
      );
    }
    expect(runTextFunction(candidateStep, 'previous_year_month', '2026-09')).toMatchObject({
      status: 0,
      stdout: '2026-08\n',
    });
    expect(runTextFunction(candidateStep, 'previous_year_month', '2027-01')).toMatchObject({
      status: 0,
      stdout: '2026-12\n',
    });
    expect(runTextFunction(candidateStep, 'previous_year_month', '2026-13').status).not.toBe(0);

    const commandNames = [
      'SUBMIT_MONTH_CLOSE',
      'WITHDRAW_MONTH_CLOSE',
      'APPROVE_MONTH_CLOSE',
      'REJECT_MONTH_CLOSE',
      'REQUEST_MONTH_REOPEN',
      'APPROVE_MONTH_REOPEN',
      'REJECT_MONTH_REOPEN',
      'CANCEL_ACTIVE_CYCLE',
    ];
    const allDeniedCapabilities = Object.fromEntries(commandNames.map((command) => [
      command,
      { allowed: false, reasonCode: 'BUSINESS_STATE_NOT_ELIGIBLE' },
    ]));
    const submitted = {
      settlementCycle: {
        cycleYearMonth: '2026-09',
        weeklyYearMonth: '2026-09',
        monthCloseTargetYearMonth: '2026-08',
        businessState: 'SUBMITTED',
        health: 'OK',
        commandCapabilities: allDeniedCapabilities,
      },
    };
    const env = {
      CASHFLOW_YEAR_MONTH: '2026-09',
      EXPECTED_MONTH_CLOSE_TARGET_YEAR_MONTH: '2026-08',
    };
    for (const step of [candidateStep, canonicalStep]) {
      expect(runJsonAssertion(step, 'assert_canonical_settlement_cycle', submitted, env).status).toBe(0);
      expect(runJsonAssertion(step, 'assert_canonical_settlement_cycle', {
        settlementCycle: {
          ...submitted.settlementCycle,
          commandCapabilities: {
            ...allDeniedCapabilities,
            APPROVE_MONTH_CLOSE: { allowed: true, reasonCode: '' },
          },
        },
      }, env).status).toBe(0);
    }
    expect(runJsonAssertion(candidateStep, 'assert_canonical_settlement_cycle', {
      settlementCycle: {
        ...submitted.settlementCycle,
        businessState: 'LOCKED',
        commandCapabilities: {
          ...allDeniedCapabilities,
          REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
        },
      },
    }, env).status).toBe(0);

    for (const sabotage of [
      { settlementCycle: { ...submitted.settlementCycle, businessState: 'PENDING_APPROVAL' } },
      { settlementCycle: { ...submitted.settlementCycle, businessState: 'APPROVED' } },
      { settlementCycle: { ...submitted.settlementCycle, monthCloseTargetYearMonth: '2026-09' } },
      {
        settlementCycle: {
          ...submitted.settlementCycle,
          commandCapabilities: Object.fromEntries(
            Object.entries(allDeniedCapabilities).filter(([command]) => command !== 'CANCEL_ACTIVE_CYCLE'),
          ),
        },
      },
      {
        settlementCycle: {
          ...submitted.settlementCycle,
          commandCapabilities: {
            ...allDeniedCapabilities,
            REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
          },
        },
      },
      {
        settlementCycle: {
          ...submitted.settlementCycle,
          businessState: 'LOCKED',
          commandCapabilities: {
            ...allDeniedCapabilities,
            APPROVE_MONTH_CLOSE: { allowed: true, reasonCode: '' },
          },
        },
      },
      {
        settlementCycle: {
          ...submitted.settlementCycle,
          commandCapabilities: {
            ...allDeniedCapabilities,
            APPROVE_MONTH_CLOSE: { allowed: 'yes', reasonCode: '' },
          },
        },
      },
    ]) {
      expect(runJsonAssertion(
        candidateStep,
        'assert_canonical_settlement_cycle',
        sabotage,
        env,
      ).status).not.toBe(0);
    }
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
    expect(workflow).toContain('node scripts/verify-vercel-deployment-identity.mjs');
    expect(workflow).toContain('--alias-host "${VERCEL_CANONICAL_PRODUCTION_HOST}"');
    expect(workflow).toContain('--ancestor-of "${DEPLOY_SHA}"');
    expect(workflow).toContain('VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}');
    expect(workflow).toContain('VERCEL_GITHUB_REPOSITORY_ID: ${{ github.repository_id }}');
    expect(workflow).not.toMatch(/inspect\s+"\$\{bff_deployment_host\}"\s+--json/);
    expect(workflow).not.toContain('deploy-prod-align.mjs');
    expect(workflow).not.toContain('BFF_SPLIT_RELEASE_BASE_HOST_LIVE');
    expect(workflow).toContain('BFF_SPLIT_RELEASE_BASE_SHA: ${{ vars.BFF_SPLIT_RELEASE_BASE_SHA_LIVE }}');
    expect(workflow).toContain('--legacy-missing-invocation-sha "${BFF_SPLIT_RELEASE_BASE_SHA}"');
    expect(workflow).not.toContain('BFF_DEPLOY_BASE_SHA="${BFF_SPLIT_RELEASE_BASE_SHA}"');
    expect(workflow).toContain('JVM_SPLIT_RELEASE_BASE_SHA_LIVE');
    expect(workflow).toContain('status.imageDigest');
    expect(workflow).not.toContain('git hash-object -t tree /dev/null');
    expect(workflow).toContain('per_page=100');
    expect(workflow.indexOf('Verify cashflow settlement split-release boundary'))
      .toBeLessThan(workflow.indexOf('Build tested image'));
  });

  it('normalizes only an exact live image URI from the expected repository', () => {
    const repository = 'example.pkg.dev/project/repository/service';
    const digest = `sha256:${'a'.repeat(64)}`;
    const valid = runDigestNormalizer(workflow, `${repository}@${digest}`, repository);
    expect(valid.status).toBe(0);
    expect(valid.stdout.trim()).toBe(digest);

    for (const malformed of [
      `other.pkg.dev/project/repository/service@${digest}`,
      digest,
      `${repository}@sha256:${'a'.repeat(63)}`,
      `${repository}@SHA256:${'a'.repeat(64)}`,
      `${repository}@${digest}@${digest}`,
      `${repository}@`,
    ]) {
      expect(runDigestNormalizer(workflow, malformed, repository).status).not.toBe(0);
    }

    const boundaryBlock = workflow.slice(
      workflow.indexOf('Verify cashflow settlement split-release boundary'),
      workflow.indexOf('Build tested image'),
    );
    expect(boundaryBlock).toContain('live_image_uri="$(jq -er \'.status.imageDigest\'');
    expect(boundaryBlock).toContain('live_digest="$(normalize_live_image_digest "${live_image_uri}" "${IMAGE}")"');
    expect(boundaryBlock).toContain('[[ "${JVM_SPLIT_RELEASE_BASE_SHA}" =~ ^[0-9a-f]{40}$ ]] || {');
    expect(boundaryBlock).toContain('[[ "${bootstrap_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || {');
  });

  it('allows only the dashboard additive field while keeping legacy weekly v1, MONTH, and status exact', () => {
    const month = { period: 'MONTH', status: 'PENDING_APPROVAL', revision: 3 };
    const week = { period: 'WEEK_1', status: 'COMPLETED', revision: 7 };
    const legacyDashboard = {
      monthClose: { projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN' },
      cashflow: { projectId: 'project-a', sourceRevision: 'source-1' },
      settlementStatuses: { projectId: 'project-a', yearMonth: '2026-07', items: [month, week] },
    };
    const additiveDashboard = { ...legacyDashboard, settlementCycle: { businessState: 'PENDING_APPROVAL' } };
    const dashboardBaseline = runJsonNormalizer(workflow, 'legacy_dashboard_core', legacyDashboard);
    const dashboardAdditive = runJsonNormalizer(workflow, 'legacy_dashboard_core', additiveDashboard);
    expect(dashboardBaseline.status).toBe(0);
    expect(dashboardAdditive.stdout).toBe(dashboardBaseline.stdout);
    expect(runJsonNormalizer(workflow, 'legacy_dashboard_core', {
      ...legacyDashboard,
      settlementStatuses: { ...legacyDashboard.settlementStatuses, items: [week] },
    }).stdout).not.toBe(dashboardBaseline.stdout);
    expect(runJsonNormalizer(workflow, 'legacy_dashboard_core', {
      ...legacyDashboard,
      settlementStatuses: {
        ...legacyDashboard.settlementStatuses,
        items: [{ ...month, status: 'COMPLETED' }, week],
      },
    }).stdout).not.toBe(dashboardBaseline.stdout);

    const legacyWeekly = {
      version: '1',
      yearMonth: '2026-07',
      items: [{
        projectId: 'project-a',
        settlementStatuses: legacyDashboard.settlementStatuses,
        projectionActualSummary: { cumulativeDifference: 100 },
      }],
      errors: [{ projectId: 'project-a', code: 'SUMMARY_UNAVAILABLE' }],
    };
    const reorderedLegacyWeekly = {
      ...legacyWeekly,
      items: [...legacyWeekly.items].reverse(),
      errors: [...legacyWeekly.errors].reverse(),
    };
    const additiveWeekly = {
      ...legacyWeekly,
      version: '2',
      items: legacyWeekly.items.map((item) => ({
        ...item,
        settlementCycle: { businessState: 'PENDING_APPROVAL' },
      })),
      errors: [...legacyWeekly.errors, { projectId: 'project-a', code: 'MONTH_CLOSE_UNAVAILABLE' }],
    };
    const weeklyBaseline = runJsonNormalizer(workflow, 'legacy_weekly_overview_core', legacyWeekly);
    const weeklyReordered = runJsonNormalizer(
      workflow,
      'legacy_weekly_overview_core',
      reorderedLegacyWeekly,
    );
    expect(weeklyBaseline.status).toBe(0);
    expect(weeklyReordered.stdout).toBe(weeklyBaseline.stdout);
    expect(runJsonNormalizer(
      workflow,
      'legacy_weekly_overview_core',
      additiveWeekly,
    ).stdout).not.toBe(weeklyBaseline.stdout);
    expect(runJsonNormalizer(workflow, 'legacy_weekly_overview_core', {
      ...legacyWeekly,
      items: legacyWeekly.items.map((item) => ({
        ...item,
        settlementStatuses: { ...item.settlementStatuses, items: [week] },
      })),
    }).stdout).not.toBe(weeklyBaseline.stdout);
    expect(runJsonNormalizer(workflow, 'legacy_weekly_overview_core', {
      ...legacyWeekly,
      items: legacyWeekly.items.map((item) => ({
        ...item,
        settlementStatuses: {
          ...item.settlementStatuses,
          items: [{ ...month, status: 'COMPLETED' }, week],
        },
      })),
    }).stdout).not.toBe(weeklyBaseline.stdout);
  });

  it('executes the candidate legacy dashboard gate with nullable cashflow and rejects real drift', () => {
    const candidateStep = extractNamedStep(workflow, 'Verify candidate against legacy live read');
    const env = { CASHFLOW_PROJECT_ID: 'project-a', CASHFLOW_YEAR_MONTH: '2026-07' };
    const month = { period: 'MONTH', status: 'PENDING_APPROVAL', revision: 3 };
    const canonical = {
      monthClose: { projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN' },
      cashflow: null,
      settlementStatuses: { items: [month] },
      sectionErrors: [{ section: 'cashflow', code: 'SOURCE_UNAVAILABLE' }],
    };
    const additiveCandidate = { ...canonical, settlementCycle: null };

    const incidentPredicate = runJqAssertion(
      `.monthClose.projectId == env.CASHFLOW_PROJECT_ID
        and .monthClose.yearMonth == env.CASHFLOW_YEAR_MONTH
        and .cashflow.projectId == env.CASHFLOW_PROJECT_ID
        and ([.settlementStatuses.items[]? | select(.period == "MONTH")] | length == 1)`,
      canonical,
      env,
    );
    expect(incidentPredicate.status).not.toBe(0);

    expect(runLegacyDashboardGate(candidateStep, canonical, additiveCandidate, env).status).toBe(0);
    expect(runLegacyDashboardGate(candidateStep, {
      ...canonical,
      cashflow: { projectId: 'project-a', revision: 7 },
    }, {
      ...additiveCandidate,
      cashflow: { projectId: 'project-a', revision: 7 },
    }, env).status).toBe(0);

    for (const sabotage of [
      { ...additiveCandidate, monthClose: { ...canonical.monthClose, projectId: 'project-b' } },
      { ...additiveCandidate, cashflow: { projectId: 'project-b', revision: 7 } },
      { ...additiveCandidate, settlementStatuses: { items: [] } },
      { ...additiveCandidate, settlementStatuses: { items: [month, { ...month, revision: 4 }] } },
      {
        ...additiveCandidate,
        settlementStatuses: { items: [{ ...month, status: 'COMPLETED' }] },
      },
      {
        ...additiveCandidate,
        settlementStatuses: { items: [{ ...month, revision: 4 }] },
      },
      { ...additiveCandidate, sectionErrors: [] },
    ]) {
      expect(runLegacyDashboardGate(candidateStep, canonical, sabotage, env).status).not.toBe(0);
    }
  });

  it('locks the candidate legacy gate wiring against assertion or parity bypasses', () => {
    const candidateStep = extractNamedStep(workflow, 'Verify candidate against legacy live read');
    expect(() => assertCandidateLegacyWiring(candidateStep)).not.toThrow();

    const sabotages = [
      candidateStep.replace(
        'assert_legacy_dashboard_shape <<< "${dashboard}" >/dev/null',
        'true',
      ),
      candidateStep.replace(
        'test "${candidate_legacy_dashboard_core}" = "${canonical_legacy_dashboard_core}"',
        'true',
      ),
      candidateStep.replace(
        '"${canonical_legacy_dashboard}" "${candidate_legacy_dashboard}"',
        '"${candidate_legacy_dashboard}"',
      ),
    ];
    for (const sabotage of sabotages) {
      expect(sabotage).not.toBe(candidateStep);
      expect(() => assertCandidateLegacyWiring(sabotage)).toThrow();
    }
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
    expect(workflow).toContain('[[ "${expected_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || {');
    expect(workflow).toContain('actual_image="$(jq -er \'.status.imageDigest\'');
    expect(workflow).not.toContain('actual_image="${IMAGE}@${actual_digest}"');
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

  it('executes the rollback canary against the previous legacy contract and keeps the original failure', () => {
    const reconcile = extractNamedStep(workflow, 'Reconcile promotion traffic or roll back');
    const env = { CASHFLOW_PROJECT_ID: 'project-a', CASHFLOW_YEAR_MONTH: '2026-07' };
    const legacyHealth = { ok: true, service: 'jvm-weekly-api', runtime: 'spring-boot' };
    const legacyDashboard = {
      monthClose: { projectId: 'project-a', yearMonth: '2026-07', status: 'OPEN' },
      cashflow: null,
      settlementStatuses: {
        items: [{ period: 'MONTH', status: 'PENDING_APPROVAL', revision: 3 }],
      },
    };

    expect(runJsonAssertion(reconcile, 'assert_legacy_health', legacyHealth, env).status).toBe(0);
    expect(runJsonAssertion(reconcile, 'assert_legacy_dashboard_shape', legacyDashboard, env).status).toBe(0);
    expect(runJsonAssertion(reconcile, 'assert_legacy_health', {
      ...legacyHealth,
      runtime: 'unexpected',
    }, env).status).not.toBe(0);
    expect(runJsonAssertion(reconcile, 'assert_legacy_dashboard_shape', {
      ...legacyDashboard,
      cashflow: { projectId: 'project-b' },
    }, env).status).not.toBe(0);
    expect(reconcile).not.toContain('settlement-cycle-v1');
    expect(reconcile).not.toContain('settlementCycle=true');
    expect(reconcile).toMatch(/assert_legacy_health[\s\S]*assert_legacy_dashboard_shape[\s\S]*exit 1/);
  });

  it('locks rollback health/dashboard pipelines and final failure against wiring bypasses', () => {
    const reconcile = extractNamedStep(workflow, 'Reconcile promotion traffic or roll back');
    expect(() => assertRollbackLegacyWiring(reconcile)).not.toThrow();

    const sabotages = [
      reconcile.replace('| assert_legacy_health >/dev/null', '| jq -e .ok >/dev/null'),
      reconcile.replace('| assert_legacy_dashboard_shape >/dev/null', '| jq -e .monthClose >/dev/null'),
      reconcile.replace(/exit 1\s*$/, 'exit 0\n'),
    ];
    for (const sabotage of sabotages) {
      expect(sabotage).not.toBe(reconcile);
      expect(() => assertRollbackLegacyWiring(sabotage)).toThrow();
    }
  });

  it('keeps migration write access manual, allowlisted, and ahead of cutover verification', () => {
    const migrationStep = extractNamedStep(
      workflow,
      'Apply explicitly approved settlement head migrations',
    );
    const inventoryStep = extractNamedStep(
      workflow,
      'Verify settlement-cycle inventory and BFF read compatibility',
    );
    expect(extractStepIf(migrationStep)).toBe("needs.preflight.outputs.apply_migrations == 'true'");
    expect(extractStepIf(inventoryStep)).toBe("needs.preflight.outputs.apply_migrations == 'true'");
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
