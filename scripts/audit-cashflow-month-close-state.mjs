#!/usr/bin/env node
// 월 결산 확정/잠금 상태 감사 + 누적 마감 head 복구 계획.
//
// #496 이전에는 누적 결산 승인이 Firestore 만 갱신하고 JVM 확정을 부르지 않았다. 그래서
// cashflow_cumulative_close_heads 가 비어 있고, 시트 잠금과 변경 경고 누적이 동작하지 않았다.
// 기본 실행은 읽기 전용이다. --apply, 명시적 프로젝트 allowlist, People UID, 사유가 모두
// 주어져야만 immutable monthly run 근거로 head 하나를 transaction 안에서 생성한다.
//
//   - APPROVED 인데 JVM 월 결산이 CLOSED 가 아닌 요청 (= 과거 결함의 잔재)
//   - cumulative close head 유무와 closedThrough
//   - non-OPEN monthly_closes 인데 head 가 없는 legacy/mismatch
//   - 승인 대기 중인 요청 (배포 후 첫 확정 후보)
//
// 사용:
//   node scripts/audit-cashflow-month-close-state.mjs --firebase-project demo-mysc --tenant mysc
//   node scripts/audit-cashflow-month-close-state.mjs --firebase-project demo-mysc --tenant mysc \
//     --apply --allow-projects project-a --people-uid uid-a --reason "승인된 복구 작업"

import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';
import { createAuditChainService } from '../server/bff/audit-chain.mjs';
import {
  buildCumulativeCloseHeadPlan,
  executeCumulativeCloseHeadMigration,
  parseCumulativeCloseHeadMigrationArgs,
  validateCumulativeCloseHeadMigrationOptions,
} from './cashflow-cumulative-close-head-migration.mjs';

function usage() {
  console.log(`사용:
  # 기본값: read-only dry-run
  node scripts/audit-cashflow-month-close-state.mjs [--firebase-project ID] [--tenant ID]

  # 명시적 allowlist에 대해서만 transaction backfill
  node scripts/audit-cashflow-month-close-state.mjs --firebase-project ID --tenant ID \\
    --apply --allow-projects PROJECT_ID[,PROJECT_ID...] \\
    --people-uid PEOPLE_UID --reason "승인된 복구 사유"

금지:
  --apply 단독 실행, wildcard allowlist, 불완전한 monthly run 근거는 모두 차단됩니다.`);
}

