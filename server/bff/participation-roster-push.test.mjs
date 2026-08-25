import { describe, expect, it } from 'vitest';
import {
  composeRosterRows,
  normalizeRosterPeople,
  pushRosterToLinkedSheets,
  pushRosterToSheet,
} from './participation-roster-push.mjs';

const SHEET_ID = 'test-spreadsheet-id-000001';
const PEOPLE = normalizeRosterPeople([
  { nickname: '보람', name: '변민욱' },
  { nickname: '가든', name: '김신영' },
  { nickname: '', name: '닉네임없음' },
]);
const ROSTER = composeRosterRows(PEOPLE);

/** 시트 한 장짜리 가짜 서비스. 호출 내용을 기록해 "무엇을 썼는가/안 썼는가" 를 단언한다. */
function fakeSheetsService({
  marker = 'MYSC-PARTICIPATION-V2',
  existingRows = [['가든', '김신영']],
  tabs = ['안내', '참조', '참여율 관리'],
  metaError = null,
  title = '참여율_공통양식 사본',
} = {}) {
  const calls = { reads: [], updates: [] };
  const service = {
    async getSpreadsheetMeta(spreadsheetId) {
      if (metaError) throw metaError;
      return {
        spreadsheetId,
        spreadsheetTitle: title,
        availableSheets: tabs.map((tabTitle, index) => ({ sheetId: index, title: tabTitle, index })),
      };
    },
    async getSheetValues({ rangeA1 }) {
      calls.reads.push(rangeA1);
      if (rangeA1 === 'F1') return marker === null ? [] : [[marker]];
      if (rangeA1 === 'A2:B') return existingRows;
      return [];
    },
    async batchUpdateValues(payload) {
      calls.updates.push(payload);
      return { totalUpdatedRows: payload.updates[0].values.length };
    },
  };
  return { calls, service };
}

function statusError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

describe('명단 구성 - 빌더와 단일 출처', () => {
  it('닉네임 없는 사람은 빼고 한국어 닉네임순으로 정렬한다', () => {
    expect(PEOPLE.map((person) => person.nickname)).toEqual(['가든', '보람']);
  });

  it('사람 명단 뒤에 미정-1~10 자리표시자가 이름 없이 붙는다', () => {
    expect(ROSTER).toHaveLength(PEOPLE.length + 10);
    expect(ROSTER[0]).toEqual(['가든', '김신영']);
    expect(ROSTER[PEOPLE.length]).toEqual(['미정-1', '']);
    expect(ROSTER[ROSTER.length - 1]).toEqual(['미정-10', '']);
  });
});

describe('pushRosterToSheet - 쓰기 전 검증이 계약이다', () => {
  it('아는 형식(V2)이면 참조 A2:B 에 명단 전체를 재작성한다', async () => {
    const { calls, service } = fakeSheetsService();
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result.ok).toBe(true);
    expect(result.spreadsheetTitle).toBe('참여율_공통양식 사본');
    expect(result.writtenRows).toBe(ROSTER.length);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].sheetName).toBe('참조');
    expect(calls.updates[0].updates).toEqual([
      { rangeA1: `A2:B${ROSTER.length + 1}`, values: ROSTER },
    ]);
  });

  it('V1 사본도 참조 명단 좌표가 같으므로 갱신한다', async () => {
    const { calls, service } = fakeSheetsService({ marker: 'MYSC-PARTICIPATION-V1' });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result.ok).toBe(true);
    expect(calls.updates).toHaveLength(1);
  });

  it.each([
    ['알 수 없는 마커', { marker: 'SOMETHING-ELSE' }],
    ['마커 없음', { marker: null }],
    ['참조 탭 없음', { tabs: ['Sheet1'] }],
  ])('%s 이면 format_mismatch 로 거부하고 쓰지 않는다', async (_label, overrides) => {
    const { calls, service } = fakeSheetsService(overrides);
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result).toMatchObject({ ok: false, reason: 'format_mismatch' });
    expect(calls.updates).toHaveLength(0);
  });

  it('명단이 기존보다 줄어들면 roster_shrunk 로 거부하고 쓰지 않는다', async () => {
    const existingRows = ROSTER.concat([['이미있던닉', '이미있던이름']]);
    const { calls, service } = fakeSheetsService({ existingRows });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result).toMatchObject({ ok: false, reason: 'roster_shrunk' });
    expect(result.message).toContain(`${existingRows.length}행`);
    expect(calls.updates).toHaveLength(0);
  });

  it('기존과 행 수가 같으면(변동이 이름 수정뿐) 쓴다', async () => {
    const { calls, service } = fakeSheetsService({ existingRows: ROSTER });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result.ok).toBe(true);
    expect(calls.updates).toHaveLength(1);
  });

  it('권한 오류(403)는 permission_denied 로 분류한다', async () => {
    const { service } = fakeSheetsService({ metaError: statusError(403, '공유 안 됨') });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: ROSTER });
    expect(result).toMatchObject({ ok: false, reason: 'permission_denied' });
  });

  it('빈 명단은 roster_empty - People 조회 실패가 전 시트를 비우는 것을 막는다', async () => {
    const { calls, service } = fakeSheetsService();
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, rosterRows: [] });
    expect(result).toMatchObject({ ok: false, reason: 'roster_empty' });
    expect(calls.reads).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });
});

