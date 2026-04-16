import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalExpenseIntakeProjectSchema } from '../schemas.mjs';

const SETTLEMENT_HEADERS = [
  '작성자',
  'No.',
  '거래일시',
  '해당 주차',
  '지출구분',
  '비목',
  '세목',
  '세세목',
  'cashflow항목',
  '통장잔액',
  '통장에 찍힌 입/출금액',
  '입금액(사업비,공급가액,은행이자)',
  '매입부가세 반환',
  '사업비 사용액',
  '매입부가세',
  '지급처',
  '상세 적요',
  '필수증빙자료 리스트',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
  'e나라 등록',
  'e나라 집행',
  '부가세 지결 완료여부',
  '최종완료',
  '비고',
];

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeManualFields(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const next = {};
  if (Number.isFinite(candidate.expenseAmount)) next.expenseAmount = Number(candidate.expenseAmount);
  if (normalizeString(candidate.budgetCategory)) next.budgetCategory = normalizeString(candidate.budgetCategory);
  if (normalizeString(candidate.budgetSubCategory)) next.budgetSubCategory = normalizeString(candidate.budgetSubCategory);
  if (
    candidate.cashflowLineId === 'MYSC_PREPAY_IN'
    || candidate.cashflowLineId === 'SALES_IN'
    || candidate.cashflowLineId === 'SALES_VAT_IN'
    || candidate.cashflowLineId === 'TEAM_SUPPORT_IN'
    || candidate.cashflowLineId === 'BANK_INTEREST_IN'
    || candidate.cashflowLineId === 'DIRECT_COST_OUT'
    || candidate.cashflowLineId === 'INPUT_VAT_OUT'
    || candidate.cashflowLineId === 'MYSC_LABOR_OUT'
    || candidate.cashflowLineId === 'MYSC_PROFIT_OUT'
    || candidate.cashflowLineId === 'SALES_VAT_OUT'
    || candidate.cashflowLineId === 'TEAM_SUPPORT_OUT'
    || candidate.cashflowLineId === 'BANK_INTEREST_OUT'
  ) {
    next.cashflowLineId = candidate.cashflowLineId;
  }
  if (
    candidate.cashflowCategory === 'CONTRACT_PAYMENT'
    || candidate.cashflowCategory === 'INTERIM_PAYMENT'
    || candidate.cashflowCategory === 'FINAL_PAYMENT'
    || candidate.cashflowCategory === 'LABOR_COST'
    || candidate.cashflowCategory === 'OUTSOURCING'
    || candidate.cashflowCategory === 'EQUIPMENT'
    || candidate.cashflowCategory === 'TRAVEL'
    || candidate.cashflowCategory === 'SUPPLIES'
    || candidate.cashflowCategory === 'COMMUNICATION'
    || candidate.cashflowCategory === 'RENT'
    || candidate.cashflowCategory === 'UTILITY'
    || candidate.cashflowCategory === 'TAX_PAYMENT'
    || candidate.cashflowCategory === 'VAT_REFUND'
    || candidate.cashflowCategory === 'INSURANCE'
    || candidate.cashflowCategory === 'MISC_INCOME'
    || candidate.cashflowCategory === 'MISC_EXPENSE'
  ) {
    next.cashflowCategory = candidate.cashflowCategory;
  }
  if (normalizeString(candidate.memo)) next.memo = normalizeString(candidate.memo);
  if (typeof candidate.evidenceCompletedDesc === 'string') next.evidenceCompletedDesc = candidate.evidenceCompletedDesc;
  return next;
}

function isManualFieldsComplete(fields) {
  if (!fields) return false;
  return Number.isFinite(fields.expenseAmount)
    && Boolean(normalizeString(fields.budgetCategory || ''))
    && Boolean(normalizeString(fields.budgetSubCategory || ''))
    && Boolean(fields.cashflowLineId || fields.cashflowCategory);
}

function resolveEvidenceStatus(manualFields) {
  return normalizeString(manualFields?.evidenceCompletedDesc || '') ? 'PARTIAL' : 'MISSING';
}

