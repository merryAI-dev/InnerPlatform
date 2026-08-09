#!/usr/bin/env node
// 라이브 캐시플로 프로젝트를 로컬 end-to-end 하네스용 고정물로 덤프한다. 읽기 전용.
//
// 이 프로세스는 에뮬레이터 환경변수 없이 실행해야 한다. getOrInitAdminApp 은 appName 없이
// 부르면 getApps()[0] 을 돌려주므로, 한 프로세스에서 라이브와 에뮬레이터 핸들을 같이 만들면
// 두 번째 핸들이 첫 번째 앱을 재사용해 라이브에 쓰게 된다. 그래서 덤프와 로드를 나눈다.
//
// 인적사항은 내보내지 않는다. 필요한 것은 사람이 아니라 데이터 모양과 인가 판정에 쓰이는
// 역할·상태·프로젝트 배정이다.
//
// 여기서 지우는 방식(denylist)을 쓰지 않는 이유: 프로젝트 문서 하나에만 managerName,
// executiveApproverName, teamMembersDetailed[].memberName, registeredByName,
// managementPlanningReviewComment, contractAnalysis 자유서술이 들어 있다. 몇 개를 지우면
// 다음에 생기는 필드를 놓친다. 그래서 (1) 문서 종류마다 내보낼 필드를 열거하고,
// (2) 결과물을 다시 훑어 허용하지 않은 자리에 사람 이름이 보이면 파일을 쓰지 않고 실패한다.
//
//   node scripts/dump-cashflow-project-fixture.mjs <out.json> [--project <projectId>]

import { writeFileSync } from 'node:fs';
import { createFirestoreDb } from '../server/bff/firestore.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('덤프 프로세스에 FIRESTORE_EMULATOR_HOST 가 있으면 안 된다. 로드와 프로세스를 분리할 것.');
}

const outPath = process.argv[2];
if (!outPath) throw new Error('사용: node scripts/dump-cashflow-project-fixture.mjs <out.json> [--project <id>]');
const projectIndex = process.argv.indexOf('--project');
const PROJECT = projectIndex === -1 ? 'p1773817948751' : process.argv[projectIndex + 1];
const TENANT = 'mysc';

// 한글이 정상적으로 남아 있어야 하는 자리. 시트 행 라벨은 좌표 계약의 일부이지 인적사항이 아니다.
const HANGUL_ALLOWED_KEYS = new Set(['sourceLabel', 'selectedSheetName', 'sheetName']);

function pick(source, keys) {
  const result = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

// 인가 판정에 실제로 읽히는 필드만 (cashflow-project-scope.mjs, requireStoredCashflowWriter).
function maskMember(id, data) {
  return {
    ...pick(data, ['uid', 'role', 'status', 'projectId', 'projectIds']),
    uid: data.uid ?? id,
    portalProfile: data.portalProfile && typeof data.portalProfile === 'object'
      ? pick(data.portalProfile, ['projectId', 'projectIds'])
      : undefined,
    name: `member-${String(id).slice(0, 6)}`,
    email: `${String(id).toLowerCase()}@mysc.co.kr`,
  };
}

// 조직장 지정과 프로젝트 정체성만. 계약 분석·결재 이력·팀원 명단은 하네스와 무관하다.
function maskProject(id, data) {
  return {
    ...pick(data, ['id', 'tenantId', 'version', 'executiveApproverId', 'status']),
    id: data.id ?? id,
    name: `project-${String(id).slice(0, 8)}`,
  };
}

// 주차 문서는 금액과 좌표가 본질이다. 누가 고쳤는지는 필요 없다.
function maskWeek(id, data) {
  const { updatedByName, updatedByUid, ...rest } = data;
  return rest;
}

// 미러는 셀이 본질이다. 스프레드시트 제목과 시트 메타 문구는 사람 이름을 실어 나른다.
function maskMirror(_id, data) {
  const { spreadsheetTitle, sheetFacts, sources, ...rest } = data;
  const maskedSources = sources && typeof sources === 'object'
    ? Object.fromEntries(Object.entries(sources).map(([year, source]) => [
      year,
      source && typeof source === 'object'
        ? { ...source, spreadsheetTitle: undefined }
        : source,
    ]))
    : undefined;
  return {
    ...rest,
    ...(maskedSources ? { sources: maskedSources } : {}),
    ...(sheetFacts && typeof sheetFacts === 'object'
      ? { sheetFacts: { ...sheetFacts, metadata: undefined } }
      : {}),
  };
}

function assertNoPersonalNames(rows) {
  const offenders = [];
  const walk = (path, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, next] of Object.entries(value)) walk(path ? `${path}.${key}` : key, next);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((next, index) => walk(`${path}[${index}]`, next));
      return;
    }
    if (typeof value !== 'string' || !/[가-힣]/.test(value)) return;
    const leaf = path.replace(/\[\d+\]/g, '').split('.').pop();
    if (HANGUL_ALLOWED_KEYS.has(leaf)) return;
    offenders.push(`${path} = ${value.slice(0, 40)}`);
  };
  for (const [docPath, data] of rows) walk(docPath, data);
  if (offenders.length > 0) {
    throw new Error(
      `허용하지 않은 자리에 사람이 읽는 한글 문자열이 남아 있다. 마스킹을 넓히거나 필드를 빼야 한다:\n  ${
        offenders.slice(0, 20).join('\n  ')}${offenders.length > 20 ? `\n  … 외 ${offenders.length - 20}건` : ''}`,
    );
  }
}

const live = createFirestoreDb({ projectId: 'inner-platform-live-20260316' });
const rows = [];

async function grab(path, mask) {
  const snap = await live.doc(path).get();
  if (snap.exists) rows.push([path, mask(snap.id, snap.data())]);
}

const project = (await live.doc(`orgs/${TENANT}/projects/${PROJECT}`).get()).data();
if (!project) throw new Error(`프로젝트를 찾을 수 없다: ${PROJECT}`);

await grab(`orgs/${TENANT}/projects/${PROJECT}`, maskProject);
await grab(`orgs/${TENANT}/cashflow_sheet_mirrors/${PROJECT}`, maskMirror);
await grab(`orgs/${TENANT}/cashflow_sheet_publications/${PROJECT}`, (_id, data) => data);

const members = await live.collection(`orgs/${TENANT}/members`).get();
for (const doc of members.docs) rows.push([`orgs/${TENANT}/members/${doc.id}`, maskMember(doc.id, doc.data())]);

const weeks = await live.collection(`orgs/${TENANT}/cashflow_weeks`).get();
let weekCount = 0;
for (const doc of weeks.docs) {
  if (String((doc.data() || {}).projectId) !== PROJECT) continue;
  rows.push([`orgs/${TENANT}/cashflow_weeks/${doc.id}`, maskWeek(doc.id, doc.data())]);
  weekCount += 1;
}

assertNoPersonalNames(rows);
writeFileSync(outPath, JSON.stringify(rows));
console.log(`덤프 ${rows.length}건 -> ${outPath} (멤버 ${members.size} · 주차 ${weekCount} · 라이브 쓰기 0건)`);