function asDocuments(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function main() {
  const parsedOptions = parseCumulativeCloseHeadMigrationArgs(process.argv.slice(2));
  if (parsedOptions.help) {
    usage();
    return;
  }
  const options = validateCumulativeCloseHeadMigrationOptions(parsedOptions);
  const firebaseProjectId = options.firebaseProjectId || resolveProjectId();
  const tenantId = options.tenantId;
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const [requestsSnap, headsSnap, closesSnap, versionsSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/cashflow_month_close_requests`).get(),
    db.collection(`orgs/${tenantId}/cashflow_cumulative_close_heads`).get(),
    db.collection(`orgs/${tenantId}/monthly_closes`).get(),
    db.collection(`orgs/${tenantId}/monthly_close_versions`).get(),
  ]);

  const heads = new Map(headsSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const closesByProject = new Map();
  for (const doc of closesSnap.docs) {
    const close = doc.data() || {};
    const projectId = String(close.projectId || '');
    if (!closesByProject.has(projectId)) closesByProject.set(projectId, []);
    closesByProject.get(projectId).push(close);
  }

  const byStatus = new Map();
  const approvedWithoutJvmClose = [];
  const pending = [];
  for (const doc of requestsSnap.docs) {
    const record = doc.data() || {};
    const status = String(record.status || 'UNKNOWN');
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    const projectId = String(record.projectId || '');
    if (['PENDING', 'APPROVING', 'UNCERTAIN'].includes(status)) {
      pending.push({
        requestId: doc.id,
        projectId,
        yearMonth: record.yearMonth,
        status,
        revision: record.revision,
        requestedAt: record.requestedAt,
        approverUid: record.approverUid,
        hasHead: heads.has(projectId),
      });
    }
    if (status !== 'APPROVED') continue;
    const closed = (closesByProject.get(projectId) || [])
      .some((close) => close.yearMonth === record.yearMonth && String(close.status) === 'CLOSED');
    if (!closed) {
      approvedWithoutJvmClose.push({
        requestId: doc.id,
        projectId,
        yearMonth: record.yearMonth,
        reviewedAt: record.reviewedAt || null,
        hasHead: heads.has(projectId),
        storedMonthCloseResult: Boolean(record.monthCloseResult),
      });
    }
  }

  console.log(`테넌트 ${tenantId} · Firebase ${firebaseProjectId}`);
  console.log(`\n결산 요청 ${requestsSnap.size}건`);
  for (const [status, count] of [...byStatus].sort()) console.log(`  ${status.padEnd(12)} ${count}`);

  console.log(`\ncumulative close head ${headsSnap.size}건 (= JVM 확정이 실제로 일어난 프로젝트)`);
  for (const [projectId, head] of heads) {
    console.log(`  ${projectId}  closedThrough=${head.closedThrough || '-'}  status=${head.status || '-'}  rev=${head.revision ?? '-'}  closedAt=${head.closedAt || '-'}`);
  }

  console.log(`\nAPPROVED 인데 JVM 월이 CLOSED 가 아닌 요청: ${approvedWithoutJvmClose.length}건`);
  for (const row of approvedWithoutJvmClose) {
    console.log(`  ${row.projectId} ${row.yearMonth}  head=${row.hasHead ? 'Y' : 'N'}  monthCloseResult=${row.storedMonthCloseResult ? 'Y' : 'N'}  reviewedAt=${row.reviewedAt || '-'}`);
  }

  console.log(`\n승인 대기 중인 요청: ${pending.length}건`);
  for (const row of pending) {
    console.log(`  ${row.projectId} ${row.yearMonth}  ${row.status} r${row.revision}  head=${row.hasHead ? 'Y' : 'N'}  requestedAt=${row.requestedAt || '-'}`);
  }

  const closedMonths = closesSnap.docs.filter((doc) => String((doc.data() || {}).status) === 'CLOSED').length;
  console.log(`\nmonthly_closes ${closesSnap.size}건 중 CLOSED ${closedMonths}건`);

  const migrationPlan = buildCumulativeCloseHeadPlan({
    tenantId,
    requests: asDocuments(requestsSnap),
    heads: asDocuments(headsSnap),
    monthlyCloses: asDocuments(closesSnap),
    monthlyCloseVersions: asDocuments(versionsSnap),
  });
  const planCounts = migrationPlan.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  console.log('\n누적 마감 authority head 감사/복구 계획');
  for (const status of ['AUTHORITY_PRESENT', 'READY', 'REPAIR_READY', 'UNREPAIRABLE']) {
    console.log(`  ${status.padEnd(22)} ${planCounts[status] || 0}`);
  }
  for (const row of migrationPlan) {
    const evidence = row.head
      ? `through=${row.head.closedThrough} root=${row.head.rootHash.slice(0, 16)}… rev=${row.head.revision}`
      : `reasons=${row.reasons.join(',') || '-'}`;
    console.log(`  ${row.projectId} ${row.settlementMonth || '-'} ${row.status} ${evidence}`);
  }

  const result = await executeCumulativeCloseHeadMigration({
    db,
    tenantId,
    plan: migrationPlan,
    options,
    auditChainService: options.apply ? createAuditChainService(db) : null,
  });
  console.log(`\n실행 모드: ${result.mode}`);
  if (result.mode === 'DRY_RUN') {
    console.log('  Firestore write 0건 (기본 read-only)');
  } else {
    console.log(`  생성/복구 ${result.applied.length}건: ${result.applied.join(', ') || '-'}`);
    console.log(`  idempotent replay ${result.replayed.length}건: ${result.replayed.join(', ') || '-'}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
