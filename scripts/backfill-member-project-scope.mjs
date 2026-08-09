#!/usr/bin/env node
// 멤버 프로젝트 배정 백필 (#451 "give every member access to every project" 의 데이터 반영).
//
// BFF 에 프로젝트 스코프 인가를 세우면서, 지금까지 JVM 만 하던 검사가 모든 읽기 경로에
// 적용된다. 라이브 활성 멤버 중 전 프로젝트를 가진 사람이 0명이므로 게이트를 그대로
// 켜면 업무가 멈춘다. #451 의 의도대로 활성 멤버에게 전 프로젝트를 부여해 현재 동작을
// 유지한 채 우회 통로만 닫는다. 권한을 조이는 결정은 이 데이터를 다시 좁히면 된다.
//
// 테넌트 전역 역할(admin/finance/auditor/tenant_admin/support/security)은 배정과 무관하게
// 통과하므로 건드리지 않는다.
//
//   1) 사본:    node scripts/backfill-member-project-scope.mjs --project <id> --dump <dir>
//   2) dry-run: node scripts/backfill-member-project-scope.mjs --project <id>
//   3) 실행:    node scripts/backfill-member-project-scope.mjs --project <id> --apply

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';
import { TENANT_WIDE_PROJECT_ROLES, isActiveActorMember, memberProjectIds } from '../server/bff/cashflow-project-scope.mjs';

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
  const [membersSnap, projectsSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/members`).get(),
    db.collection(`orgs/${tenantId}/projects`).get(),
  ]);
  const allProjectIds = projectsSnap.docs.map((doc) => doc.id).sort();

  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const file = join(dumpDir, `members-${tenantId}-${firebaseProjectId}.json`);
    writeFileSync(file, JSON.stringify(
      membersSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      null,
      2,
    ));
    console.log(`사본 저장: ${file} (${membersSnap.size}건)`);
    return;
  }

  const plans = [];
  const skipped = [];
  for (const doc of membersSnap.docs) {
    const member = doc.data() || {};
    const role = String(member.role || '').toLowerCase();
    if (!isActiveActorMember(member, member.uid || doc.id)) {
      skipped.push(`${doc.id}: 비활성 — 건드리지 않음`);
      continue;
    }
    if (TENANT_WIDE_PROJECT_ROLES.includes(role)) {
      skipped.push(`${doc.id}: role=${role} 테넌트 전역 — 배정 불필요`);
      continue;
    }
    const current = memberProjectIds(member);
    const missing = allProjectIds.filter((id) => !current.has(id));
    if (missing.length === 0) {
      skipped.push(`${doc.id}: 이미 전 프로젝트 보유`);
      continue;
    }
    plans.push({ id: doc.id, role, before: current.size, missing: missing.length });
  }

  console.log(`프로젝트 ${allProjectIds.length}개 · 멤버 ${membersSnap.size}건`);
  console.log(`대상 ${plans.length}건 / 제외 ${skipped.length}건  (${apply ? 'APPLY' : 'DRY-RUN'})`);
  for (const plan of plans) console.log(`  ${plan.id} role=${plan.role} ${plan.before} -> ${allProjectIds.length} (+${plan.missing})`);

  if (!apply) return;
  for (const plan of plans) {
    // projectIds 만 전체로 교체한다. portalProfile 등 다른 필드는 그대로 둔다.
    await db.doc(`orgs/${tenantId}/members/${plan.id}`).update({ projectIds: allProjectIds });
  }
  console.log(`\n적용 완료: ${plans.length}건 (projectIds 필드만 갱신)`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
