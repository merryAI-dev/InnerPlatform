import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import type { CashflowSheetLabChangeCandidate } from '../../lib/sheets-cashflow-readonly-client';

// 반영 완료 알림 문구. 서버의 appliedLineCount 는 "다시 쓴 월의 전체 셀 수"(월당 160)라
// 사람이 듣고 싶은 "몇 건이 어떻게 바뀌었나"가 아니다. 검토 단계가 돌려준 변경 후보
// (셀 단위 before→after) 로 말한다. 여기서 판정하지 않는다 - 서버가 준 후보를 옮겨 적는다.

const MAX_DETAIL_LINES = 3;

function won(value: number | null | undefined, hadValue: boolean): string {
  if (!hadValue) return '빈칸';
  return `${Number(value ?? 0).toLocaleString('ko-KR')}원`;
}

function weekLabel(candidate: CashflowSheetLabChangeCandidate): string {
  if (candidate.scope === 'annual' || !candidate.yearMonth) {
    return candidate.year ? `${candidate.year}년 연간` : '연간';
  }
  const [year, month] = candidate.yearMonth.split('-');
  const base = `${year.slice(2)}-${Number(month)}`;
  return candidate.weekNo ? `${base}-${candidate.weekNo}` : base;
}

function modeLabel(mode: string): string {
  return mode === 'projection' ? 'Projection' : mode === 'actual' ? 'Actual' : mode;
}

function lineLabel(lineId: string): string {
  return CASHFLOW_SHEET_LINE_LABELS[lineId as CashflowSheetLineId] || lineId;
}

export function describeSheetApplyChange(candidate: CashflowSheetLabChangeCandidate): string {
  return `${weekLabel(candidate)} ${modeLabel(candidate.mode)} ${lineLabel(candidate.lineId)} `
    + `${won(candidate.beforeAmount, candidate.beforeHadValue)} → ${won(candidate.proposedAmount, candidate.proposedHadValue)}`;
}

export interface SheetApplyNotice {
  title: string;
  lines: string[];
}

/**
 * 반영 알림. 건수는 변경 후보 수(=stagedLineCount), 내용은 앞 몇 건을 한 줄씩.
 * 후보 목록이 잘렸으면(서버 500건 상한) 건수는 stagedLineCount 를 믿는다.
 */
export function buildSheetApplyNotice({
  stagedLineCount,
  candidates,
}: {
  stagedLineCount: number;
  candidates?: CashflowSheetLabChangeCandidate[] | null;
}): SheetApplyNotice {
  const list = Array.isArray(candidates) ? candidates : [];
  const count = Number.isSafeInteger(stagedLineCount) && stagedLineCount >= 0 ? stagedLineCount : list.length;
  const title = count === 0
    ? '시트값을 반영했어요. 바뀐 값은 없어요.'
    : `시트값 ${count.toLocaleString('ko-KR')}건을 MYSCube에 반영했어요.`;
  const lines = list.slice(0, MAX_DETAIL_LINES).map(describeSheetApplyChange);
  const rest = count - lines.length;
  if (rest > 0 && lines.length > 0) lines.push(`외 ${rest.toLocaleString('ko-KR')}건`);
  return { title, lines };
}
