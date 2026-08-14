import { readOptionalText } from './bff-utils.mjs';
import {
  applyCumulativeCloseHeadPlan,
  applyCumulativeCloseResetToReclose,
  assertLinkedActivePeopleUid,
} from './cashflow-cumulative-close-head-recovery.mjs';
import {
  CashflowPeriodPolicyPersistenceError,
  persistenceError,
} from './cashflow-period-policy-port.mjs';

export const CASHFLOW_PERIOD_POLICY_READ_LIMIT = 250;

const POLICY_COLLECTIONS = Object.freeze({
  projects: 'projects',
  heads: 'cashflow_cumulative_close_heads',
  closes: 'monthly_closes',
  runs: 'monthly_close_versions',
  requests: 'cashflow_month_close_requests',
  mirrors: 'cashflow_sheet_mirrors',
  completions: 'cashflow_weekly_update_completions',
  amendments: 'cashflow_month_amendments',
  people: 'persons',
  members: 'members',
});

function normalizedLimit(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000
    ? value
    : CASHFLOW_PERIOD_POLICY_READ_LIMIT;
}

function records(snapshot, limit) {
  return snapshot.docs.slice(0, limit).map((doc) => ({
    id: readOptionalText(doc?.id),
    data: doc.data() || {},
  }));
}

async function readBoundedQuery(query, limit) {
  const snapshot = await query.limit(limit + 1).get();
  return {
    available: true,
    records: records(snapshot, limit),
    truncated: snapshot.docs.length > limit,
  };
}

async function readPolicyCollection(db, path, limit) {
  try {
    return await readBoundedQuery(db.collection(path), limit);
  } catch {
    return { available: false, records: [], truncated: false };
  }
}

async function readProjectCollection(db, path, projectId, limit) {
  const result = await readBoundedQuery(
    db.collection(path).where('projectId', '==', projectId),
    limit,
  );
  return result;
}

function document(snapshot) {
  return snapshot?.exists
    ? { exists: true, id: readOptionalText(snapshot.id), data: snapshot.data() || {} }
    : { exists: false, id: readOptionalText(snapshot?.id), data: null };
}

function isApplicationError(error) {
  return error?.name === 'CashflowPeriodPolicyApplicationError';
}

function runtimeAdminError(error) {
  const message = readOptionalText(error?.message);
  return message.includes('--people-uid')
    ? persistenceError('RUNTIME_SUPERADMIN_REQUIRED', error)
    : persistenceError('RUNTIME_SUPERADMIN_STORE_UNAVAILABLE', error);
}

