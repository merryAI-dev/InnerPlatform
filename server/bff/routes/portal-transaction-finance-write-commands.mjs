import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { portalTransactionFinanceWriteSchema } from '../schemas.mjs';

const REQUIRED_CREATE_FIELDS = [
  'counterparty',
  'dateTime',
  'weekCode',
  'direction',
  'method',
  'cashflowCategory',
  'cashflowLabel',
  'memo',
  'amounts',
  'evidenceRequired',
  'evidenceStatus',
  'evidenceMissing',
  'attachmentsCount',
];

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 1;
}

function parseFinanceWritePayload(body) {
  const parsed = portalTransactionFinanceWriteSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'body';
    return `${path}: ${issue.message}`;
  }).join('; ');
  throw createHttpError(
    400,
    message || 'Invalid portal transaction finance-write payload',
    'invalid_portal_transaction_finance_write_payload',
  );
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

function normalizePatch(patch) {
  return stripUndefinedDeep({
    counterparty: readOptionalText(patch.counterparty) || undefined,
    dateTime: readOptionalText(patch.dateTime) || undefined,
    weekCode: readOptionalText(patch.weekCode) || undefined,
    direction: patch.direction,
    entryKind: patch.entryKind,
    method: patch.method,
    cashflowCategory: patch.cashflowCategory,
    cashflowLabel: readOptionalText(patch.cashflowLabel) || undefined,
    budgetCategory: readOptionalText(patch.budgetCategory) || undefined,
    budgetSubCategory: readOptionalText(patch.budgetSubCategory) || undefined,
    budgetSubSubCategory: readOptionalText(patch.budgetSubSubCategory) || undefined,
    memo: typeof patch.memo === 'string' ? patch.memo : undefined,
    amounts: patch.amounts ? {
      bankAmount: Number(patch.amounts.bankAmount),
      depositAmount: Number(patch.amounts.depositAmount),
      expenseAmount: Number(patch.amounts.expenseAmount),
      vatIn: Number(patch.amounts.vatIn),
      vatOut: Number(patch.amounts.vatOut),
      vatRefund: Number(patch.amounts.vatRefund),
      balanceAfter: Number(patch.amounts.balanceAfter),
    } : undefined,
    evidenceRequired: normalizeStringArray(patch.evidenceRequired),
    evidenceStatus: patch.evidenceStatus,
    evidenceMissing: normalizeStringArray(patch.evidenceMissing),
    attachmentsCount: Number.isInteger(patch.attachmentsCount) ? patch.attachmentsCount : undefined,
    evidenceRequiredDesc: typeof patch.evidenceRequiredDesc === 'string' ? patch.evidenceRequiredDesc : undefined,
    evidenceCompletedDesc: typeof patch.evidenceCompletedDesc === 'string' ? patch.evidenceCompletedDesc : undefined,
    evidenceCompletedManualDesc: typeof patch.evidenceCompletedManualDesc === 'string' ? patch.evidenceCompletedManualDesc : undefined,
    evidencePendingDesc: typeof patch.evidencePendingDesc === 'string' ? patch.evidencePendingDesc : undefined,
    evidenceDriveLink: readOptionalText(patch.evidenceDriveLink) || undefined,
    evidenceDriveSharedDriveId: readOptionalText(patch.evidenceDriveSharedDriveId) || undefined,
    evidenceDriveFolderId: readOptionalText(patch.evidenceDriveFolderId) || undefined,
    evidenceDriveFolderName: readOptionalText(patch.evidenceDriveFolderName) || undefined,
    evidenceDriveSyncStatus: patch.evidenceDriveSyncStatus,
    evidenceDriveLastSyncedAt: readOptionalText(patch.evidenceDriveLastSyncedAt) || undefined,
    evidenceAutoListedDesc: typeof patch.evidenceAutoListedDesc === 'string' ? patch.evidenceAutoListedDesc : undefined,
    supportPendingDocs: typeof patch.supportPendingDocs === 'string' ? patch.supportPendingDocs : undefined,
    eNaraRegistered: typeof patch.eNaraRegistered === 'string' ? patch.eNaraRegistered : undefined,
    eNaraExecuted: typeof patch.eNaraExecuted === 'string' ? patch.eNaraExecuted : undefined,
    vatSettlementDone: typeof patch.vatSettlementDone === 'boolean' ? patch.vatSettlementDone : undefined,
    settlementComplete: typeof patch.settlementComplete === 'boolean' ? patch.settlementComplete : undefined,
    settlementNote: typeof patch.settlementNote === 'string' ? patch.settlementNote : undefined,
    author: typeof patch.author === 'string' ? patch.author : undefined,
  });
}

function resolveMissingCreateFields(patch) {
  return REQUIRED_CREATE_FIELDS.filter((field) => !(field in patch));
}

