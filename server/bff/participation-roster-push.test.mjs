import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeRosterRows,
  mergeRosterRows,
  normalizeRosterPeople,
  pushRosterToLinkedSheets,
  pushRosterToSheet,
  tenantMarkerOf,
} from './participation-roster-push.mjs';

const SHEET_ID = 'test-spreadsheet-id-000001';
const TENANT = 'tenant-a';
const PEOPLE = normalizeRosterPeople([
  { nickname: '보람', name: '변민욱' },
  { nickname: '가든', name: '김신영' },
  { nickname: '', name: '닉네임없음' },
]);

/** 시트 한 장짜리 가짜 서비스. 호출 내용을 기록해 "무엇을 썼는가/안 썼는가" 를 단언한다. */
function fakeSheetsService({
  marker = 'MYSC-PARTICIPATION-V2',
  tenantCell = '',
  existingRows = [['가든', '김신영']],
  tabs = ['안내', '참조', '참여율 관리'],
  metaError = null,
  writeError = null,
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
      if (rangeA1 === 'F1:G1') return marker === null ? [] : [[marker, tenantCell]];
      if (rangeA1 === 'A2:B') return existingRows;
      return [];
    },
    async batchUpdateValues(payload) {
      if (writeError) throw writeError;
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

  it('중복 닉네임은 첫 사람만 남긴다 - 같은 닉네임 두 줄은 연결을 흔든다', () => {
    const people = normalizeRosterPeople([
      { nickname: '가든', name: '김신영' },
      { nickname: '가든', name: '동명닉네임' },
    ]);
    expect(people).toEqual([{ nickname: '가든', name: '김신영' }]);
  });

  it('사람 명단 뒤에 미정-1~10 자리표시자가 이름 없이 붙는다', () => {
    const rows = composeRosterRows(PEOPLE);
    expect(rows).toHaveLength(PEOPLE.length + 10);
    expect(rows[0]).toEqual(['가든', '김신영']);
    expect(rows[PEOPLE.length]).toEqual(['미정-1', '']);
    expect(rows[rows.length - 1]).toEqual(['미정-10', '']);
  });
});

describe('mergeRosterRows - 병합-보존이 append-only 를 강제한다', () => {
  it('시트에만 있는 닉네임(개명·삭제)은 시트에 적힌 이름 그대로 보존한다', () => {
    const merged = mergeRosterRows(PEOPLE, [['옛닉네임', '개명전이름'], ['가든', '김신영']]);
    expect(merged).toContainEqual(['옛닉네임', '개명전이름']);
    expect(merged.filter(([nickname]) => nickname === '가든')).toEqual([['가든', '김신영']]);
    expect(merged).toHaveLength(PEOPLE.length + 1 + 10);
  });

  it('기존 자리표시자(미정-N)는 보존 대상이 아니다 - 우리가 다시 쓴다', () => {
    const merged = mergeRosterRows(PEOPLE, [['미정-1', ''], ['미정-2', '']]);
    expect(merged.filter(([nickname]) => nickname === '미정-1')).toHaveLength(1);
    expect(merged).toHaveLength(PEOPLE.length + 10);
  });

  it('구양식의 채용예정-N 은 시트 데이터가 참조할 수 있으므로 보존한다', () => {
    const merged = mergeRosterRows(PEOPLE, [['채용예정-1', '']]);
    expect(merged).toContainEqual(['채용예정-1', '']);
  });
});

