/**
 * 참조 명단 푸시 - 연동된 참여율 시트의 숨김 참조 탭 명단(A:B)을 라이브 People 로 갱신한다.
 *
 * 계약: docs/architecture/contracts/2026-08-25-participation-roster-push-contract.md
 * 명단 구성은 이 모듈이 단일 출처다 - 템플릿 빌더(scripts/build-participation-sheet-template.mjs)도
 * 여기서 가져다 쓴다. 만드는 쪽과 미는 쪽이 다른 명단을 쓰기 시작하면 그게 드리프트의 시작이다.
 *
 * 쓰기는 병합-보존이다: 시트에 있는데 라이브 People 에 없는 닉네임(개명·삭제·과거 스냅샷)은
 * 지우지 않고 그대로 남긴다. 지우면 과거 급여 행의 이름 조회가 끊긴다 - 행 수 가드는
 * 같은 수의 교체(개명)를 못 잡으므로, 보존이 append-only 를 실제로 강제하는 장치다.
 *
 * 닿는 범위는 참조 탭 명단 열(A: 닉네임, B: 이름)뿐이다. `참여율 관리` 탭, 참조 탭의
 * 월 목록(D열)·형식 마커(F1)에는 쓰지 않는다. 형식을 모르면 적응하지 않고 거부한다.
 */

import {
  PARTICIPATION_REF_TAB,
  isSupportedParticipationFormat,
} from './participation-sheet-ranges.mjs';
import { extractSpreadsheetId } from './google-sheets.mjs';

const text = (value) => String(value ?? '').trim();

// 아직 누구인지 모르는 자리. 빌더와 같은 구성이어야 한다 - 명단 재작성이 자리표시자를
// 지우면 드롭다운에서 "미정" 선택지가 사라진다.
const PLACEHOLDER_KIND = '미정';
const PLACEHOLDER_COUNT = 10;

function placeholderNicknames() {
  return Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => `${PLACEHOLDER_KIND}-${index + 1}`);
}

/** People 원본 문서를 명단 항목으로 정규화한다: 닉네임 없는 사람 제외, 한국어 닉네임순 정렬. */
export function normalizeRosterPeople(rawPeople = []) {
  return rawPeople
    .map((person) => ({ nickname: text(person?.nickname), name: text(person?.name) }))
    .filter((person) => person.nickname)
    .sort((left, right) => left.nickname.localeCompare(right.nickname, 'ko'));
}

/**
 * 참조 탭 A2 부터 쓸 [닉네임, 이름] 행 전체. 사람 명단 뒤에 자리표시자 미정-1~10 이 붙는다.
 * 자리표시자의 이름 칸은 빈 문자열이다 - 이름이 적히는 순간 실제 사람으로 승격되는 규칙과 짝.
 * (빌더가 새 양식을 만들 때 쓴다. 푸시는 여기에 기존 시트의 보존 행을 병합한다.)
 */
export function composeRosterRows(people = []) {
  const rows = people.map((person) => [person.nickname, person.name]);
  for (const nickname of placeholderNicknames()) rows.push([nickname, '']);
  return rows;
}

/**
 * 병합-보존: 라이브 People + 시트에만 있는 기존 행(자리표시자 제외) + 미정-1~10.
 * 기존 행의 이름은 시트에 적힌 그대로 보존한다 - 개명·삭제된 사람의 과거 표기가
 * 그 시트의 급여 이력이 참조하는 값이다.
 */
export function mergeRosterRows(people = [], existingRows = []) {
  const ourPlaceholders = new Set(placeholderNicknames());
  const liveNicknames = new Set(people.map((person) => person.nickname));
  const preserved = [];
  const seen = new Set();
  for (const row of existingRows) {
    const nickname = text(row?.[0]);
    if (!nickname || seen.has(nickname)) continue;
    seen.add(nickname);
    if (liveNicknames.has(nickname) || ourPlaceholders.has(nickname)) continue;
    preserved.push({ nickname, name: text(row?.[1]) });
  }
  const merged = [...people, ...preserved]
    .sort((left, right) => left.nickname.localeCompare(right.nickname, 'ko'))
    .map((person) => [person.nickname, person.name]);
  for (const nickname of placeholderNicknames()) merged.push([nickname, '']);
  return merged;
}

/**
 * 4xx 는 대부분 사람이 고칠 문제라 재시도하지 않는다. 재시도(api_error)는 일시 장애만:
 * 408/429/5xx/상태 없음(네트워크 단절). 400 을 api_error 로 분류하면 outbox 가 고칠 수
 * 없는 요청을 8번 반복하며 쿼터만 태운다.
 */
function classifySheetsError(error) {
  const statusCode = Number(error?.statusCode) || 0;
  if (statusCode === 401 || statusCode === 403) return 'permission_denied';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500 || statusCode === 0) return 'api_error';
  return 'request_rejected';
}

// invalid_link 는 spreadsheetId 가 없다 - 원본 링크는 link 로 따로 나른다.
// 링크 문자열을 id 자리에 넣으면 '/' 때문에 Firestore 문서 id 로 못 쓴다.
function refusal({ spreadsheetId = '', link = '', spreadsheetTitle = '', reason, message }) {
  return { ok: false, spreadsheetId, link, spreadsheetTitle, reason, message };
}

/**
 * 시트 한 장의 참조 명단을 갱신한다. 항상 결과 객체를 돌려주고 던지지 않는다 -
 * 팬아웃에서 한 시트의 실패가 나머지를 멈추면 안 된다.
 *
 * 쓰기 전 검증 순서가 계약이다:
 *   ① People 이 비어 있지 않음  ② 참조 탭 존재  ③ 형식 마커(F1)가 아는 버전
 *   ④ 병합 결과가 기존보다 줄지 않음(불변식 - 병합 구조상 불가능하지만 마지막 안전핀)
 * 어느 하나라도 어긋나면 쓰지 않고 거부를 기록한다.
 */
