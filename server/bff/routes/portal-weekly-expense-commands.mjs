import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalWeeklyExpenseSaveSchema } from '../schemas.mjs';

function normalizeExpenseSheetRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const value = row && typeof row === 'object' ? row : {};
    return stripUndefinedDeep({
      tempId: readOptionalText(value.tempId),
      sourceTxId: readOptionalText(value.sourceTxId) || undefined,
      entryKind: readOptionalText(value.entryKind) || undefined,
      cells: Array.isArray(value.cells) ? value.cells.map((cell) => String(cell ?? '')) : [],
      error: readOptionalText(value.error) || undefined,
      reviewHints: Array.isArray(value.reviewHints) ? value.reviewHints.map((hint) => String(hint ?? '')) : undefined,
      reviewRequiredCellIndexes: Array.isArray(value.reviewRequiredCellIndexes)
        ? value.reviewRequiredCellIndexes
          .map((index) => Number(index))
          .filter((index) => Number.isInteger(index) && index >= 0)
        : undefined,
      reviewStatus: readOptionalText(value.reviewStatus) || undefined,
      reviewFingerprint: readOptionalText(value.reviewFingerprint) || undefined,
      reviewConfirmedAt: readOptionalText(value.reviewConfirmedAt) || undefined,
      userEditedCells: Array.isArray(value.userEditedCells)
        ? value.userEditedCells
          .map((index) => Number(index))
          .filter((index) => Number.isInteger(index) && index >= 0)
        : undefined,
    });
  });
}

function normalizeActualAmounts(amounts) {
  return Object.fromEntries(
    Object.entries(amounts && typeof amounts === 'object' ? amounts : {})
      .map(([key, value]) => [String(key || '').trim(), Number(value)])
      .filter(([key, value]) => key && Number.isFinite(value)),
  );
}