describe('pushRosterToSheet - 쓰기 전 검증이 계약이다', () => {
  it('아는 형식(V2)이면 참조 A2:B 에 병합 명단을 RAW 로 재작성한다', async () => {
    const { calls, service } = fakeSheetsService({ existingRows: [['옛닉네임', '개명전이름']] });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result.ok).toBe(true);
    expect(result.spreadsheetTitle).toBe('참여율_공통양식 사본');
    expect(result.preservedRows).toBe(1);
    expect(calls.updates).toHaveLength(1);
    const payload = calls.updates[0];
    expect(payload.sheetName).toBe('참조');
    // People 값이 시트에서 수식으로 실행되면 안 된다 - RAW 는 계약이다.
    expect(payload.valueInputOption).toBe('RAW');
    const written = payload.updates[0].values;
    expect(written).toContainEqual(['옛닉네임', '개명전이름']);
    expect(written).toContainEqual(['가든', '김신영']);
    expect(payload.updates[0].rangeA1).toBe(`A2:B${written.length + 1}`);
    expect(result.writtenRows).toBe(written.length);
  });

  it('V1 사본도 참조 명단 좌표가 같으므로 갱신한다', async () => {
    const { calls, service } = fakeSheetsService({ marker: 'MYSC-PARTICIPATION-V1' });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result.ok).toBe(true);
    expect(calls.updates).toHaveLength(1);
  });

  it.each([
    ['알 수 없는 마커', { marker: 'SOMETHING-ELSE' }],
    ['마커 없음', { marker: null }],
    ['참조 탭 없음', { tabs: ['Sheet1'] }],
  ])('%s 이면 format_mismatch 로 거부하고 쓰지 않는다', async (_label, overrides) => {
    const { calls, service } = fakeSheetsService(overrides);
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result).toMatchObject({ ok: false, reason: 'format_mismatch' });
    expect(calls.updates).toHaveLength(0);
  });

  it('People 이 비어 있으면 people_empty - 자리표시자만 쓰는 사고를 막는다', async () => {
    const { calls, service } = fakeSheetsService();
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: [], tenantId: TENANT });
    expect(result).toMatchObject({ ok: false, reason: 'people_empty' });
    expect(calls.reads).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('병합 결과가 기존보다 줄어들면 roster_shrunk 불변식이 거부한다', async () => {
    // 병합 구조상 정상 경로에선 불가능하지만, 기존 행에 A 빈칸+B 값 같은 변형이 있어도
    // 마지막 안전핀이 지켜지는지 고정한다: 기존 행 수를 인위적으로 부풀린다.
    const existingRows = Array.from({ length: 40 }, (_, index) => [`기존-${index}`, '']);
    const dedupedExisting = existingRows.concat(existingRows); // 중복은 병합에서 1회만 남는다
    const { calls, service } = fakeSheetsService({ existingRows: dedupedExisting });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    // 80행을 읽었지만 중복 제거 후 병합은 40+2+10=52행 → 80 미만이라 거부된다.
    expect(result).toMatchObject({ ok: false, reason: 'roster_shrunk' });
    expect(calls.updates).toHaveLength(0);
  });

  it.each([
    [401, 'permission_denied'],
    [403, 'permission_denied'],
    [404, 'not_found'],
    [400, 'request_rejected'],
    [429, 'api_error'],
    [503, 'api_error'],
  ])('메타 조회 %i 오류는 %s 로 분류한다', async (statusCode, reason) => {
    const { service } = fakeSheetsService({ metaError: statusError(statusCode, '오류') });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('statusCode 없는 네트워크 단절은 api_error(재시도 대상)다', async () => {
    const { service } = fakeSheetsService({ writeError: new Error('socket hang up') });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result).toMatchObject({ ok: false, reason: 'api_error' });
  });

  it('테넌트 마커(G1)가 비어 있으면 명단과 함께 선점 기록한다', async () => {
    const { calls, service } = fakeSheetsService({ tenantCell: '' });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result.ok).toBe(true);
    const claim = calls.updates[0].updates.find((update) => update.rangeA1 === 'G1');
    expect(claim.values).toEqual([[tenantMarkerOf(TENANT)]]);
  });

  it('우리 테넌트 마커면 G1 을 다시 쓰지 않는다', async () => {
    const { calls, service } = fakeSheetsService({ tenantCell: tenantMarkerOf(TENANT) });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result.ok).toBe(true);
    expect(calls.updates[0].updates.some((update) => update.rangeA1 === 'G1')).toBe(false);
  });

  it('다른 테넌트가 선점한 시트는 tenant_mismatch 로 거부하고 쓰지 않는다', async () => {
    const { calls, service } = fakeSheetsService({ tenantCell: tenantMarkerOf('other-tenant') });
    const result = await pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    expect(result).toMatchObject({ ok: false, reason: 'tenant_mismatch' });
    expect(calls.updates).toHaveLength(0);
  });

  it('30초 넘게 멈춘 호출은 api_error 로 끊는다 - 다음 시트가 굶지 않는다', async () => {
    vi.useFakeTimers();
    const service = { getSpreadsheetMeta: () => new Promise(() => {}) };
    const pending = pushRosterToSheet({ sheetsService: service, spreadsheetId: SHEET_ID, people: PEOPLE, tenantId: TENANT });
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: 'api_error' });
    expect(result.message).toContain('30초');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pushRosterToLinkedSheets - 팬아웃', () => {
  const LINK_A = 'https://docs.google.com/spreadsheets/d/sheet-alpha-000000000001/edit';
  const LINK_B = 'https://docs.google.com/spreadsheets/d/sheet-beta-0000000000002/edit';

  it('같은 시트를 링크한 프로젝트들은 1회만 쓰고 프로젝트명을 모두 매핑한다', async () => {
    const { calls, service } = fakeSheetsService();
    const results = await pushRosterToLinkedSheets({
      sheetsService: service,
      people: PEOPLE,
      tenantId: TENANT,
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
      people: PEOPLE,
      tenantId: TENANT,
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
      people: PEOPLE,
      tenantId: TENANT,
      links: [{ link: 'not-a-link', projectId: 'proj-1', projectName: '사업 하나' }],
    });
    expect(results[0]).toMatchObject({ ok: false, reason: 'invalid_link' });
    expect(results[0].spreadsheetId).toBe('');
    expect(calls.updates).toHaveLength(0);
  });
});
