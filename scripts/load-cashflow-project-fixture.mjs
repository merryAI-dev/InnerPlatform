// 에뮬레이터 전용 로드. 이 프로세스는 라이브 자격증명을 절대 만들지 않는다.
import { readFileSync } from 'node:fs';
import { createFirestoreDb } from '/Users/boram/orca/workspaces/MYSCube/spec22-integration/server/bff/firestore.mjs';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('load 프로세스에는 에뮬레이터 환경변수가 필요하다');
const db = createFirestoreDb({ projectId: 'demo-axr-e2e' });
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [path, value] of rows) await db.doc(path).set(value);
const probe = await db.doc('orgs/mysc/projects/p1773817948751').get();
console.log(`로드 ${rows.length}건. 에뮬레이터 확인: ${probe.exists ? probe.data().name : 'MISSING'}`);
