// 하루치 주정산 완료를 모아 한 번만 알린다. JVM 이 이미 쓴 완료 기록을 읽기만 하고 아무 것도 판정하지 않는다.
// completedAt 은 Instant.toString() 결과라 ISO 문자열이다 - 문자열 범위 비교가 시각 비교와 같다.
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const SLACK_USER_ID = /^[UW][A-Z0-9]{8,}$/;
const COMPLETED_STATUSES = new Set(['SUBMITTED', 'LOCKED']);

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 주어진 시각이 속한 KST 하루의 경계. date 는 KST 날짜, startAt/endAt 은 조회에 쓰는 ISO 문자열. */
export function kstDayWindow(at) {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const startMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  return {
    date: new Date(startMs + KST_OFFSET_MS).toISOString().slice(0, 10),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + DAY_MS).toISOString(),
  };
}

/** 다이제스트 제목에 붙는 KST 기준 시각(HH:mm). */
export function kstTimeLabel(at) {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
}

/** 회수(reopen)된 주차는 완료가 아니므로 뺀다. 정렬은 완료 순. */
export function selectCompletedInWindow(documents, window) {
  return documents
    .filter((document) => COMPLETED_STATUSES.has(readText(document.status)))
    .filter((document) => {
      const completedAt = readText(document.completedAt);
      return completedAt >= window.startAt && completedAt < window.endAt;
    })
    .sort((left, right) => readText(left.completedAt).localeCompare(readText(right.completedAt)));
}

/** 사업(@담당자) 한 덩어리. 슬랙 아이디가 없으면 이름으로 떨어뜨린다. */
export function formatDigestEntry({ projectName, completedByName, slackUserId }) {
  const owner = SLACK_USER_ID.test(readText(slackUserId))
    ? `<@${readText(slackUserId)}>`
    : (readText(completedByName) || '미확인');
  return `${readText(projectName) || '이름 미확인'}(${owner})`;
}

/** 완료 건이 없으면 null - 조용한 날에는 슬랙을 보내지 않는다. */
export function buildCashflowWeeklyDigestMessage({ date, timeLabel, entries }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const summary = `${date} ${timeLabel} 기준 · ${entries.length}건`;
  const body = entries.map(formatDigestEntry).join(', ');
  return {
    text: `[MYSCube] 주정산 완료 현황 ${summary}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*[MYSCube] 주정산 완료 현황*\n${summary}\n${body}` },
      },
    ],
  };
}
