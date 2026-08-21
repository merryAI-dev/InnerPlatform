/**
 * 참여율 시트 해석. 전부 순수 함수 - 시트도 Firestore 도 만지지 않는다.
 *
 * 계약: docs/architecture/contracts/2026-08-21-participation-sheet-format-contract.md
 *
 * 원칙 셋.
 *   1) 셀 3상태를 절대 섞지 않는다. 빈칸 = 아직 확인 안 됨(미입력) · 0 = 확인된 미참여 ·
 *      1~100 = 참여율. 급여와 연결되므로 "깜빡" 과 "없음" 은 다른 사실이다.
 *   2) 양식이 다르면 적응하지 않고 거부한다. 추론·폴백으로 읽어내지 않는다.
 *   3) 사람을 못 찾는 것은 오류가 아니다. People 등록이 늦을 뿐이므로 연결 대기로 보고하고
 *      진행한다. 신원의 권위는 언제나 People 이고 시트가 아니다.
 */

export const PARTICIPATION_FORMAT_ID = 'MYSC-PARTICIPATION-V1';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PLACEHOLDER_PREFIX = '채용예정';

function text(value) {
  return typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
}

/** 사람 키. 백필 스크립트와 같은 정규화 규칙이어야 같은 사람이 같은 키가 된다. */
export function personKeyOf(value) {
  return text(value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

/** 다음 달. 헤더 연속성 검사용이라 문자열로만 다룬다. */
function nextMonth(yearMonth) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * 참여율 칸 하나를 읽는다.
 * 빈칸은 값이 아니라 상태이므로 null 을 돌려주고, 호출부는 키 자체를 만들지 않는다.
 */
function readRate(raw) {
  const value = text(raw);
  if (value === '') return { state: 'EMPTY', rate: null };
  const numeric = Number(value.replace(/%$/, ''));
  if (!Number.isFinite(numeric)) return { state: 'INVALID', rate: null };
  if (numeric < 0 || numeric > 100) return { state: 'OUT_OF_RANGE', rate: numeric };
  return { state: 'VALUE', rate: numeric };
}

/**
 * 시트 원값을 구조로 바꾼다. 실패해도 던지지 않고 issues 로 돌려준다 - 사람은 행 단위로
 * 무엇이 잘못됐는지 봐야 하고, 첫 오류에서 멈추면 한 번에 하나씩만 고치게 된다.
 *
 * headerValues 는 2행(G열부터), metaValues 는 A~F 열, cellValues 는 월 칸이다.
 * 파서는 1행(연도 표시)을 읽지 않는다 - 그것은 사람 보기용 장식이다.
 */
export function parseParticipationSheet({
  formatCellValue = '',
  periodValues = {},
  headerValues = [],
  metaValues = [],
  cellValues = [],
} = {}) {
  const issues = [];
  const months = [];
  for (const raw of headerValues) {
    const month = text(raw);
    if (month === '') break; // 기간 밖 열은 헤더가 비어 있다. 거기서 끝이다.
    months.push(month);
  }

  const rows = [];
  for (let index = 0; index < metaValues.length; index += 1) {
    const meta = metaValues[index] || [];
    const nickname = text(meta[0]);
    const name = text(meta[1]);
    const role = text(meta[2]);
    const stintStart = text(meta[3]);
    const stintEnd = text(meta[4]);
    const baseRateRead = readRate(meta[5]);
    const cells = cellValues[index] || [];

    const monthlyRates = {};
    let hasAnyValue = false;
    for (let column = 0; column < months.length; column += 1) {
      const month = months[column];
      const read = readRate(cells[column]);
      if (read.state === 'EMPTY') continue; // 빈칸은 키를 만들지 않는다(미입력 ≠ 0)
      hasAnyValue = true;
      if (read.state === 'INVALID' || read.state === 'OUT_OF_RANGE') {
        issues.push(issue(
          'participation_rate_invalid',
          `${nickname || name || '이름 없음'} 의 ${month} 참여율이 0~100 사이 숫자가 아닙니다.`,
          { rowIndex: index, month },
        ));
        continue;
      }
      monthlyRates[month] = read.rate;
    }

    // 사람도 값도 없는 줄은 빈 줄이다. 여유 줄이 오류로 잡히면 안 된다.
    if (!nickname && !name && !role && !stintStart && !stintEnd && !hasAnyValue) continue;
    rows.push({
      rowIndex: index,
      nickname,
      name,
      role,
      stintStart,
      stintEnd,
      baseRate: baseRateRead.state === 'VALUE' ? baseRateRead.rate : null,
      monthlyRates,
    });
  }

  return {
    formatId: text(formatCellValue),
    period: { start: text(periodValues.start), end: text(periodValues.end) },
    months,
    rows,
    issues,
  };
}

/**
 * 양식 검증. 여기서 걸리면 전체를 거부한다 - 좌표가 어긋난 시트를 부분적으로 읽는 것이
 * 가장 위험하다(엉뚱한 달에 값이 들어간다).
 */
export function validateParticipationFormat({ formatId, period, months } = {}) {
  const issues = [];
  if (text(formatId) !== PARTICIPATION_FORMAT_ID) {
    issues.push(issue(
      'participation_format_mismatch',
      `참여율 표준양식이 아닙니다. 확인된 양식: ${text(formatId) || '없음'}`,
    ));
    return issues; // 양식이 아니면 나머지 검사는 의미가 없다
  }

  const start = text(period?.start);
  const end = text(period?.end);
  if (!MONTH_RE.test(start) || !MONTH_RE.test(end) || start > end) {
    issues.push(issue(
      'participation_period_invalid',
      '시트 맨 위의 계약 시작월·종료월을 확인해 주세요.',
    ));
    return issues;
  }

  const list = Array.isArray(months) ? months : [];
  if (!list.length || list[0] !== start || list[list.length - 1] !== end) {
    issues.push(issue(
      'participation_header_gap',
      '월 머리글이 계약 기간과 맞지 않습니다. 머리글을 수정했거나 열을 넣고 지운 흔적입니다.',
    ));
    return issues;
  }
  for (let index = 1; index < list.length; index += 1) {
    if (list[index] !== nextMonth(list[index - 1])) {
      issues.push(issue(
        'participation_header_gap',
        `월 머리글이 끊겼습니다: ${list[index - 1]} 다음이 ${list[index]} 입니다.`,
      ));
      break;
    }
  }
  return issues;
}

/**
 * 시트 기간과 플랫폼 계약 기간의 대조. 이 검사가 기간 변경의 순서를 강제한다 -
 * 플랫폼에서 계약 기간을 먼저 고치지 않으면 시트를 반영할 수 없다.
 */
export function validatePeriodAgainstProject({ period, project } = {}) {
  const start = text(period?.start);
  const end = text(period?.end);
  const projectStart = text(project?.contractStart).slice(0, 7);
  const projectEnd = text(project?.contractEnd).slice(0, 7);
  if (!MONTH_RE.test(projectStart) || !MONTH_RE.test(projectEnd)) {
    return issue(
      'participation_project_period_missing',
      '이 사업의 계약 기간이 없습니다. 등록·수정에서 계약 기간을 먼저 저장해 주세요.',
    );
  }
  if (start !== projectStart || end !== projectEnd) {
    return issue(
      'participation_period_mismatch',
      `시트 기간(${start}~${end})이 사업 계약 기간(${projectStart}~${projectEnd})과 다릅니다.`,
      { sheetPeriod: { start, end }, projectPeriod: { start: projectStart, end: projectEnd } },
    );
  }
  return null;
}

/**
 * 신원 해석. 못 찾아도 오류가 아니다 - 급여 기록은 People 등록을 기다리지 않는다.
 *   ① 닉네임이 People 에서 유일 ② 이름이 유일 ③ 둘 다 적혔으면 같은 사람일 때만
 *   ④ 채용예정-N 은 사람 미정 자리 ⑤ 나머지는 연결 대기
 */
export function resolvePeopleIdentity({ rows = [], people = [] } = {}) {
  const byNickname = new Map();
  const byName = new Map();
  for (const person of people) {
    const personId = text(person?.personId) || text(person?.id);
    if (!personId) continue;
    for (const [index, value] of [[byNickname, person?.nickname], [byName, person?.name]]) {
      const key = personKeyOf(value);
      if (!key) continue;
      const bucket = index.get(key) || new Set();
      bucket.add(personId);
      index.set(key, bucket);
    }
  }
  const uniqueId = (index, value) => {
    const bucket = index.get(personKeyOf(value));
    return bucket && bucket.size === 1 ? [...bucket][0] : '';
  };

  return rows.map((row) => {
    if (row.nickname.startsWith(PLACEHOLDER_PREFIX)) {
      return { ...row, personId: '', linkState: 'PLACEHOLDER' };
    }
    const nicknameId = uniqueId(byNickname, row.nickname);
    const nameId = uniqueId(byName, row.name);
    let personId = '';
    if (row.nickname && row.name) {
      // 둘 다 적혀 있으면 합의를 요구한다. 한쪽만 맞는 것은 People 에 아직 없는 동명이인일 수 있다.
      personId = nicknameId && nameId && nicknameId === nameId ? nicknameId : '';
    } else {
      personId = nicknameId || nameId;
    }
    return {
      ...row,
      personId,
      linkState: personId ? 'LINKED' : 'PENDING_LINK',
    };
  });
}

/**
 * 행 규칙 검증. 급여 무결성의 핵심이라 오류와 경고를 나눈다.
 * 오류는 반영을 막고, 미입력은 막지 않되 반드시 보고한다 - 아직 안 적은 것과 잘못 적은 것은 다르다.
 */
export function validateStintRows({ rows = [], months = [] } = {}) {
  const errors = [];
  const missing = [];
  const monthOwners = new Map(); // `${personKey}:${month}` -> rowIndex

  for (const row of rows) {
    const label = row.nickname || row.name || `${row.rowIndex}행`;
    const filled = Object.keys(row.monthlyRates);

    if (!row.stintStart) {
      if (filled.length) {
        errors.push(issue(
          'participation_stint_start_required',
          `${label}: 참여율을 적었는데 투입시작월이 없습니다.`,
          { rowIndex: row.rowIndex },
        ));
      }
      continue;
    }
    if (row.stintEnd && row.stintStart > row.stintEnd) {
      errors.push(issue(
        'participation_stint_order',
        `${label}: 투입시작월(${row.stintStart})이 종료월(${row.stintEnd})보다 뒤입니다.`,
        { rowIndex: row.rowIndex },
      ));
      continue;
    }

    const inStint = (month) => month >= row.stintStart && (!row.stintEnd || month <= row.stintEnd);

    for (const month of filled) {
      if (!inStint(month)) {
        errors.push(issue(
          'participation_value_outside_stint',
          `${label}: ${month} 은 투입기간 밖인데 값이 있습니다. 기간을 바꾼 뒤 남은 값입니다.`,
          { rowIndex: row.rowIndex, month },
        ));
        continue;
      }
      // 같은 사람이 두 줄에서 같은 달에 값을 가지면 어느 쪽이 맞는지 알 수 없다.
      const key = `${personKeyOf(row.nickname || row.name)}:${month}`;
      const owner = monthOwners.get(key);
      if (owner !== undefined && owner !== row.rowIndex) {
        errors.push(issue(
          'participation_duplicate_month',
          `${label}: ${month} 이 두 줄에 모두 적혀 있습니다(${owner}행, ${row.rowIndex}행).`,
          { rowIndex: row.rowIndex, month },
        ));
        continue;
      }
      monthOwners.set(key, row.rowIndex);
    }

    for (const month of months) {
      if (!inStint(month)) continue;
      if (Object.prototype.hasOwnProperty.call(row.monthlyRates, month)) continue;
      missing.push({ rowIndex: row.rowIndex, label, month });
    }
  }

  return { errors, missing };
}

/**
 * 반영할 참여행. 행 정체성은 사람 + 투입시작월이다(stint 키).
 * 같은 시트를 두 번 반영해도 같은 문서가 되도록 - 재실행이 안전해야 사람이 마음 놓고 다시 누른다.
 */
export function buildStintEntries({ tenantId = '', projectId = '', project = {}, rows = [] } = {}) {
  return rows
    .filter((row) => row.stintStart && row.linkState !== 'PLACEHOLDER')
    .map((row) => {
      const key = personKeyOf(row.nickname || row.name);
      return {
        id: `pts-${projectId}-${key}-${row.stintStart}`,
        tenantId,
        projectId,
        projectName: text(project?.name),
        source: 'PARTICIPATION_SHEET',
        ...(row.personId ? { personId: row.personId } : {}),
        identity: { nickname: row.nickname, name: row.name },
        memberName: row.name || row.nickname,
        role: row.role,
        stintStart: row.stintStart,
        stintEnd: row.stintEnd || null,
        monthlyRates: { ...row.monthlyRates },
        clientOrg: text(project?.clientOrg),
      };
    });
}

/**
 * 시트 하나를 끝까지 훑어 사람이 볼 보고서를 만든다.
 * 라우트는 시트를 읽어 이 함수에 넘기기만 한다 - 판정은 전부 여기, 순수 함수 안에 있다.
 */
export function analyzeParticipationSheet({ sheet = {}, project = {}, people = [], tenantId = '', projectId = '' } = {}) {
  const parsed = parseParticipationSheet(sheet);
  const formatIssues = validateParticipationFormat(parsed);
  if (formatIssues.length) {
    return { ok: false, blocking: formatIssues, parsed, rows: [], entries: [], missing: [], summary: null };
  }
  const periodIssue = validatePeriodAgainstProject({ period: parsed.period, project });
  if (periodIssue) {
    return { ok: false, blocking: [periodIssue], parsed, rows: [], entries: [], missing: [], summary: null };
  }

  const rows = resolvePeopleIdentity({ rows: parsed.rows, people });
  const { errors, missing } = validateStintRows({ rows, months: parsed.months });
  const blocking = [...parsed.issues, ...errors];
  const entries = buildStintEntries({ tenantId, projectId, project, rows });

  return {
    ok: blocking.length === 0,
    blocking,
    parsed,
    rows,
    entries,
    missing,
    summary: {
      period: parsed.period,
      monthCount: parsed.months.length,
      rowCount: rows.length,
      linkedCount: rows.filter((row) => row.linkState === 'LINKED').length,
      pendingLinkCount: rows.filter((row) => row.linkState === 'PENDING_LINK').length,
      placeholderCount: rows.filter((row) => row.linkState === 'PLACEHOLDER').length,
      missingCount: missing.length,
      errorCount: blocking.length,
    },
  };
}
