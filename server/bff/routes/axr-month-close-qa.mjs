import {
  asyncHandler,
  assertActorRoleAllowed,
  createHttpError,
  readOptionalText,
} from '../bff-utils.mjs';

export const AXR_MONTH_CLOSE_QA_PROJECT_ID = 'p1773817948751';
export const AXR_MONTH_CLOSE_QA_PROJECT_NAME = 'AXR프로젝트경비경';
export const AXR_MONTH_CLOSE_QA_ENABLED = true;

const ACTIVE_REQUEST_STATUSES = new Set(['PENDING', 'APPROVING', 'UNCERTAIN']);

export function resolveAxrMonthCloseQaActions({ closeStatus, requestStatus, isDesignatedApprover, role }) {
  if (requestStatus === 'PENDING') {
    return isDesignatedApprover ? ['APPROVE_REQUEST', 'REJECT_REQUEST', 'REFRESH'] : ['REFRESH'];
  }
  if (requestStatus === 'APPROVING' || requestStatus === 'UNCERTAIN') return ['REFRESH'];
  if (closeStatus === 'REOPEN_REQUESTED') {
    return role === 'admin' || role === 'finance'
      ? ['APPROVE_REOPEN', 'REJECT_REOPEN', 'REFRESH']
      : ['REFRESH'];
  }
  if (closeStatus === 'CLOSED') return ['REQUEST_REOPEN', 'REFRESH'];
  return ['REQUEST_CLOSE', 'REFRESH'];
}

export function mountAxrMonthCloseQaRoutes(app, { db, enabled = AXR_MONTH_CLOSE_QA_ENABLED } = {}) {
  app.get('/api/v1/qa/axr-month-close/:projectId/control', asyncHandler(async (req, res) => {
    if (!enabled) {
      throw createHttpError(404, 'AXR 월 결산 QA 기능이 비활성화되어 있습니다.', 'not_found');
    }
    assertActorRoleAllowed(req, ['admin', 'finance'], 'use AXR month-close QA controls');
    if (!db?.doc) {
      throw createHttpError(503, '월 결산 QA 저장소에 연결하지 못했습니다.', 'axr_month_close_qa_store_unavailable');
    }

    const projectId = req.params.projectId;
    const yearMonth = readOptionalText(req.query.yearMonth);
    if (projectId !== AXR_MONTH_CLOSE_QA_PROJECT_ID
      || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw createHttpError(404, 'AXR 월 결산 QA 대상을 찾을 수 없습니다.', 'not_found');
    }

    const tenantId = readOptionalText(req.context.tenantId);
    const requestId = `${projectId}-${yearMonth}`;
    const [projectSnapshot, requestSnapshot, closeSnapshot, cumulativeHeadSnapshot] = await Promise.all([
      db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
      db.doc(`orgs/${tenantId}/cashflow_month_close_requests/${requestId}`).get(),
      db.doc(`orgs/${tenantId}/monthly_closes/${requestId}`).get(),
      db.doc(`orgs/${tenantId}/cashflow_cumulative_close_heads/${projectId}`).get(),
    ]);
    if (!projectSnapshot.exists
      || projectSnapshot.data()?.name !== AXR_MONTH_CLOSE_QA_PROJECT_NAME) {
      throw createHttpError(404, 'AXR 월 결산 QA 프로젝트가 일치하지 않습니다.', 'not_found');
    }

    const request = requestSnapshot.exists ? requestSnapshot.data() || {} : {};
    const close = closeSnapshot.exists ? closeSnapshot.data() || {} : {};
    const cumulativeHead = cumulativeHeadSnapshot.exists ? cumulativeHeadSnapshot.data() || {} : {};
    const requestStatus = ACTIVE_REQUEST_STATUSES.has(readOptionalText(request.status))
      ? readOptionalText(request.status)
      : readOptionalText(request.status) || null;
    const closeStatus = readOptionalText(close.status) || 'OPEN';
    const role = readOptionalText(req.context.actorRole).toLowerCase();
    const isDesignatedApprover = requestStatus === 'PENDING'
      && readOptionalText(request.approverUid) === readOptionalText(req.context.actorId)
      && readOptionalText(projectSnapshot.data()?.executiveApproverId) === readOptionalText(req.context.actorId);

    res.status(200).json({
      enabled: true,
      projectId,
      projectName: AXR_MONTH_CLOSE_QA_PROJECT_NAME,
      yearMonth,
      close: {
        status: closeStatus,
        revision: Number.isSafeInteger(close.revision) ? close.revision : 0,
        snapshotHash: readOptionalText(close.snapshotHash) || null,
        latestVersionId: readOptionalText(close.latestVersionId) || null,
      },
      request: requestSnapshot.exists ? {
        requestId,
        status: requestStatus,
        revision: Number.isSafeInteger(request.revision) ? request.revision : 0,
        manifestHash: readOptionalText(request.manifestHash) || null,
        approverUid: readOptionalText(request.approverUid) || null,
      } : null,
      cumulativeHead: cumulativeHeadSnapshot.exists ? {
        closedThrough: readOptionalText(cumulativeHead.closedThrough) || null,
        rootHash: readOptionalText(cumulativeHead.rootHash) || null,
        revision: Number.isSafeInteger(cumulativeHead.revision) ? cumulativeHead.revision : 0,
      } : null,
      allowedActions: resolveAxrMonthCloseQaActions({
        closeStatus,
        requestStatus,
        isDesignatedApprover,
        role,
      }),
      confirmationToken: `${AXR_MONTH_CLOSE_QA_PROJECT_NAME} / ${yearMonth} / r${Number.isSafeInteger(close.revision) ? close.revision : 0}`,
    });
  }));
}