export async function pushRosterToSheet({ sheetsService, spreadsheetId, people }) {
  const normalizedId = extractSpreadsheetId(spreadsheetId);
  if (!normalizedId) {
    return refusal({ link: text(spreadsheetId), reason: 'invalid_link', message: '시트 링크에서 spreadsheet ID를 찾지 못했습니다.' });
  }
  // 자리표시자는 항상 10개가 붙으므로 "행이 있다" 로는 빈 People 을 못 잡는다.
  // 사람이 0명인 명단은 People 조회 실패(테넌트 오설정 등)를 의심해야지 쓸 일이 아니다.
  if (!Array.isArray(people) || people.length === 0) {
    return refusal({ spreadsheetId: normalizedId, reason: 'people_empty', message: 'People 명단이 비어 있습니다 - People 조회를 의심하세요.' });
  }

  let meta;
  try {
    meta = await sheetsService.getSpreadsheetMeta(normalizedId);
  } catch (error) {
    return refusal({
      spreadsheetId: normalizedId,
      reason: classifySheetsError(error),
      message: error?.message || '시트 메타데이터를 읽지 못했습니다.',
    });
  }
  const spreadsheetTitle = meta.spreadsheetTitle || normalizedId;

  const refTab = (meta.availableSheets || []).find((sheet) => sheet.title === PARTICIPATION_REF_TAB);
  if (!refTab) {
    return refusal({
      spreadsheetId: normalizedId, spreadsheetTitle,
      reason: 'format_mismatch', message: `양식이 다릅니다 - '${PARTICIPATION_REF_TAB}' 탭이 없습니다.`,
    });
  }

  try {
    const markerMatrix = await sheetsService.getSheetValues({
      spreadsheetId: normalizedId, sheetName: PARTICIPATION_REF_TAB, rangeA1: 'F1',
    });
    const marker = text(markerMatrix?.[0]?.[0]);
    if (!isSupportedParticipationFormat(marker)) {
      return refusal({
        spreadsheetId: normalizedId, spreadsheetTitle,
        reason: 'format_mismatch',
        message: marker ? `양식이 다릅니다 - 알 수 없는 형식: ${marker}` : '양식이 다릅니다 - 형식 마커(참조!F1)가 없습니다.',
      });
    }

    const existingRows = await sheetsService.getSheetValues({
      spreadsheetId: normalizedId, sheetName: PARTICIPATION_REF_TAB, rangeA1: 'A2:B',
    });
    const existingCount = existingRows.filter((row) => text(row?.[0])).length;
    const mergedRows = mergeRosterRows(people, existingRows);
    if (mergedRows.length < existingCount) {
      return refusal({
        spreadsheetId: normalizedId, spreadsheetTitle,
        reason: 'roster_shrunk',
        message: `명단이 줄어듭니다(기존 ${existingCount}행 → ${mergedRows.length}행) - 쓰지 않았습니다.`,
      });
    }

    await sheetsService.batchUpdateValues({
      spreadsheetId: normalizedId,
      sheetName: PARTICIPATION_REF_TAB,
      // RAW 가 계약이다: 이름·닉네임에 '=' 가 섞여도 수식이 아니라 텍스트로 들어간다.
      // USER_ENTERED 는 People 값이 시트에서 실행되는 주입 경로가 된다.
      valueInputOption: 'RAW',
      updates: [{ rangeA1: `A2:B${mergedRows.length + 1}`, values: mergedRows }],
    });
    return {
      ok: true, spreadsheetId: normalizedId, spreadsheetTitle,
      writtenRows: mergedRows.length,
      preservedRows: mergedRows.length - people.length - PLACEHOLDER_COUNT,
    };
  } catch (error) {
    return refusal({
      spreadsheetId: normalizedId, spreadsheetTitle,
      reason: classifySheetsError(error),
      message: error?.message || '참조 명단을 쓰지 못했습니다.',
    });
  }
}

/**
 * 연동된 시트 전체로 팬아웃한다. 같은 시트를 여러 프로젝트가 링크했으면 spreadsheetId
 * 기준으로 1회만 쓰고, 결과에 프로젝트명을 모두 매핑한다 - 상태 화면은 ID 가 아니라
 * "시트 제목 + 프로젝트명" 으로 말해야 한다.
 *
 * links: [{ link, projectId, projectName }]
 */
export async function pushRosterToLinkedSheets({ sheetsService, people, links = [] }) {
  const bySheet = new Map();
  for (const entry of links) {
    const normalizedId = extractSpreadsheetId(entry?.link);
    const key = normalizedId || `invalid:${text(entry?.link)}`;
    if (!bySheet.has(key)) {
      bySheet.set(key, { spreadsheetId: normalizedId, link: entry?.link, projects: [] });
    }
    bySheet.get(key).projects.push({
      projectId: text(entry?.projectId),
      projectName: text(entry?.projectName),
    });
  }

  const results = [];
  // 순차 실행이 의도다: 변동 빈도와 시트 수 규모에서 병렬은 이득이 없고 쿼터만 두드린다.
  for (const target of bySheet.values()) {
    const result = target.spreadsheetId
      ? await pushRosterToSheet({ sheetsService, spreadsheetId: target.spreadsheetId, people })
      : refusal({ link: text(target.link), reason: 'invalid_link', message: '시트 링크에서 spreadsheet ID를 찾지 못했습니다.' });
    results.push({ ...result, projects: target.projects });
  }
  return results;
}
