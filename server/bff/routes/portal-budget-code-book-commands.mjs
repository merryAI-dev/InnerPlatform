import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalBudgetCodeBookSaveSchema } from '../schemas.mjs';

const BUDGET_ENUMERATION_PREFIX_RE = /^\s*\d+(?:(?:[.-]\d+)+|[.)-])\s*/;
const LEADING_BUDGET_PUNCTUATION_RE = /^[.)-]+\s*/;
const BUDGET_CODE_INDEX = 5;
const BUDGET_SUB_CODE_INDEX = 6;

function normalizeBudgetLabel(value) {
  return String(value ?? '')
    .replace(BUDGET_ENUMERATION_PREFIX_RE, '')
    .replace(LEADING_BUDGET_PUNCTUATION_RE, '')
    .trim();
}

function buildBudgetLabelKey(budgetCode, subCode) {
  return `${normalizeBudgetLabel(budgetCode)}|${normalizeBudgetLabel(subCode)}`;
}

function sanitizeBudgetEntry(value) {
  return String(value || '').trim();
}

function normalizeBudgetCodeBook(input) {
  return (input || [])
    .map((row) => ({
      code: sanitizeBudgetEntry(row.code),
      subCodes: (row.subCodes || []).map(sanitizeBudgetEntry).filter(Boolean),
    }))
    .filter((row) => row.code && row.subCodes.length > 0);
}

function validateBudgetCodeBookDraft(entries) {
  const errors = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return { isValid: false, errors: ['비목을 1개 이상 입력해 주세요.'] };
  }
  entries.forEach((entry, index) => {
    const code = normalizeBudgetLabel(entry.code || '');
    const trimmed = String(entry.code || '').trim();
    const label = trimmed || `${index + 1}번째 비목`;
    if (!code) {
      errors.push(`${index + 1}번째 비목명을 입력해 주세요.`);
      return;
    }
    const subCodes = Array.isArray(entry.subCodes) ? entry.subCodes : [];
    if (subCodes.length === 0) {
      errors.push(`${label}에 세목을 1개 이상 추가해 주세요.`);
      return;
    }
    if (subCodes.some((subCode) => !normalizeBudgetLabel(subCode || ''))) {
      errors.push(`${label}의 비어 있는 세목명을 입력해 주세요.`);
    }
  });
  return { isValid: errors.length === 0, errors };
}

