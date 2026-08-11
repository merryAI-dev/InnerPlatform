import { randomUUID } from 'node:crypto';

const YEAR_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const ERROR_CODES = new Set(['STATUS_UNAVAILABLE', 'SUMMARY_UNAVAILABLE']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertProjectIds(projectIds) {
  if (!Array.isArray(projectIds) || projectIds.length < 1 || projectIds.length > 100) {
    throw new Error('조회할 프로젝트는 1~100개여야 합니다.');
  }
  const normalized = projectIds.map(text);
  if (normalized.some((projectId) => !projectId || projectId.length > 120 || projectId.includes('/'))
    || new Set(normalized).size !== normalized.length) {
    throw new Error('프로젝트 식별자가 올바르지 않습니다.');
  }
  return normalized;
}

function assertYearMonth(yearMonth) {
  if (!YEAR_MONTH.test(text(yearMonth))) throw new Error('조회 연월은 YYYY-MM 형식이어야 합니다.');
  return yearMonth;
}

function safeBaseUrl(value) {
  let url;
  try {
    url = new URL(text(value));
  } catch {
    throw new Error('MYSCUBE_BFF_BASE_URL 설정이 올바르지 않습니다.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) {
    throw new Error('MYSCUBE_BFF_BASE_URL은 HTTPS 주소여야 합니다.');
  }
  return url;
}

function safeError(response) {
  if (response.status === 401) return 'MYSCube 로그인이 만료됐거나 필요합니다.';
  if (response.status === 403) return '이 정산 현황을 조회할 권한이 없습니다.';
  if (response.status >= 500) return 'MYSCube 현금흐름 조회 서버에 일시적인 문제가 있습니다.';
  return '현금흐름 조회 요청이 올바르지 않습니다.';
}

function assertOverview(result, { projectIds, yearMonth }) {
  const requested = new Set(projectIds);
  const items = Array.isArray(result?.items) ? result.items : null;
  const errors = Array.isArray(result?.errors) ? result.errors : null;
  const itemIds = items?.map((item) => item?.projectId);
  if (typeof result?.version !== 'string'
    || result.yearMonth !== yearMonth
    || !items
    || !errors
    || itemIds.length !== projectIds.length
    || itemIds.some((projectId) => !requested.has(projectId))
    || new Set(itemIds).size !== itemIds.length
    || errors.some((error) => !requested.has(error?.projectId) || !ERROR_CODES.has(error?.code))) {
    throw new Error('MYSCube 현금흐름 응답을 확인할 수 없습니다.');
  }
  return result;
}

export function resolveCashflowMcpConfig(env = process.env) {
  return { baseUrl: safeBaseUrl(env.MYSCUBE_BFF_BASE_URL).toString() };
}

export async function readCashflowStatus({
  baseUrl,
  accessToken,
  projectIds,
  yearMonth,
  fetchImpl = globalThis.fetch,
  requestId = randomUUID(),
  audit = () => {},
}) {
  const safeProjectIds = assertProjectIds(projectIds);
  const safeYearMonth = assertYearMonth(yearMonth);
  if (typeof fetchImpl !== 'function') throw new Error('현금흐름 조회 연결을 사용할 수 없습니다.');

  if (!text(accessToken)) throw new Error('MYSCube 로그인이 필요합니다.');
  const endpoint = new URL('/api/v1/mcp/cashflow/weekly-overview', safeBaseUrl(baseUrl));
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${text(accessToken)}`,
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({ projectIds: safeProjectIds, yearMonth: safeYearMonth }),
    });
  } catch {
    audit({ tool: 'cashflow_status', requestId, yearMonth: safeYearMonth, projectCount: safeProjectIds.length, outcome: 'network_error' });
    throw new Error('MYSCube 현금흐름 조회에 연결하지 못했습니다.');
  }

  if (!response.ok) {
    audit({ tool: 'cashflow_status', requestId, yearMonth: safeYearMonth, projectCount: safeProjectIds.length, outcome: `http_${response.status}` });
    throw new Error(safeError(response));
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('MYSCube 현금흐름 응답을 읽을 수 없습니다.');
  }
  const overview = assertOverview(result, { projectIds: safeProjectIds, yearMonth: safeYearMonth });
  audit({ tool: 'cashflow_status', requestId, yearMonth: safeYearMonth, projectCount: safeProjectIds.length, resultProjectCount: overview.items.length, outcome: 'ok' });
  return overview;
}
