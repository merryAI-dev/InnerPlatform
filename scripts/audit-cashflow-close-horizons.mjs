#!/usr/bin/env node
// 누적 결산 지평선 전수 조사 — 읽기 전용.
//
// "어디까지 잠겼는가" 의 정답은 프로젝트당 누적 head 문서 하나(closedThrough)다.
// 그런데 sheet-lab 의 readCanonicalClosedCashflowMonths 는 head 의 closedThrough 와
// 월별 monthly_closes 문서를 **합집합**으로 더한다:
//
//     if (closedThrough && yearMonth <= closedThrough) closedMonths.add(yearMonth);
//     ...
//     if (close.status === 'CLOSED') closedMonths.add(yearMonth);
//
// 그래서 head 가 열려 있다고 보는 달이라도 월별 문서 하나가 CLOSED 면 잠긴 것으로 취급된다.
// 이 스크립트는 그 어긋남을 전수로 찾는다.
//
//   node scripts/audit-cashflow-close-horizons.mjs --project inner-platform-live-20260316
//   node scripts/audit-cashflow-close-horizons.mjs --project ID --target 2026-03
//   node scripts/audit-cashflow-close-horizons.mjs --project ID --json

import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';
import {
  CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
  monthsBetween,
  previousYearMonth,
  readCashflowCumulativeCloseAuthority,
} from '../server/bff/cashflow-close-calendar.mjs';

const MONTH_CLOSE_CONTRACT = 'cashflow-month-close-v1';

function readFlag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', resolveProjectId()));
const tenantId = readFlag('--tenant', 'mysc');
const targetThrough = readFlag('--target', '');
const asJson = process.argv.includes('--json');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 되돌릴 개월 수 = 재오픈 요청·승인 횟수.
function unwindSteps(closedThrough, target) {
  if (!closedThrough || !target || target >= closedThrough) return 0;
  return monthsBetween(target, closedThrough).length - 1;
}

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });

  const [headsSnap, closesSnap, projectsSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/cashflow_cumulative_close_heads`).get(),
    db.collection(`orgs/${tenantId}/monthly_closes`).get(),
    db.collection(`orgs/${tenantId}/projects`).get(),
  ]);

  const nameById = new Map(projectsSnap.docs.map((doc) => [
    doc.id,
    text(doc.data()?.name) || text(doc.data()?.projectName) || '',
  ]));

  const headByProject = new Map(headsSnap.docs.map((doc) => [doc.id, doc.data() || {}]));

  // monthly_closes 를 프로젝트별로 모은다. 문서 id 가 아니라 저장된 projectId 를 신뢰한다.
  const closesByProject = new Map();
  for (const doc of closesSnap.docs) {
    const data = doc.data() || {};
    const projectId = text(data.projectId) || doc.id.replace(/-\d{4}-\d{2}$/, '');
    if (!closesByProject.has(projectId)) closesByProject.set(projectId, []);
    closesByProject.get(projectId).push({ id: doc.id, ...data });
  }

  const projectIds = [...new Set([...headByProject.keys(), ...closesByProject.keys()])];
  const rows = [];
  for (const projectId of projectIds) {
    const head = headByProject.get(projectId) || null;
    const closes = closesByProject.get(projectId) || [];
    const closedThrough = text(head?.closedThrough);
    const settlementMonth = text(head?.settlementMonth);
    const authorityValid = head
      ? Boolean(readCashflowCumulativeCloseAuthority(head, { tenantId, projectId, allowOpen: true }))
      : false;

    const closedMonths = closes
      .filter((close) => text(close.status) === 'CLOSED')
      .map((close) => text(close.yearMonth))
      .filter(Boolean)
      .sort();
    // head 지평선 너머인데 월별 문서가 CLOSED — 화면이 "잠김" 으로 보이는 원인.
    const beyondHorizon = closedMonths.filter((yearMonth) => (
      !closedThrough || yearMonth > closedThrough
    ));
    const legacyShaped = closes.filter((close) => (
      text(close.contractVersion) !== MONTH_CLOSE_CONTRACT
    )).map((close) => text(close.yearMonth) || close.id);

    const flags = [];
    if (!head && closedMonths.length > 0) flags.push('head없음(레거시)');
    if (head && !authorityValid) flags.push('authority무효');
    if (beyondHorizon.length > 0) flags.push(`지평선너머CLOSED:${beyondHorizon.join('/')}`);
    if (legacyShaped.length > 0) flags.push(`계약없는문서:${legacyShaped.length}건`);
    if (head && closedThrough && settlementMonth
      && previousYearMonth(settlementMonth) !== closedThrough) flags.push('회차-지평선어긋남');

    rows.push({
      projectId,
      name: nameById.get(projectId) || '',
      hasHead: Boolean(head),
      status: text(head?.status) || '-',
      closedThrough: closedThrough || '-',
      settlementMonth: settlementMonth || '-',
      revision: head && Number.isFinite(Number(head.revision)) ? Number(head.revision) : null,
      authorityValid,
      monthlyCloseCount: closes.length,
      closedMonths,
      beyondHorizon,
      monthsLocked: closedThrough
        ? monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, closedThrough).length
        : 0,
      unwindSteps: unwindSteps(closedThrough, targetThrough),
      flags,
    });
  }

  rows.sort((left, right) => (
    (right.flags.length - left.flags.length)
    || right.closedThrough.localeCompare(left.closedThrough)
  ));

  if (asJson) {
    console.log(JSON.stringify({ tenantId, firebaseProjectId, targetThrough, rows }, null, 2));
    return;
  }

  console.log(`테넌트 ${tenantId} · Firebase ${firebaseProjectId}`);
  console.log(`누적 head ${headsSnap.size}건 · monthly_closes ${closesSnap.size}건 · 관련 프로젝트 ${rows.length}개`);
  if (targetThrough) console.log(`되돌릴 목표: ${targetThrough} 까지`);
  console.log('');

  const pad = (value, width) => String(value).padEnd(width);
  for (const row of rows) {
    console.log([
      pad(row.projectId, 18),
      pad((row.name || '(이름없음)').slice(0, 18), 20),
      pad(row.hasHead ? `head ${row.closedThrough}` : 'head 없음', 18),
      pad(`회차 ${row.settlementMonth}`, 13),
      pad(`월문서 ${row.monthlyCloseCount}건`, 12),
      targetThrough ? pad(`unwind ${row.unwindSteps}`, 11) : '',
      row.flags.join(' '),
    ].join(''));
  }

  const beyond = rows.filter((row) => row.beyondHorizon.length > 0);
  const orphan = rows.filter((row) => !row.hasHead && row.closedMonths.length > 0);
  console.log('');
  console.log(`지평선 너머 CLOSED 월을 가진 프로젝트: ${beyond.length}개`);
  for (const row of beyond) {
    console.log(`  ${row.name || row.projectId}: head=${row.closedThrough} 인데 ${row.beyondHorizon.join(', ')} 이 CLOSED`);
  }
  console.log(`head 없이 CLOSED 월만 있는 레거시 프로젝트: ${orphan.length}개`);
  for (const row of orphan) {
    console.log(`  ${row.name || row.projectId}: ${row.closedMonths.join(', ')}`);
  }
  if (targetThrough) {
    const total = rows.reduce((sum, row) => sum + row.unwindSteps, 0);
    console.log(`\n${targetThrough} 까지 되돌리려면 재오픈 요청·승인 총 ${total}회 (승인 1회마다 경고 1건 기록)`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
