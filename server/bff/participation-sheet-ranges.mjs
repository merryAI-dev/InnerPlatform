/**
 * 참여율 표준양식의 고정 좌표. 시트를 읽는 쪽과 만드는 쪽이 같은 곳을 가리켜야 한다.
 *
 * 계약: docs/architecture/contracts/2026-08-21-participation-sheet-format-contract.md
 * 만드는 쪽: scripts/build-participation-sheet-template.mjs
 *
 * 좌표가 어긋나면 적응하지 않고 거부한다 - 엉뚱한 달에 값이 들어가는 것이 가장 위험하다.
 */

/**
 * 탭 이름은 고정이다. 워크북 안 여러 탭 중 하나로 들어가더라도 이 이름이어야 한다.
 * 사람이 정하게 하면 오타 하나로 연동이 끊기고, 그 오타를 찾는 일이 다시 사람 몫이 된다.
 * 이름이 다르면 적응하지 않고 거부한다 - 좌표 계약과 같은 원칙이다.
 */
export const PARTICIPATION_SHEET_TAB = '참여율 관리';
export const PARTICIPATION_REF_TAB = '참조';
export const PARTICIPATION_FORMAT_V1_ID = 'MYSC-PARTICIPATION-V1';
export const PARTICIPATION_FORMAT_V2_ID = 'MYSC-PARTICIPATION-V2';
export const PARTICIPATION_FORMAT_CURRENT_ID = PARTICIPATION_FORMAT_V2_ID;

const FORMAT_LAST_MONTH_COLUMN = {
  [PARTICIPATION_FORMAT_V1_ID]: 'DV',
  [PARTICIPATION_FORMAT_V2_ID]: 'IX',
};

const FORMAT_MONTH_CAPACITY = {
  [PARTICIPATION_FORMAT_V1_ID]: 120,
  [PARTICIPATION_FORMAT_V2_ID]: 252,
};

export function isSupportedParticipationFormat(formatId) {
  return Object.hasOwn(FORMAT_LAST_MONTH_COLUMN, String(formatId || '').trim());
}

export function participationFormatMonthCapacity(formatId) {
  return FORMAT_MONTH_CAPACITY[String(formatId || '').trim()] || 0;
}

export function participationSheetRanges(formatId = PARTICIPATION_FORMAT_CURRENT_ID) {
  const normalizedFormatId = String(formatId || '').trim();
  const lastMonthColumn = FORMAT_LAST_MONTH_COLUMN[normalizedFormatId]
    || FORMAT_LAST_MONTH_COLUMN[PARTICIPATION_FORMAT_CURRENT_ID];
  return {
    /** 양식 식별자. 반영·검증의 첫 관문이다. */
    format: { sheetName: PARTICIPATION_REF_TAB, rangeA1: 'F1' },
    /** 계약 기간 설정칸(B1 시작월, D1 종료월). C1 은 물결 표시라 함께 읽고 버린다. */
    period: { sheetName: PARTICIPATION_SHEET_TAB, rangeA1: 'B1:D1' },
    /** 월 머리글 2행. 파서는 이 행만 읽는다 - 1행 연도 표시는 사람 보기용 장식이다. */
    header: { sheetName: PARTICIPATION_SHEET_TAB, rangeA1: `G2:${lastMonthColumn}2` },
    /** 고정 열 A~F: 닉네임·이름·역할·투입시작월·투입종료월·기본투입률 */
    meta: { sheetName: PARTICIPATION_SHEET_TAB, rangeA1: 'A3:F62' },
    /** 월 칸 본문 */
    cells: { sheetName: PARTICIPATION_SHEET_TAB, rangeA1: `G3:${lastMonthColumn}62` },
  };
}

/**
 * 읽어 온 다섯 범위를 파서 입력으로 맞춘다.
 * 시트 API 는 뒤쪽 빈 칸을 아예 돌려주지 않으므로, 없는 자리는 빈 문자열로 본다.
 */
export function toParticipationSheetInput({ format, period, header, meta, cells } = {}) {
  const periodRow = (period || [])[0] || [];
  return {
    formatCellValue: ((format || [])[0] || [])[0] || '',
    periodValues: { start: periodRow[0] || '', end: periodRow[2] || '' },
    headerValues: (header || [])[0] || [],
    metaValues: meta || [],
    cellValues: cells || [],
  };
}
