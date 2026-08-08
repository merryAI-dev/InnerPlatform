#!/usr/bin/env node
// mirror.weeklyYear 1회 백필 (SPEC-22 롤아웃 준비).
//
// 새 코드는 mirror.weeklyYear 를 읽어 동작하고, 없으면 blocker 로 강등한다.
// 라이브 mirror 에는 이 필드가 없으므로, 배포 전에 시트가 선언한 값으로 채운다.
//
// 값의 출처는 유추가 아니라 시트 선언이다: mirror.cells 의 yearMonth 는 수집 시점에
// 시트 주차 라벨 행(E12/E35)에서 파싱된 값이므로, 그 연도가 곧 주별 블록의 연도다.
// 연도가 단일하지 않거나 주차 셀이 없으면 건드리지 않는다 (다음 수집이 채운다).
//
//   1) 사본:    node scripts/backfill-mirror-weekly-year.mjs --project <id> --dump <dir>
//   2) dry-run: node scripts/backfill-mirror-weekly-year.mjs --project <id>
//   3) 실행:    node scripts/backfill-mirror-weekly-year.mjs --project <id> --apply

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function readFlag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
}

const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', resolveProjectId()));
const tenantId = readFlag('--tenant', 'mysc');
const dumpDir = readFlag('--dump', '');
const apply = process.argv.includes('--apply');

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const snap = await db.collection(`orgs/${tenantId}/cashflow_sheet_mirrors`).get();

  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const file = join(dumpDir, `cashflow_sheet_mirrors-${tenantId}-${firebaseProjectId}.json`);
    writeFileSync(file, JSON.stringify(
      snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      null,
      2,
    ));
    console.log(`사본 저장: ${file} (${snap.size}건)`);
    return;
  }

  const plans = [];
  const skipped = [];
  for (const doc of snap.docs) {
    const mirror = doc.data() || {};
    if (Number.isSafeInteger(Number(mirror.weeklyYear))) {
      skipped.push(`${doc.id}: weeklyYear=${mirror.weeklyYear} 이미 있음`);
      continue;
    }
    const years = [...new Set((mirror.cells || [])
      .map((cell) => Number(String(cell?.yearMonth).slice(0, 4)))
      .filter(Number.isSafeInteger))];
    if (years.length !== 1) {
      skipped.push(`${doc.id}: 주차 셀 연도 ${years.join('/') || '없음'} — 건드리지 않음`);
      continue;
    }
    plans.push({ id: doc.id, weeklyYear: years[0] });
  }

  console.log(`대상 ${plans.length}건 / 제외 ${skipped.length}건  (${apply ? 'APPLY' : 'DRY-RUN'})`);
  for (const plan of plans) console.log(`  ${plan.id} <- weeklyYear=${plan.weeklyYear}`);
  for (const line of skipped) console.log(`  [제외] ${line}`);

  if (!apply) return;
  for (const plan of plans) {
    await db.doc(`orgs/${tenantId}/cashflow_sheet_mirrors/${plan.id}`).update({ weeklyYear: plan.weeklyYear });
  }
  console.log(`\n적용 완료: ${plans.length}건 (weeklyYear 필드 1개 추가, 다른 필드 무변경)`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