function resolveProjectionStatus({ matchState, manualFields, evidenceStatus }) {
  if (matchState === 'REVIEW_REQUIRED' || matchState === 'IGNORED') return 'NOT_PROJECTED';
  if (!isManualFieldsComplete(manualFields)) return 'NOT_PROJECTED';
  return evidenceStatus === 'COMPLETE' ? 'PROJECTED' : 'PROJECTED_WITH_PENDING_EVIDENCE';
}

function findColumnIndex(header) {
  return SETTLEMENT_HEADERS.findIndex((column) => column === header);
}

function createEmptyImportRow() {
  return {
    tempId: '',
    cells: SETTLEMENT_HEADERS.map(() => ''),
  };
}

function serializeExpenseSheetRowForPersistence(row) {
  return stripUndefinedDeep({
    tempId: row.tempId || `imp-${Date.now()}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => String(cell ?? '')) : [],
    ...(row.reviewHints && row.reviewHints.length > 0 ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes && row.reviewRequiredCellIndexes.length > 0
      ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes].sort((a, b) => a - b) }
      : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCellIndexes && row.userEditedCellIndexes.length > 0
      ? { userEditedCellIndexes: [...row.userEditedCellIndexes].sort((a, b) => a - b) }
      : {}),
  });
}

function buildExpenseSheetDocument({
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
  return stripUndefinedDeep({
    ...currentValue,
    id: activeSheetId,
    projectId,
    name: normalizeString(activeSheetName) || (activeSheetId === 'default' ? '기본 탭' : '새 탭'),
    order,
    rows: rows.map(serializeExpenseSheetRowForPersistence),
    rowCount: rows.length,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function buildProjectionRowFromIntake(item, existingRow) {
  const base = existingRow ? {
    ...existingRow,
    cells: Array.isArray(existingRow.cells)
      ? SETTLEMENT_HEADERS.map((_, index) => String(existingRow.cells[index] ?? ''))
      : SETTLEMENT_HEADERS.map(() => ''),
  } : createEmptyImportRow();
  const cells = [...base.cells];
  const dateIdx = findColumnIndex('거래일시');
  const weekIdx = findColumnIndex('해당 주차');
  const budgetIdx = findColumnIndex('비목');
  const subBudgetIdx = findColumnIndex('세목');
  const cashflowIdx = findColumnIndex('cashflow항목');
  const balanceIdx = findColumnIndex('통장잔액');
  const bankAmountIdx = findColumnIndex('통장에 찍힌 입/출금액');
  const depositIdx = findColumnIndex('입금액(사업비,공급가액,은행이자)');
  const expenseIdx = findColumnIndex('사업비 사용액');
  const counterpartyIdx = findColumnIndex('지급처');
  const memoIdx = findColumnIndex('상세 적요');
  const completedIdx = findColumnIndex('실제 구비 완료된 증빙자료 리스트');
  const pendingIdx = findColumnIndex('준비필요자료');
  const requiredIdx = findColumnIndex('필수증빙자료 리스트');

  const dateOnly = String(item.bankSnapshot?.dateTime || '').slice(0, 10);
  if (dateIdx >= 0) cells[dateIdx] = dateOnly;
  if (weekIdx >= 0) cells[weekIdx] = '';
  if (budgetIdx >= 0) cells[budgetIdx] = item.manualFields?.budgetCategory || '';
  if (subBudgetIdx >= 0) cells[subBudgetIdx] = item.manualFields?.budgetSubCategory || '';
  if (cashflowIdx >= 0) {
    cells[cashflowIdx] = item.manualFields?.cashflowLineId || item.manualFields?.cashflowCategory || '';
  }
  if (balanceIdx >= 0) {
    cells[balanceIdx] = Number.isFinite(item.bankSnapshot?.balanceAfter)
      ? Number(item.bankSnapshot.balanceAfter).toLocaleString('ko-KR')
      : '';
  }
  if (bankAmountIdx >= 0) {
    cells[bankAmountIdx] = Number.isFinite(item.bankSnapshot?.signedAmount)
      ? Math.abs(Number(item.bankSnapshot.signedAmount)).toLocaleString('ko-KR')
      : '';
  }
  if (depositIdx >= 0) {
    cells[depositIdx] = Number(item.bankSnapshot?.signedAmount) > 0
      ? Math.abs(Number(item.bankSnapshot.signedAmount)).toLocaleString('ko-KR')
      : '';
  }
  if (expenseIdx >= 0) {
    cells[expenseIdx] = Number.isFinite(item.manualFields?.expenseAmount)
      ? Number(item.manualFields.expenseAmount).toLocaleString('ko-KR')
      : '';
  }
  if (counterpartyIdx >= 0) cells[counterpartyIdx] = item.bankSnapshot?.counterparty || '';
  if (memoIdx >= 0) cells[memoIdx] = item.manualFields?.memo || item.bankSnapshot?.memo || '';
  if (requiredIdx >= 0) cells[requiredIdx] = '';
  if (completedIdx >= 0) cells[completedIdx] = item.manualFields?.evidenceCompletedDesc || '';
  if (pendingIdx >= 0) cells[pendingIdx] = '';

  const projectedRow = {
    ...base,
    tempId: existingRow?.tempId || `bank-${item.bankFingerprint}`,
    sourceTxId: item.sourceTxId,
    entryKind: Number(item.bankSnapshot?.signedAmount) >= 0 ? 'DEPOSIT' : 'EXPENSE',
    cells,
    userEditedCellIndexes: [
      budgetIdx,
      subBudgetIdx,
      cashflowIdx,
      expenseIdx,
      memoIdx,
      completedIdx,
    ].filter((index) => index >= 0).sort((a, b) => a - b),
    reviewHints: [],
    reviewRequiredCellIndexes: [],
    reviewStatus: undefined,
    reviewFingerprint: undefined,
    reviewConfirmedAt: undefined,
  };
  return projectedRow;
}

function upsertExpenseSheetProjectionRowBySourceTxId({
  rows,
  item,
}) {
  const currentRows = Array.isArray(rows) ? [...rows] : [];
  const targetIndex = currentRows.findIndex((row) => readOptionalText(row.sourceTxId) === item.sourceTxId);
  const existingRow = targetIndex >= 0 ? currentRows[targetIndex] : null;
  const projectedRow = buildProjectionRowFromIntake(item, existingRow);
  const nextRows = [...currentRows];
  if (targetIndex >= 0) {
    nextRows[targetIndex] = projectedRow;
  } else {
    nextRows.push(projectedRow);
  }
  const noIdx = findColumnIndex('No.');
  if (noIdx >= 0) {
    nextRows.forEach((row, index) => {
      row.cells[noIdx] = String(index + 1);
    });
  }
  return {
    rows: nextRows,
    projectedRow,
  };
}

function mergeExpenseIntakeItem({
  current,
  projectId,
  intakeId,
  updates,
  projectedRowTempId,
  targetSheetId,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const mergedManualFields = normalizeManualFields({
    ...(currentValue.manualFields && typeof currentValue.manualFields === 'object' ? currentValue.manualFields : {}),
    ...(updates.manualFields || {}),
  });
  const evidenceStatus = resolveEvidenceStatus(mergedManualFields);
  const matchState = 'AUTO_CONFIRMED';
  const reviewReasons = Array.isArray(updates.reviewReasons)
    ? updates.reviewReasons.map((reason) => readOptionalText(reason)).filter(Boolean)
    : Array.isArray(currentValue.reviewReasons)
      ? currentValue.reviewReasons.map((reason) => readOptionalText(reason)).filter(Boolean)
      : [];

  return stripUndefinedDeep({
    ...currentValue,
    tenantId: currentValue.tenantId,
    id: intakeId,
    projectId,
    manualFields: mergedManualFields,
    existingExpenseSheetId: targetSheetId,
    existingExpenseRowTempId: projectedRowTempId,
    matchState,
    projectionStatus: resolveProjectionStatus({
      matchState,
      manualFields: mergedManualFields,
      evidenceStatus,
    }),
    evidenceStatus,
    reviewReasons,
    lastUploadBatchId: readOptionalText(updates.lastUploadBatchId) || readOptionalText(currentValue.lastUploadBatchId),
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountPortalExpenseIntakeProjectCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/expense-intake/project', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'project expense intake item');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalExpenseIntakeProjectSchema,
      req.body,
      'Invalid portal expense intake project payload',
    );
    const updates = parsed.updates || {};

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const intakeRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_intake/${parsed.intakeId}`);
      const intakeSnapshot = await tx.get(intakeRef);
      if (!intakeSnapshot.exists) {
        throw createHttpError(404, `Expense intake not found: ${parsed.projectId}/${parsed.intakeId}`, 'expense_intake_not_found');
      }

      const currentIntake = intakeSnapshot.data() || {};
      const mergedManualFields = normalizeManualFields({
        ...(currentIntake.manualFields && typeof currentIntake.manualFields === 'object' ? currentIntake.manualFields : {}),
        ...(updates.manualFields || {}),
      });
      if (!isManualFieldsComplete(mergedManualFields)) {
        throw createHttpError(400, 'Manual fields are incomplete for projection', 'manual_fields_incomplete');
      }

      const targetSheetId = readOptionalText(updates.existingExpenseSheetId)
        || readOptionalText(currentIntake.existingExpenseSheetId)
        || 'default';
      const sheetRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_sheets/${targetSheetId}`);
      const sheetSnapshot = await tx.get(sheetRef);
      const currentSheet = sheetSnapshot.exists ? (sheetSnapshot.data() || {}) : {};
      const existingRows = Array.isArray(currentSheet.rows) ? currentSheet.rows : [];

      const intakeForProjection = {
        ...currentIntake,
        manualFields: mergedManualFields,
        existingExpenseSheetId: targetSheetId,
        evidenceStatus: resolveEvidenceStatus(mergedManualFields),
      };

      const projection = upsertExpenseSheetProjectionRowBySourceTxId({
        rows: existingRows,
        item: intakeForProjection,
      });

      const expenseIntakeItem = mergeExpenseIntakeItem({
        current: currentIntake,
        projectId: parsed.projectId,
        intakeId: parsed.intakeId,
        updates,
        projectedRowTempId: projection.projectedRow.tempId,
        targetSheetId,
        actorId,
        timestamp,
      });

      const sheetDocument = buildExpenseSheetDocument({
        current: currentSheet,
        projectId: parsed.projectId,
        activeSheetId: targetSheetId,
        activeSheetName: targetSheetId === 'default' ? '기본 탭' : '새 탭',
        order: Number.isInteger(currentSheet.order) ? Number(currentSheet.order) : (targetSheetId === 'default' ? 0 : 1),
        rows: projection.rows,
        actorId,
        timestamp,
      });

      tx.set(sheetRef, sheetDocument, { merge: true });
      tx.set(intakeRef, {
        tenantId,
        ...expenseIntakeItem,
      }, { merge: true });

      return {
        expenseSheet: sheetDocument,
        projectedRow: projection.projectedRow,
        expenseIntakeItem,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'expense_intake',
        entityId: parsed.intakeId,
        action: 'PROJECT',
        actorId,
        actorRole,
        requestId,
        details: `비용 증빙 1건 프로젝트 반영: ${parsed.projectId}/${parsed.intakeId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          intakeId: parsed.intakeId,
          sheetId: result.expenseSheet.id,
          projectedRowTempId: result.projectedRow.tempId,
          version: result.expenseIntakeItem.version,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        expenseIntakeItem: result.expenseIntakeItem,
        expenseSheet: result.expenseSheet,
        projectedRow: result.projectedRow,
        summary: {
          projectId: parsed.projectId,
          intakeId: parsed.intakeId,
          targetSheetId: result.expenseSheet.id,
          projectedRowTempId: result.projectedRow.tempId,
          version: result.expenseIntakeItem.version,
        },
      },
    };
  }));
}
