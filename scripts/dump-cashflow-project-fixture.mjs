// 라이브 읽기 전용 덤프. 이 프로세스는 에뮬레이터 환경변수 없이 실행한다.
import { writeFileSync } from 'node:fs';
import { createFirestoreDb } from '/Users/boram/orca/workspaces/MYSCube/spec22-integration/server/bff/firestore.mjs';
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('dump 프로세스에는 에뮬레이터 환경변수가 있으면 안 된다');
const TENANT = 'mysc';
const PROJECT = 'p1773817948751';
const live = createFirestoreDb({ projectId: 'inner-platform-live-20260316' });
const out = [];
async function grab(path) {
  const snap = await live.doc(path).get();
  if (snap.exists) out.push([path, snap.data()]);
}
const project = (await live.doc(`orgs/${TENANT}/projects/${PROJECT}`).get()).data();
await grab(`orgs/${TENANT}/projects/${PROJECT}`);
await grab(`orgs/${TENANT}/cashflow_sheet_mirrors/${PROJECT}`);
await grab(`orgs/${TENANT}/cashflow_sheet_publications/${PROJECT}`);
await grab(`orgs/${TENANT}/members/${project.executiveApproverId}`);
const members = await live.collection(`orgs/${TENANT}/members`).get();
for (const d of members.docs.slice(0, 60)) out.push([`orgs/${TENANT}/members/${d.id}`, d.data()]);
const weeks = await live.collection(`orgs/${TENANT}/cashflow_weeks`).get();
for (const d of weeks.docs) {
  if (String((d.data() || {}).projectId) === PROJECT) out.push([`orgs/${TENANT}/cashflow_weeks/${d.id}`, d.data()]);
}
writeFileSync(process.argv[2], JSON.stringify(out));
console.log(`덤프 ${out.length}건 -> ${process.argv[2]} (라이브 쓰기 0건)`);
