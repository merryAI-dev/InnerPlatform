import { createHttpError, readOptionalText } from './bff-utils.mjs';
import { CASHFLOW_CUMULATIVE_CLOSE_CONTRACT } from './cashflow-close-calendar.mjs';

export const CASHFLOW_CUMULATIVE_CLOSE_UNSUPPORTED_REASON_CODE = 'CUMULATIVE_EVIDENCE_CONTRACT_UNSUPPORTED';
export const CASHFLOW_CUMULATIVE_CLOSE_UNSUPPORTED_REASON = '현재 시트는 연간·주차 혼합 양식이라 기존 누적 월 결산 근거를 검증할 수 없습니다. 시트 값은 변경되지 않았습니다.';

export function cashflowMonthCloseRequestPath(tenantId, requestId) {
  return `orgs/${tenantId}/cashflow_month_close_requests/${requestId}`;
}

export function cashflowMonthCloseRequestAuditPath(tenantId, requestId, revision, action) {
  return `orgs/${tenantId}/cashflow_month_close_request_audits/${requestId}-r${revision}-${action}`;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function cashflowSettlementYearMonthForRequest(request) {
  const current = objectValue(request);
  return current.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
    ? readOptionalText(current.throughMonth) || readOptionalText(current.yearMonth)
    : readOptionalText(current.yearMonth);
}

export async function withdrawPendingCumulativeCloseRequest({
  db,
  tenantId,
  projectId,
  requestId,
  expectedRevision,
  expectedManifestHash = '',
  actorId,
  actorRole = '',
  reason,
  reasonCode = '',
  idempotencyKey,
  now,
  allowPrivilegedActor = false,
}) {
  const requestRef = db.doc(cashflowMonthCloseRequestPath(tenantId, requestId));
  const withdrawnAt = now.toISOString();
  let withdrawn;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    const current = snapshot.exists ? snapshot.data() || {} : null;
    const requesterId = readOptionalText(current?.requestedByUid);
    const privileged = allowPrivilegedActor && ['admin', 'finance'].includes(readOptionalText(actorRole).toLowerCase());
    if (!current || current.projectId !== projectId || current.requestId !== requestId || current.contractVersion !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      throw createHttpError(404, '월 결산 요청을 찾을 수 없습니다.', 'cashflow_month_close_request_not_found');
    }
    if (
      current.status === 'WITHDRAWN'
      && current.withdrawIdempotencyKey === idempotencyKey
      && Number(current.revision) === expectedRevision
      && readOptionalText(current.withdrawReason) === reason
    ) {
      withdrawn = current;
      return;
    }
    if (requesterId !== readOptionalText(actorId) && !privileged) {
      throw createHttpError(403, '요청한 본인 또는 재무 관리자만 이전 형식의 월 결산 요청을 회수할 수 있습니다.', 'cashflow_month_close_withdraw_forbidden');
    }
    if (
      current.status !== 'PENDING'
      || Number(current.revision) !== expectedRevision
      || (expectedManifestHash && current.manifestHash !== expectedManifestHash)
    ) {
      throw createHttpError(409, '조직장 검토가 시작되었거나 변경된 월 결산 요청은 회수할 수 없습니다.', 'cashflow_month_close_request_already_reviewed');
    }

    const settlementYearMonth = cashflowSettlementYearMonthForRequest(current);
    const settlementStatusRef = db.doc(`orgs/${tenantId}/cashflow_settlement_statuses/${projectId}-${settlementYearMonth}`);
    const settlementSnapshot = await transaction.get(settlementStatusRef);

    withdrawn = {
      ...current,
      status: 'WITHDRAWN',
      withdrawnByUid: readOptionalText(actorId),
      withdrawnAt,
      withdrawReason: reason,
      ...(reasonCode ? { withdrawReasonCode: reasonCode } : {}),
      withdrawIdempotencyKey: idempotencyKey,
    };
    transaction.set(requestRef, withdrawn);

    const settlementStatus = settlementSnapshot.exists ? settlementSnapshot.data() || {} : {};
    const settlementPeriods = objectValue(settlementStatus.periods);
    const monthStatus = objectValue(settlementPeriods.MONTH);
    if (readOptionalText(monthStatus.status) === 'PENDING_APPROVAL') {
      transaction.set(settlementStatusRef, {
        tenantId,
        projectId,
        yearMonth: settlementYearMonth,
        periods: {
          ...settlementPeriods,
          MONTH: {
            ...monthStatus,
            status: 'WAITING_FOR_UPDATE',
            revision: Number.isSafeInteger(Number(monthStatus.revision)) ? Number(monthStatus.revision) + 1 : 1,
            submittedAt: '',
            submittedBy: '',
            approvedAt: '',
            approvedBy: '',
          },
        },
        updatedAt: withdrawnAt,
      }, { merge: true });
    }
    transaction.set(
      db.doc(cashflowMonthCloseRequestAuditPath(tenantId, requestId, expectedRevision, 'withdrawn')),
      {
        requestId,
        projectId,
        yearMonth: current.yearMonth,
        action: 'WITHDRAWN',
        revision: expectedRevision,
        manifestHash: current.manifestHash || '',
        actorUid: readOptionalText(actorId),
        reason,
        ...(reasonCode ? { reasonCode } : {}),
        idempotencyKey,
        createdAt: withdrawnAt,
      },
    );
  });
  return withdrawn;
}