function resolveExpenseSyncState(reviewPendingCount) {
  return Number(reviewPendingCount) > 0 ? 'review_required' : 'synced';
}

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function buildSheetDocument({
  current,
  projectId,
  activeSheetId,
  activeSheetName,
  order,
  rows,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const version = readCurrentVersion(currentValue) + 1;
  return stripUndefinedDeep({
    ...currentValue,
    id: activeSheetId,
    projectId,
    name: activeSheetName,
    order,
    rows,
    rowCount: rows.length,
    version,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    updatedAt: timestamp,
    updatedBy: actorId,
  });
}

function buildWeeklySubmissionStatusDocument({
  current,
  projectId,
  yearMonth,
  weekNo,
  reviewPendingCount,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const safeReviewPendingCount = Math.max(0, Number(reviewPendingCount) || 0);
  const expenseSyncState = resolveExpenseSyncState(safeReviewPendingCount);
  return stripUndefinedDeep({
    ...currentValue,
    id: `${projectId}-${yearMonth}-w${weekNo}`,
    projectId,
    yearMonth,
    weekNo,
    expenseEdited: true,
    expenseUpdated: true,
    expenseEditedAt: timestamp,
    expenseUpdatedAt: timestamp,
    expenseSyncState,
    expenseReviewPendingCount: safeReviewPendingCount,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function buildCashflowWeekDocument({
  current,
  projectId,
  yearMonth,
  weekNo,
  amounts,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    id: `${projectId}-${yearMonth}-w${weekNo}`,
    projectId,
    yearMonth,
    weekNo,
    actual: amounts,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function buildSyncSummary(syncPlan) {
  const steps = Array.isArray(syncPlan) ? syncPlan : [];
  const expenseReviewPendingCount = steps.reduce(
    (sum, step) => sum + Math.max(0, Number(step?.reviewPendingCount) || 0),
    0,
  );
  const reviewRequiredWeekCount = steps.filter((step) => Number(step?.reviewPendingCount) > 0).length;
  const syncedWeekCount = steps.length - reviewRequiredWeekCount;

  return {
    expenseSyncState: reviewRequiredWeekCount > 0 ? 'review_required' : 'synced',
    expenseReviewPendingCount,
    syncedWeekCount,
    reviewRequiredWeekCount,
  };
}

export function mountPortalWeeklyExpenseCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/weekly-expenses/save', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save portal weekly expenses');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(portalWeeklyExpenseSaveSchema, req.body, 'Invalid portal weekly expense save payload');
    const projectPath = `orgs/${tenantId}/projects/${parsed.projectId}`;
    const projectSnapshot = await db.doc(projectPath).get();

    if (!projectSnapshot.exists) {
      throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
    }

    const normalizedRows = normalizeExpenseSheetRows(parsed.rows);
    const normalizedSyncPlan = parsed.syncPlan.map((entry) => ({
      yearMonth: entry.yearMonth,
      weekNo: entry.weekNo,
      amounts: normalizeActualAmounts(entry.amounts),
      reviewPendingCount: Math.max(0, Number(entry.reviewPendingCount) || 0),
    }));

    const result = await db.runTransaction(async (tx) => {
      const sheetPath = `orgs/${tenantId}/projects/${parsed.projectId}/expense_sheets/${parsed.activeSheetId}`;
      const sheetRef = db.doc(sheetPath);
      const sheetSnapshot = await tx.get(sheetRef);
      const currentSheet = sheetSnapshot.exists ? (sheetSnapshot.data() || {}) : null;
      const currentVersion = readCurrentVersion(currentSheet);

      if (!sheetSnapshot.exists) {
        if (parsed.expectedVersion !== 0) {
          throw createHttpError(409, `Version mismatch: expected ${parsed.expectedVersion}, actual 0`, 'version_conflict');
        }
      } else if (parsed.expectedVersion !== currentVersion) {
        throw createHttpError(409, `Version mismatch: expected ${parsed.expectedVersion}, actual ${currentVersion}`, 'version_conflict');
      }

      const sheetDocument = buildSheetDocument({
        current: currentSheet,
        projectId: parsed.projectId,
        activeSheetId: parsed.activeSheetId,
        activeSheetName: parsed.activeSheetName,
        order: parsed.order,
        rows: normalizedRows,
        actorId,
        timestamp,
      });
      tx.set(sheetRef, sheetDocument, { merge: true });

      const weeklySubmissionStatuses = [];
      const cashflowWeeks = [];

      for (const step of normalizedSyncPlan) {
        const docId = `${parsed.projectId}-${step.yearMonth}-w${step.weekNo}`;
        const statusRef = db.doc(`orgs/${tenantId}/weeklySubmissionStatus/${docId}`);
        const cashflowWeekRef = db.doc(`orgs/${tenantId}/cashflowWeeks/${docId}`);
        const [statusSnapshot, cashflowWeekSnapshot] = await Promise.all([
          tx.get(statusRef),
          tx.get(cashflowWeekRef),
        ]);

        const statusDocument = buildWeeklySubmissionStatusDocument({
          current: statusSnapshot.exists ? (statusSnapshot.data() || {}) : null,
          projectId: parsed.projectId,
          yearMonth: step.yearMonth,
          weekNo: step.weekNo,
          reviewPendingCount: step.reviewPendingCount,
          actorId,
          timestamp,
        });
        const cashflowWeekDocument = buildCashflowWeekDocument({
          current: cashflowWeekSnapshot.exists ? (cashflowWeekSnapshot.data() || {}) : null,
          projectId: parsed.projectId,
          yearMonth: step.yearMonth,
          weekNo: step.weekNo,
          amounts: step.amounts,
          actorId,
          timestamp,
        });

        tx.set(statusRef, statusDocument, { merge: true });
        tx.set(cashflowWeekRef, cashflowWeekDocument, { merge: true });
        weeklySubmissionStatuses.push(statusDocument);
        cashflowWeeks.push(cashflowWeekDocument);
      }

      return {
        sheet: sheetDocument,
        weeklySubmissionStatuses,
        cashflowWeeks,
      };
    });

    const syncSummary = buildSyncSummary(normalizedSyncPlan);

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_weekly_expense_save',
        entityId: `${parsed.projectId}:${parsed.activeSheetId}`,
        action: 'UPSERT',
        actorId,
        actorRole,
        requestId,
        details: `주간 사업비 저장: ${parsed.activeSheetName}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          activeSheetId: parsed.activeSheetId,
          rowCount: normalizedRows.length,
          syncWeekCount: normalizedSyncPlan.length,
          expenseSyncState: syncSummary.expenseSyncState,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        sheet: result.sheet,
        weeklySubmissionStatuses: result.weeklySubmissionStatuses,
        cashflowWeeks: result.cashflowWeeks,
        syncSummary,
      },
    };
  }));
}