function buildCreatedTransaction({ command, patch, tenantId, actorId, timestamp }) {
  return stripUndefinedDeep({
    id: command.id,
    tenantId,
    projectId: command.projectId,
    ledgerId: command.ledgerId,
    state: 'DRAFT',
    ...patch,
    version: 1,
    createdBy: actorId,
    createdAt: timestamp,
    updatedBy: actorId,
    updatedAt: timestamp,
  });
}

function buildUpdatedTransaction({ current, command, patch, tenantId, actorId, timestamp }) {
  const {
    submittedBy: _submittedBy,
    submittedAt: _submittedAt,
    approvedBy: _approvedBy,
    approvedAt: _approvedAt,
    rejectedReason: _rejectedReason,
    state: _currentState,
    tenantId: _tenantId,
    version: _version,
    updatedBy: _updatedBy,
    updatedAt: _updatedAt,
    ...restCurrent
  } = current || {};

  return stripUndefinedDeep({
    ...restCurrent,
    ...patch,
    id: command.id,
    tenantId,
    projectId: command.projectId,
    ledgerId: command.ledgerId,
    state: 'DRAFT',
    version: readCurrentVersion(current) + 1,
    createdBy: readOptionalText(current?.createdBy) || actorId,
    createdAt: readOptionalText(current?.createdAt) || timestamp,
    updatedBy: actorId,
    updatedAt: timestamp,
  });
}

export function mountPortalTransactionFinanceWriteCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/transactions/finance-write', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write portal transaction finance fields');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const command = parseFinanceWritePayload(req.body);
    const normalizedPatch = normalizePatch(command.patch);

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${command.projectId}`);
      const ledgerRef = db.doc(`orgs/${tenantId}/ledgers/${command.ledgerId}`);
      const transactionRef = db.doc(`orgs/${tenantId}/transactions/${command.id}`);

      const [projectSnapshot, ledgerSnapshot, transactionSnapshot] = await Promise.all([
        tx.get(projectRef),
        tx.get(ledgerRef),
        tx.get(transactionRef),
      ]);

      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${command.projectId}`, 'project_not_found');
      }
      if (!ledgerSnapshot.exists) {
        throw createHttpError(404, `Ledger not found: ${command.ledgerId}`, 'ledger_not_found');
      }

      const ledger = ledgerSnapshot.data() || {};
      if (ledger.projectId !== command.projectId) {
        throw createHttpError(400, `Ledger ${command.ledgerId} does not belong to project ${command.projectId}`);
      }

      if (!transactionSnapshot.exists) {
        if (command.expectedVersion !== undefined && command.expectedVersion !== 0) {
          throw createHttpError(409, `Version mismatch: expected ${command.expectedVersion}, actual 0`, 'version_conflict');
        }
        const missingFields = resolveMissingCreateFields(normalizedPatch);
        if (missingFields.length > 0) {
          throw createHttpError(
            400,
            `Missing required create fields: ${missingFields.join(', ')}`,
            'portal_transaction_create_fields_missing',
          );
        }
        const createdTransaction = buildCreatedTransaction({
          command,
          patch: normalizedPatch,
          tenantId,
          actorId,
          timestamp,
        });
        tx.set(transactionRef, createdTransaction);
        return { created: true, transaction: createdTransaction };
      }

      const current = transactionSnapshot.data() || {};
      const currentVersion = readCurrentVersion(current);
      if (command.expectedVersion === undefined) {
        throw createHttpError(409, `expectedVersion is required for update (current=${currentVersion})`, 'version_required');
      }
      if (command.expectedVersion !== currentVersion) {
        throw createHttpError(409, `Version mismatch: expected ${command.expectedVersion}, actual ${currentVersion}`, 'version_conflict');
      }
      if (readOptionalText(current.projectId) && current.projectId !== command.projectId) {
        throw createHttpError(400, `Transaction ${command.id} does not belong to project ${command.projectId}`);
      }
      if (readOptionalText(current.ledgerId) && current.ledgerId !== command.ledgerId) {
        throw createHttpError(400, `Transaction ${command.id} does not belong to ledger ${command.ledgerId}`);
      }
      if (readOptionalText(current.state) && current.state !== 'DRAFT') {
        throw createHttpError(409, `Portal finance-write only supports DRAFT transactions (current=${current.state})`, 'transaction_state_locked');
      }

      const updatedTransaction = buildUpdatedTransaction({
        current,
        command,
        patch: normalizedPatch,
        tenantId,
        actorId,
        timestamp,
      });
      tx.set(transactionRef, updatedTransaction);
      return { created: false, transaction: updatedTransaction };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_transaction_finance_write',
        entityId: command.id,
        actorId,
        actorRole,
        requestId,
        timestamp,
        diff: {
          projectId: command.projectId,
          ledgerId: command.ledgerId,
          created: result.created,
          fields: Object.keys(normalizedPatch),
          version: result.transaction.version,
        },
      });
    }

    return {
      status: 200,
      body: {
        transaction: result.transaction,
        summary: {
          id: command.id,
          projectId: command.projectId,
          ledgerId: command.ledgerId,
          created: result.created,
          version: result.transaction.version,
        },
      },
    };
  }));
}