describe('pushRosterToLinkedSheets - 팬아웃', () => {
  const LINK_A = 'https://docs.google.com/spreadsheets/d/sheet-alpha-000000000001/edit';
  const LINK_B = 'https://docs.google.com/spreadsheets/d/sheet-beta-0000000000002/edit';

  it('같은 시트를 링크한 프로젝트들은 1회만 쓰고 프로젝트명을 모두 매핑한다', async () => {
    const { calls, service } = fakeSheetsService();
    const results = await pushRosterToLinkedSheets({
      sheetsService: service,
      rosterRows: ROSTER,
      links: [
        { link: LINK_A, projectId: 'proj-1', projectName: '사업 하나' },
        { link: LINK_A, projectId: 'proj-2', projectName: '사업 둘' },
      ],
    });
    expect(results).toHaveLength(1);
    expect(calls.updates).toHaveLength(1);
    expect(results[0].projects.map((project) => project.projectName)).toEqual(['사업 하나', '사업 둘']);
  });

  it('한 시트의 실패가 나머지 시트를 멈추지 않는다', async () => {
    const { service } = fakeSheetsService();
    const failing = fakeSheetsService({ metaError: statusError(403, '공유 안 됨') });
    const routed = {
      ...service,
      async getSpreadsheetMeta(spreadsheetId) {
        if (spreadsheetId.startsWith('sheet-alpha')) return failing.service.getSpreadsheetMeta(spreadsheetId);
        return service.getSpreadsheetMeta(spreadsheetId);
      },
    };
    const results = await pushRosterToLinkedSheets({
      sheetsService: routed,
      rosterRows: ROSTER,
      links: [
        { link: LINK_A, projectId: 'proj-1', projectName: '사업 하나' },
        { link: LINK_B, projectId: 'proj-2', projectName: '사업 둘' },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results.find((entry) => entry.spreadsheetId.startsWith('sheet-alpha')).reason).toBe('permission_denied');
    expect(results.find((entry) => entry.spreadsheetId.startsWith('sheet-beta')).ok).toBe(true);
  });

  it('spreadsheet ID 를 못 뽑는 링크는 invalid_link 로 기록한다', async () => {
    const { calls, service } = fakeSheetsService();
    const results = await pushRosterToLinkedSheets({
      sheetsService: service,
      rosterRows: ROSTER,
      links: [{ link: 'not-a-link', projectId: 'proj-1', projectName: '사업 하나' }],
    });
    expect(results[0]).toMatchObject({ ok: false, reason: 'invalid_link' });
    expect(calls.updates).toHaveLength(0);
  });
});
