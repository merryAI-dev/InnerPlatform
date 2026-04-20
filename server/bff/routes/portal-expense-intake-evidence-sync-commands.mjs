import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalExpenseIntakeEvidenceSyncSchema } from '../schemas.mjs';

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

function patchExpenseSheetEvidenceRowBySourceTxId({ rows, item }) {
  const currentRows = Array.isArray(rows) ? rows.map((row) => ({
    ...row,
    cells: Array.isArray(row?.cells) ? [...row.cells] : SETTLEMENT_HEADERS.map(() => ''),
  })) : [];
  const targetIndex = currentRows.findIndex((row) => readOptionalText(row.sourceTxId) === item.sourceTxId);
  if (targetIndex < 0) {
    return {
      rows: currentRows,
      patchedRow: null,
      rowPatched: false,
    };
  }

  const completedIdx = findColumnIndex('실제 구비 완료된 증빙자료 리스트');
  const nextRows = [...currentRows];
  const nextRow = {
    ...currentRows[targetIndex],
    tempId: readOptionalText(currentRows[targetIndex].tempId) || `bank-${item.bankFingerprint}`,
    sourceTxId: item.sourceTxId,
    entryKind: Number(item.bankSnapshot?.signedAmount) >= 0 ? 'DEPOSIT' : 'EXPENSE',
    cells: [...currentRows[targetIndex].cells],
    userEditedCellIndexes: [
      ...(Array.isArray(currentRows[targetIndex].userEditedCellIndexes) ? currentRows[targetIndex].userEditedCellIndexes : []),
      completedIdx,
    ].filter((index) => index >= 0).sort((a, b) => a - b),
  };

  if (completedIdx >= 0) {
    nextRow.cells[completedIdx] = readOptionalText(item.manualFields?.evidenceCompletedDesc);
  }

  nextRows[targetIndex] = nextRow;

  return {
    rows: nextRows,
    patchedRow: nextRow,
    rowPatched: true,
  };
}

function mergeExpenseIntakeEvidenceSync({
  current,
  projectId,
  intakeId,
  updates,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const mergedManualFields = {
    ...(currentValue.manualFields && typeof currentValue.manualFields === 'object' ? currentValue.manualFields : {}),
  };
  if (typeof updates?.manualFields?.evidenceCompletedDesc === 'string') {
    mergedManualFields.evidenceCompletedDesc = updates.manualFields.evidenceCompletedDesc;
  } else if (typeof mergedManualFields.evidenceCompletedDesc !== 'string') {
    mergedManualFields.evidenceCompletedDesc = '';
  }

  const evidenceStatus = resolveEvidenceStatus(mergedManualFields);
  const matchState = readOptionalText(currentValue.matchState) || 'PENDING_INPUT';

  return stripUndefinedDeep({
    ...currentValue,
    tenantId: currentValue.tenantId,
    id: intakeId,
    projectId,
    manualFields: mergedManualFields,
    matchState,
    projectionStatus: resolveProjectionStatus({
      matchState,
      manualFields: mergedManualFields,
      evidenceStatus,
    }),
    evidenceStatus,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountPortalExpenseIntakeEvidenceSyncCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/expense-intake/evidence-sync', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'sync expense intake evidence');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalExpenseIntakeEvidenceSyncSchema,
      req.body,
      'Invalid portal expense intake evidence sync payload',
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
      const targetSheetId = readOptionalText(currentIntake.existingExpenseSheetId) || 'default';
      const sheetRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_sheets/${targetSheetId}`);
      const sheetSnapshot = await tx.get(sheetRef);
      const currentSheet = sheetSnapshot.exists ? (sheetSnapshot.data() || {}) : {};
      const existingRows = Array.isArray(currentSheet.rows) ? currentSheet.rows : [];

      const intakeForEvidenceSync = {
        ...currentIntake,
        manualFields: {
          ...(currentIntake.manualFields && typeof currentIntake.manualFields === 'object' ? currentIntake.manualFields : {}),
        },
      };
      if (typeof updates.manualFields?.evidenceCompletedDesc === 'string') {
        intakeForEvidenceSync.manualFields.evidenceCompletedDesc = updates.manualFields.evidenceCompletedDesc;
      }

      const patch = patchExpenseSheetEvidenceRowBySourceTxId({
        rows: existingRows,
        item: intakeForEvidenceSync,
      });

      const expenseIntakeItem = mergeExpenseIntakeEvidenceSync({
        current: currentIntake,
        projectId: parsed.projectId,
        intakeId: parsed.intakeId,
        updates,
        actorId,
        timestamp,
      });

      let expenseSheet = currentSheet;
      if (patch.rowPatched) {
        expenseSheet = buildExpenseSheetDocument({
          current: currentSheet,
          projectId: parsed.projectId,
          activeSheetId: targetSheetId,
          activeSheetName: readOptionalText(currentSheet.name) || (targetSheetId === 'default' ? '기본 탭' : '새 탭'),
          order: Number.isInteger(currentSheet.order) ? Number(currentSheet.order) : (targetSheetId === 'default' ? 0 : 1),
          rows: patch.rows,
          actorId,
          timestamp,
        });
        tx.set(sheetRef, expenseSheet, { merge: true });
      }

      tx.set(intakeRef, {
        tenantId,
        ...expenseIntakeItem,
      }, { merge: true });

      return {
        expenseSheet,
        expenseIntakeItem,
        patchedRow: patch.patchedRow || undefined,
        rowPatched: patch.rowPatched,
        targetSheetId,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'expense_intake',
        entityId: parsed.intakeId,
        action: 'EVIDENCE_SYNC',
        actorId,
        actorRole,
        requestId,
        details: `비용 증빙 상태 동기화: ${parsed.projectId}/${parsed.intakeId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          intakeId: parsed.intakeId,
          sheetId: result.targetSheetId,
          rowPatched: result.rowPatched,
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
        ...(result.patchedRow ? { patchedRow: result.patchedRow } : {}),
        summary: {
          targetSheetId: result.targetSheetId,
          patchedRowTempId: result.patchedRow?.tempId || null,
          rowPatched: result.rowPatched,
          version: result.expenseIntakeItem.version,
        },
      },
    };
  }));
}
