#!/usr/bin/env node
// 좌표 계약(SPEC-22) 위반 데이터 감사 — 읽기 전용.
//
// 시트는 전사 고정 양식이고 주별 블록은 E:BL 60칸 하나뿐이다. 따라서 한 프로젝트의
// cashflow_weeks 는 한 연도만 가져야 한다. 다른 연도의 주차 문서는 낙오 문서이며,
// 읽기 경로가 "문서가 있으니 그 해는 주별 관리"로 유추해 시트의 연간 열을 무시하게 만든다.
//
// 이 스크립트는 아무것도 쓰지 않는다. 영향 범위만 보고한다.
//
// 사용:
//   node scripts/audit-cashflow-stray-weekly-docs.mjs --project inner-platform-live-20260316
//   node scripts/audit-cashflow-stray-weekly-docs.mjs --project <id> --json > audit.json

import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function readFlag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const asJson = process.argv.includes('--json');
const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', resolveProjectId()));
const onlyTenant = readFlag('--tenant', '');

function yearOf(yearMonth) {
  const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(String(yearMonth ?? ''));
  return match ? Number(match[1]) : null;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function listTenants(db) {
  if (onlyTenant) return [onlyTenant];
  const orgs = await db.collection('orgs').listDocuments();
  return orgs.map((doc) => doc.id);
}

// 시트가 선언한 연간 열 값 (mirror.annualCells) — 화면에 떠야 할 진짜 값
function declaredAnnualByYear(mirror) {
  const byYear = new Map();
  for (const cell of Array.isArray(mirror?.annualCells) ? mirror.annualCells : []) {
    const year = num(cell?.year);
    if (year === null) continue;
    const key = `${year}:${cell?.mode}`;
    const bucket = byYear.get(key) || { year, mode: cell?.mode, total: 0, cellCount: 0 };
    if (cell?.state === 'VALUE' || cell?.state === 'ZERO') {
      bucket.total += num(cell?.amount) ?? 0;
      bucket.cellCount += 1;
    }
    byYear.set(key, bucket);
  }
  return byYear;
}

async function auditTenant(db, tenantId) {
  const weeksSnap = await db.collection(`orgs/${tenantId}/cashflow_weeks`).get();
  if (weeksSnap.empty) return [];

  // 프로젝트별 · 연도별 주차 문서 수
  const byProject = new Map();
  for (const doc of weeksSnap.docs) {
    const data = doc.data() || {};
    const projectId = String(data.projectId ?? '');
    const year = yearOf(data.yearMonth);
    if (!projectId || year === null) continue;
    const entry = byProject.get(projectId) || { projectId, byYear: new Map() };
    const bucket = entry.byYear.get(year) || { year, docCount: 0, docIds: [] };
    bucket.docCount += 1;
    if (bucket.docIds.length < 5) bucket.docIds.push(doc.id);
    entry.byYear.set(year, bucket);
    byProject.set(projectId, entry);
  }

  const findings = [];
  for (const entry of byProject.values()) {
    const years = [...entry.byYear.values()].sort((left, right) => right.docCount - left.docCount);
    if (years.length <= 1) continue; // 주별 연도 하나뿐 — 계약 준수

    // 문서 수가 가장 많은 연도를 주별 블록으로 본다(정상이면 60 근처).
    const [weeklyYear, ...strayYears] = years;

    const [mirrorSnap, ...totalSnaps] = await Promise.all([
      db.doc(`orgs/${tenantId}/cashflow_sheet_mirrors/${entry.projectId}`).get(),
      ...strayYears.map((stray) => db
        .collection(`orgs/${tenantId}/cashflow_sheet_year_totals`)
        .where('projectId', '==', entry.projectId)
        .where('year', '==', stray.year)
        .limit(1)
        .get()),
    ]);

    const mirror = mirrorSnap.exists ? mirrorSnap.data() || {} : null;
    const declared = declaredAnnualByYear(mirror);

    findings.push({
      tenantId,
      projectId: entry.projectId,
      weeklyYear: { year: weeklyYear.year, docCount: weeklyYear.docCount },
      declaredWeeklyYear: num(mirror?.weeklyYear), // SPEC-22 이후에만 존재
      mirrorStatus: mirror?.status ?? null,
      strayYears: strayYears.map((stray, index) => {
        const totalDocs = totalSnaps[index]?.docs ?? [];
        const stored = totalDocs.length > 0 ? totalDocs[0].data() || {} : null;
        return {
          year: stray.year,
          strayDocCount: stray.docCount,
          sampleDocIds: stray.docIds,
          storedYearTotalExists: Boolean(stored),
          sheetDeclaredActual: declared.get(`${stray.year}:actual`)?.total ?? null,
          sheetDeclaredProjection: declared.get(`${stray.year}:projection`)?.total ?? null,
        };
      }),
    });
  }
  return findings;
}

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const tenants = await listTenants(db);
  const all = [];
  for (const tenantId of tenants) {
    all.push(...await auditTenant(db, tenantId));
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ firebaseProjectId, findings: all }, null, 2)}\n`);
    return;
  }

  console.log(`Firestore project: ${firebaseProjectId}`);
  console.log(`낙오 주차 문서가 있는 프로젝트: ${all.length}건\n`);
  for (const finding of all) {
    const strayTotal = finding.strayYears.reduce((sum, stray) => sum + stray.strayDocCount, 0);
    console.log(`■ ${finding.projectId}  (org=${finding.tenantId})`);
    console.log(`  주별 블록 추정: ${finding.weeklyYear.year} (${finding.weeklyYear.docCount}건)`
      + `  mirror.weeklyYear=${finding.declaredWeeklyYear ?? '미기록'}  mirror.status=${finding.mirrorStatus ?? '없음'}`);
    console.log(`  낙오 주차 문서 합계: ${strayTotal}건`);
    for (const stray of finding.strayYears) {
      console.log(`    - ${stray.year}년: 주차문서 ${stray.strayDocCount}건`
        + `  year_totals=${stray.storedYearTotalExists ? '있음' : '없음'}`
        + `  시트연간(actual)=${stray.sheetDeclaredActual ?? '없음'}`
        + `  시트연간(projection)=${stray.sheetDeclaredProjection ?? '없음'}`);
      console.log(`      예시 문서: ${stray.sampleDocIds.join(', ')}`);
    }
    console.log('');
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
