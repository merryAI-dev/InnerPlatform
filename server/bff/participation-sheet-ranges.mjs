/**
 * 참여율 표준양식의 고정 좌표. 시트를 읽는 쪽과 만드는 쪽이 같은 곳을 가리켜야 한다.
 *
 * 계약: docs/architecture/contracts/2026-08-21-participation-sheet-format-contract.md
 * 만드는 쪽: scripts/build-participation-sheet-template.mjs
 *
 * 좌표가 어긋나면 적응하지 않고 거부한다 - 엉뚱한 달에 값이 들어가는 것이 가장 위험하다.
 */

export const PARTICIPATION_SHEET_TAB = '참여율';
export const PARTICIPATION_REF_TAB = '참조';

/** 양식 식별자. 반영·검증의 첫 관문이다. */
export const PARTICIPATION_FORMAT_RANGE = `${PARTICIPATION_REF_TAB}!F1`;
/** 계약 기간 설정칸(B1 시작월, D1 종료월). C1 은 물결 표시라 함께 읽고 버린다. */
export const PARTICIPATION_PERIOD_RANGE = `${PARTICIPATION_SHEET_TAB}!B1:D1`;
/** 월 머리글 2행. 파서는 이 행만 읽는다 - 1행 연도 표시는 사람 보기용 장식이다. */
export const PARTICIPATION_HEADER_RANGE = `${PARTICIPATION_SHEET_TAB}!G2:DV2`;
/** 고정 열 A~F: 닉네임·이름·역할·투입시작월·투입종료월·기본투입률 */
export const PARTICIPATION_META_RANGE = `${PARTICIPATION_SHEET_TAB}!A3:F62`;
/** 월 칸 본문 */
export const PARTICIPATION_CELL_RANGE = `${PARTICIPATION_SHEET_TAB}!G3:DV62`;

export const PARTICIPATION_RANGES = [
  PARTICIPATION_FORMAT_RANGE,
  PARTICIPATION_PERIOD_RANGE,
  PARTICIPATION_HEADER_RANGE,
  PARTICIPATION_META_RANGE,
  PARTICIPATION_CELL_RANGE,
];

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
