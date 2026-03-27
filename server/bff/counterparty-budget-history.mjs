/**
 * counterparty-budget-history.mjs
 *
 * 거래처별 비목/세목 히스토리 관리.
 * 거래 저장 시 side-effect로 쌓고, 제안 시 먼저 조회한다.
 *
 * Firestore 경로: orgs/{orgId}/counterparty_budget_history/{projectId}_{counterpartyKey}
 * 기존 컬렉션에 영향 없는 additive 전용 컬렉션.
 */

const COLLECTION = 'counterparty_budget_history';

/**
 * 거래처명을 조회 키로 정규화한다.
 * "(주)", "주식회사", 공백, 특수문자 제거 후 소문자.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCounterpartyKey(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/\(주\)|\(유\)|\(재\)|\(사\)/g, '')
    .replace(/주식회사|유한회사|재단법인|사단법인/g, '')
    .replace(/[^\w\uAC00-\uD7A3]/g, '')  // 한글+영숫자만 남김
    .toLowerCase()
    .trim();
}

/**
 * 거래처 히스토리 문서 ID
 *
 * @param {string} projectId
 * @param {string} counterpartyKey
 * @returns {string}
 */
function historyDocId(projectId, counterpartyKey) {
  return `${projectId}_${counterpartyKey}`;
}

/**
 * 거래 저장 후 히스토리를 업데이트한다 (fire-and-forget).
 * budgetCategory 또는 budgetSubCategory가 없으면 스킵.
 *
 * @param {import('@google-cloud/firestore').Firestore} db
 * @param {string} orgId
 * @param {{ projectId: string, counterparty: string, budgetCategory?: string, budgetSubCategory?: string }} tx
 */
export async function updateCounterpartyHistory(db, orgId, tx) {
  const { projectId, counterparty, budgetCategory, budgetSubCategory } = tx;
  if (!projectId || !counterparty || !budgetCategory) return;

  const key = normalizeCounterpartyKey(counterparty);
  if (!key) return;

  const docId = historyDocId(projectId, key);
  const ref = db.doc(`orgs/${orgId}/${COLLECTION}/${docId}`);

  try {
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data();
      // 같은 비목이면 usageCount++, 다른 비목이면 더 많이 쓴 쪽 유지
      const isSameCategory = data.budgetCategory === budgetCategory;
      await ref.update({
        counterpartyName: counterparty,
        budgetCategory: isSameCategory ? data.budgetCategory : budgetCategory,
        budgetSubCategory: isSameCategory
          ? (budgetSubCategory || data.budgetSubCategory || '')
          : budgetSubCategory || '',
        usageCount: (data.usageCount || 0) + 1,
        lastUsed: new Date().toISOString(),
      });
    } else {
      await ref.set({
        projectId,
        counterpartyKey: key,
        counterpartyName: counterparty,
        budgetCategory,
        budgetSubCategory: budgetSubCategory || '',
        usageCount: 1,
        lastUsed: new Date().toISOString(),
      });
    }
  } catch (_err) {
    // 히스토리 업데이트 실패는 메인 흐름에 영향 없음
  }
}

/**
 * 거래처 히스토리에서 비목/세목을 조회한다.
 *
 * @param {import('@google-cloud/firestore').Firestore} db
 * @param {string} orgId
 * @param {string} projectId
 * @param {string} counterparty
 * @returns {Promise<{ budgetCategory: string, budgetSubCategory: string, confidence: 'history' } | null>}
 */
export async function lookupCounterpartyHistory(db, orgId, projectId, counterparty) {
  const key = normalizeCounterpartyKey(counterparty);
  if (!key) return null;

  const docId = historyDocId(projectId, key);
  const ref = db.doc(`orgs/${orgId}/${COLLECTION}/${docId}`);

  try {
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data?.budgetCategory) return null;
    return {
      budgetCategory: data.budgetCategory,
      budgetSubCategory: data.budgetSubCategory || '',
      confidence: 'history',
    };
  } catch (_err) {
    return null;
  }
}
