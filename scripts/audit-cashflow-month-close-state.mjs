#!/usr/bin/env node
// 월 결산 확정/잠금 상태 감사 — 읽기 전용. 아무것도 쓰지 않는다.
//
// #496 이전에는 누적 결산 승인이 Firestore 만 갱신하고 JVM 확정을 부르지 않았다. 그래서
// cashflow_cumulative_close_heads 가 비어 있고, 시트 잠금과 변경 경고 누적이 동작하지 않았다.
// 이 스크립트는 그 흔적을 그대로 드러낸다.
//
//   - APPROVED 인데 JVM 월 결산이 CLOSED 가 아닌 요청 (= 과거 결함의 잔재)
//   - cumulative close head 유무와 closedThrough
//   - 승인 대기 중인 요청 (배포 후 첫 확정 후보)
//
// 사용:
//   node scripts/audit-cashflow-month-close-state.mjs --project inner-platform-live-20260316

import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function readFlag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', resolveProjectId()));
const tenantId = readFlag('--tenant', 'mysc');

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const [requestsSnap, headsSnap, closesSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/cashflow_month_close_requests`).get(),
    db.collection(`orgs/${tenantId}/cashflow_cumulative_close_heads`).get(),
    db.collection(`orgs/${tenantId}/monthly_closes`).get(),
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
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