function serializeExpenseSheetRowForPersistence(row) {
  return stripUndefinedDeep({
    tempId: row.tempId || `imp-${Date.now()}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => (cell ?? '')) : [],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints && row.reviewHints.length > 0 ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes && row.reviewRequiredCellIndexes.length > 0
      ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes].sort((a, b) => a - b) }
      : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(Array.isArray(row.userEditedCellIndexes) && row.userEditedCellIndexes.length > 0
      ? { userEditedCellIndexes: [...row.userEditedCellIndexes].sort((a, b) => a - b) }
      : {}),
  });
}

function buildRenameMap(renames) {
  const map = new Map();
  (Array.isArray(renames) ? renames : []).forEach((rename) => {
    const fromCode = normalizeBudgetLabel(rename.fromCode);
    const fromSub = normalizeBudgetLabel(rename.fromSub);
    const toCode = normalizeBudgetLabel(rename.toCode);
    const toSub = normalizeBudgetLabel(rename.toSub);
    if (!fromCode || !fromSub || !toCode || !toSub) return;
    map.set(buildBudgetLabelKey(fromCode, fromSub), { code: toCode, sub: toSub });
  });
  return map;
}

function applyBudgetPlanRenames(rows, renameMap) {
  let touched = false;
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const key = buildBudgetLabelKey(row?.budgetCode, row?.subCode);
    const mapped = renameMap.get(key);
    if (!mapped) return row;
    touched = true;
    return { ...row, budgetCode: mapped.code, subCode: mapped.sub };
  });
  return { touched, rows: nextRows };
}

function applyExpenseSheetRenames(rows, renameMap) {
  let touched = false;
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const cells = Array.isArray(row?.cells) ? [...row.cells] : [];
    const key = buildBudgetLabelKey(cells[BUDGET_CODE_INDEX] || '', cells[BUDGET_SUB_CODE_INDEX] || '');
    const mapped = renameMap.get(key);
    if (!mapped) return row;
    cells[BUDGET_CODE_INDEX] = mapped.code;
    cells[BUDGET_SUB_CODE_INDEX] = mapped.sub;
    touched = true;
    return { ...row, cells };
  });
  return { touched, rows: nextRows };
}

function applyEvidenceMapRenames(map, renameMap) {
  let touched = false;
  const nextMap = {};
  Object.entries(map && typeof map === 'object' ? map : {}).forEach(([key, value]) => {
    const [rawCode, rawSub] = String(key || '').split('|');
    if (!rawSub) {
      nextMap[key] = value;
      return;
    }
    const mapKey = buildBudgetLabelKey(rawCode, rawSub);
    const mapped = renameMap.get(mapKey);
    if (!mapped) {
      nextMap[key] = value;
      return;
    }
    const nextKey = `${mapped.code}|${mapped.sub}`;
    if (!nextMap[nextKey]) nextMap[nextKey] = value;
    touched = true;
  });
  return { touched, map: nextMap };
}

export function mountPortalBudgetCodeBookCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/budget/code-book/save', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save portal budget code book');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalBudgetCodeBookSaveSchema,
      req.body,
      'Invalid portal budget code book payload',
    );
    const validation = validateBudgetCodeBookDraft(parsed.rows);
    if (!validation.isValid) {
      throw createHttpError(400, validation.errors[0] || '비목/세목 구조를 확인해 주세요.', 'invalid_budget_code_book');
    }
    const sanitized = normalizeBudgetCodeBook(parsed.rows);
    const activeSheetId = String(parsed.activeSheetId || '').trim() || 'default';
    const renameMap = buildRenameMap(parsed.renames || []);

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const codeBookRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/budget_code_book/default`);
      const budgetPlanRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/budget_summary/default`);
      const expenseSheetRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_sheets/${activeSheetId}`);
      const evidenceMapRef = db.doc(`orgs/${tenantId}/budgetEvidenceMaps/${parsed.projectId}`);

      const [budgetPlanSnapshot, expenseSheetSnapshot, evidenceMapSnapshot] = await Promise.all([
        tx.get(budgetPlanRef),
        tx.get(expenseSheetRef),
        tx.get(evidenceMapRef),
      ]);

      const codeBookDocument = {
        tenantId,
        projectId: parsed.projectId,
        codes: sanitized,
        updatedAt: timestamp,
        updatedBy: actorId,
      };
      tx.set(codeBookRef, codeBookDocument, { merge: true });

      let budgetPlanRows = null;
      let expenseSheet = null;
      let evidenceRequiredMap = null;

      if (renameMap.size > 0 && budgetPlanSnapshot.exists) {
        const currentBudgetPlan = budgetPlanSnapshot.data() || {};
        const budgetPlanResult = applyBudgetPlanRenames(currentBudgetPlan.rows, renameMap);
        if (budgetPlanResult.touched) {
          const nextBudgetPlanDoc = {
            tenantId,
            projectId: parsed.projectId,
            rows: budgetPlanResult.rows.map((row) => ({
              budgetCode: row.budgetCode || '',
              subCode: row.subCode || '',
              initialBudget: Number.isFinite(row.initialBudget) ? row.initialBudget : 0,
              revisedBudget: Number.isFinite(row.revisedBudget ?? NaN) ? row.revisedBudget : 0,
              ...(row.note ? { note: row.note } : {}),
            })),
            updatedAt: timestamp,
            updatedBy: actorId,
          };
          tx.set(budgetPlanRef, nextBudgetPlanDoc, { merge: true });
          budgetPlanRows = nextBudgetPlanDoc.rows;
        }
      }

      if (renameMap.size > 0 && expenseSheetSnapshot.exists) {
        const currentExpenseSheet = expenseSheetSnapshot.data() || {};
        const expenseSheetResult = applyExpenseSheetRenames(currentExpenseSheet.rows, renameMap);
        if (expenseSheetResult.touched) {
          const nextExpenseSheetDoc = {
            tenantId,
            projectId: parsed.projectId,
            rows: expenseSheetResult.rows.map(serializeExpenseSheetRowForPersistence),
            updatedAt: timestamp,
            updatedBy: actorId,
          };
          tx.set(expenseSheetRef, nextExpenseSheetDoc, { merge: true });
          expenseSheet = {
            ...(currentExpenseSheet || {}),
            ...nextExpenseSheetDoc,
          };
        }
      }

      if (renameMap.size > 0 && evidenceMapSnapshot.exists) {
        const currentEvidenceMap = evidenceMapSnapshot.data() || {};
        const evidenceMapResult = applyEvidenceMapRenames(currentEvidenceMap.map, renameMap);
        if (evidenceMapResult.touched) {
          const nextEvidenceMapDoc = {
            tenantId,
            projectId: parsed.projectId,
            map: evidenceMapResult.map,
            updatedAt: timestamp,
            updatedBy: actorId,
          };
          tx.set(evidenceMapRef, nextEvidenceMapDoc, { merge: true });
          evidenceRequiredMap = nextEvidenceMapDoc.map;
        }
      }

      return {
        codeBook: sanitized,
        budgetPlanRows,
        expenseSheet,
        evidenceRequiredMap,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_budget_code_book_save',
        entityId: `${parsed.projectId}:default`,
        action: 'SAVE',
        actorId,
        actorRole,
        requestId,
        details: `비목/세목 저장: ${parsed.projectId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          activeSheetId,
          rowCount: sanitized.length,
          renameCount: renameMap.size,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        codeBook: result.codeBook,
        budgetPlanRows: result.budgetPlanRows,
        expenseSheet: result.expenseSheet,
        evidenceRequiredMap: result.evidenceRequiredMap,
      },
    };
  }));
}