export function createCashflowPeriodPolicyFirestoreAdapter({
  db,
  auditChainService,
  readLimit = CASHFLOW_PERIOD_POLICY_READ_LIMIT,
}) {
  if (!db?.collection || !db?.doc || !db?.runTransaction) {
    throw new TypeError('cashflow period policy Firestore adapter requires database access');
  }
  if (!auditChainService?.appendManyInTransaction) {
    throw new TypeError('cashflow period policy Firestore adapter requires atomic audit access');
  }
  const limit = normalizedLimit(readLimit);

  async function assertRuntimeSuperadmin({ tenantId, actorId, transaction }) {
    try {
      await assertLinkedActivePeopleUid({
        db,
        transaction,
        tenantId,
        peopleUid: actorId,
      });
    } catch (error) {
      throw runtimeAdminError(error);
    }
  }

  return {
    assertRuntimeSuperadmin,

    async readPolicyEvidence({ tenantId }) {
      const entries = await Promise.all(Object.entries(POLICY_COLLECTIONS).map(async ([key, collection]) => [
        key,
        await readPolicyCollection(db, `orgs/${tenantId}/${collection}`, limit),
      ]));
      return Object.fromEntries(entries);
    },

    async readProject({ tenantId, projectId }) {
      try {
        return document(await db.doc(`orgs/${tenantId}/projects/${projectId}`).get());
      } catch (error) {
        throw persistenceError('PROJECT_STORE_UNAVAILABLE', error);
      }
    },

    async readProjectRecoveryEvidence({ tenantId, projectId }) {
      const basePath = `orgs/${tenantId}`;
      try {
        const [headSnapshot, closes, versions, requests] = await Promise.all([
          db.doc(`${basePath}/cashflow_cumulative_close_heads/${projectId}`).get(),
          readProjectCollection(db, `${basePath}/monthly_closes`, projectId, limit),
          readProjectCollection(db, `${basePath}/monthly_close_versions`, projectId, limit),
          readProjectCollection(db, `${basePath}/cashflow_month_close_requests`, projectId, limit),
        ]);
        if (closes.truncated || versions.truncated || requests.truncated) {
          throw persistenceError('RECOVERY_EVIDENCE_TRUNCATED');
        }
        return {
          head: document(headSnapshot),
          monthlyCloses: closes.records,
          monthlyCloseVersions: versions.records,
          requests: requests.records,
        };
      } catch (error) {
        if (error instanceof CashflowPeriodPolicyPersistenceError) throw error;
        throw persistenceError('RECOVERY_EVIDENCE_UNAVAILABLE', error);
      }
    },

    async readProjectResetEvidence({ tenantId, projectId, monthlyCloseId }) {
      const basePath = `orgs/${tenantId}`;
      try {
        const [headSnapshot, closeSnapshot, versions, requests] = await Promise.all([
          db.doc(`${basePath}/cashflow_cumulative_close_heads/${projectId}`).get(),
          db.doc(`${basePath}/monthly_closes/${monthlyCloseId}`).get(),
          readProjectCollection(db, `${basePath}/monthly_close_versions`, projectId, limit),
          readProjectCollection(db, `${basePath}/cashflow_month_close_requests`, projectId, limit),
        ]);
        if (versions.truncated || requests.truncated) {
          throw persistenceError('RESET_EVIDENCE_TRUNCATED');
        }
        return {
          head: document(headSnapshot),
          monthlyClose: document(closeSnapshot),
          monthlyCloseVersions: versions.records,
          requests: requests.records,
        };
      } catch (error) {
        if (error instanceof CashflowPeriodPolicyPersistenceError) throw error;
        throw persistenceError('RESET_EVIDENCE_UNAVAILABLE', error);
      }
    },

    async transactExecutiveApproverChange({
      tenantId,
      actorId,
      projectId,
      approverUid,
      decide,
    }) {
      const basePath = `orgs/${tenantId}`;
      const projectRef = db.doc(`${basePath}/projects/${projectId}`);
      const approverMemberRef = db.doc(`${basePath}/members/${approverUid}`);
      const peopleQuery = db.collection(`${basePath}/persons`).where('uid', '==', approverUid).limit(2);
      const pendingRequestsQuery = db.collection(`${basePath}/cashflow_month_close_requests`)
        .where('projectId', '==', projectId)
        .limit(limit + 1);
      try {
        return await db.runTransaction(async (transaction) => {
          await assertRuntimeSuperadmin({ tenantId, actorId, transaction });
          const [projectSnapshot, memberSnapshot, peopleSnapshot, pendingSnapshot] = await Promise.all([
            transaction.get(projectRef),
            transaction.get(approverMemberRef),
            transaction.get(peopleQuery),
            transaction.get(pendingRequestsQuery),
          ]);
          if (pendingSnapshot.docs.length > limit) {
            throw persistenceError('EXECUTIVE_APPROVER_EVIDENCE_TRUNCATED');
          }
          const result = await decide({
            project: document(projectSnapshot),
            member: document(memberSnapshot),
            people: records(peopleSnapshot, 2),
            pendingRequests: records(pendingSnapshot, limit),
          });
          if (result.changed) {
            await auditChainService.appendManyInTransaction(transaction, result.auditEntries);
            transaction.set(projectRef, result.projectPatch, { merge: true });
          }
          return result;
        });
      } catch (error) {
        if (error instanceof CashflowPeriodPolicyPersistenceError || isApplicationError(error)) throw error;
        throw persistenceError('EXECUTIVE_APPROVER_TRANSACTION_UNAVAILABLE', error);
      }
    },

    async applyCumulativeCloseHeadRecovery(args) {
      try {
        return await applyCumulativeCloseHeadPlan({
          db,
          auditChainService,
          ...args,
        });
      } catch (error) {
        const message = readOptionalText(error?.message);
        if (message.includes('ACTIVE runtime admin member') || message.includes('exactly one People record')) {
          throw persistenceError('RUNTIME_SUPERADMIN_REQUIRED', error);
        }
        if (message.includes('evidence changed')) {
          throw persistenceError('RECOVERY_EVIDENCE_CHANGED', error);
        }
        if (message.includes('query limit exceeded')) {
          throw persistenceError('RECOVERY_EVIDENCE_TRUNCATED', error);
        }
        throw persistenceError('RECOVERY_UNAVAILABLE', error);
      }
    },

    async applyCumulativeCloseResetToReclose(args) {
      try {
        return await applyCumulativeCloseResetToReclose({
          db,
          auditChainService,
          ...args,
        });
      } catch (error) {
        const message = readOptionalText(error?.message);
        if (message.includes('ACTIVE runtime admin member') || message.includes('exactly one People record')) {
          throw persistenceError('RUNTIME_SUPERADMIN_REQUIRED', error);
        }
        if (message.includes('valid authority requires normal reopen')) {
          throw persistenceError('RESET_NORMAL_REOPEN_REQUIRED', error);
        }
        if (message.includes('exact recovery is available')) {
          throw persistenceError('RESET_EXACT_RECOVERY_REQUIRED', error);
        }
        if (message.includes('evidence changed')) {
          throw persistenceError('RESET_EVIDENCE_CHANGED', error);
        }
        if (message.includes('query limit exceeded')) {
          throw persistenceError('RESET_EVIDENCE_TRUNCATED', error);
        }
        throw persistenceError('RESET_UNAVAILABLE', error);
      }
    },
  };
}
