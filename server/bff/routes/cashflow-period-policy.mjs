import {
  asyncHandler,
  createHttpError,
  createMutatingRoute,
  readOptionalText,
} from '../bff-utils.mjs';
import {
  CashflowPeriodPolicyApplicationError,
  createCashflowPeriodPolicyService,
} from '../cashflow-period-policy-service.mjs';

const APPLICATION_ERROR_STATUS = Object.freeze({
  cashflow_close_head_recovery_evidence_changed: 409,
  cashflow_close_head_recovery_normal_reopen_required: 409,
  cashflow_close_head_recovery_not_ready: 409,
  cashflow_close_head_recovery_store_unavailable: 503,
  cashflow_close_head_recovery_unavailable: 503,
  cashflow_close_head_recovery_unrepairable: 409,
  cashflow_close_reset_to_reclose_evidence_changed: 409,
  cashflow_close_reset_to_reclose_exact_recovery_required: 409,
  cashflow_close_reset_to_reclose_normal_reopen_required: 409,
  cashflow_close_reset_to_reclose_not_ready: 409,
  cashflow_close_reset_to_reclose_payload_invalid: 400,
  cashflow_close_reset_to_reclose_store_unavailable: 503,
  cashflow_close_reset_to_reclose_unavailable: 503,
  cashflow_executive_approver_locked: 409,
  cashflow_executive_approver_member_inactive: 409,
  cashflow_executive_approver_people_uid_ambiguous: 409,
  cashflow_executive_approver_people_uid_unlinked: 409,
  cashflow_project_identity_mismatch: 409,
  not_found: 404,
  runtime_superadmin_required: 403,
  runtime_superadmin_store_unavailable: 503,
  version_conflict: 409,
});

async function callApplication(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof CashflowPeriodPolicyApplicationError)) throw error;
    const status = APPLICATION_ERROR_STATUS[error.code];
    if (!status) {
      throw createHttpError(
        503,
        '현금흐름 기간·마감 정책 처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'cashflow_period_policy_unavailable',
      );
    }
    throw createHttpError(status, error.message, error.code);
  }
}

function validProjectId(value) {
  return value && !value.includes('/');
}

function validEvidence(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function mountCashflowPeriodPolicyRoutes(app, {
  db,
  now,
  idempotencyService,
  auditChainService,
}) {
  const service = createCashflowPeriodPolicyService({ db, now, auditChainService });

  app.get('/api/v1/admin/cashflow-period-policy', asyncHandler(async (req, res) => {
    const body = await callApplication(() => service.readPolicy(req.context));
    res.status(200).json(body);
  }));

  app.patch(
    '/api/v1/admin/cashflow-period-policy/projects/:projectId/executive-approver',
    createMutatingRoute(idempotencyService, async (req) => {
      const projectId = readOptionalText(req.params.projectId);
      const approverUid = readOptionalText(req.body?.approverUid);
      const expectedVersion = req.body?.expectedVersion;
      const reason = readOptionalText(req.body?.reason);
      if (
        !validProjectId(projectId)
        || !approverUid || approverUid.includes('/')
        || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
        || !reason || reason.length > 500
      ) {
        throw createHttpError(
          400,
          '조직장 People UID, expectedVersion, 변경 사유를 확인해 주세요.',
          'cashflow_executive_approver_payload_invalid',
        );
      }
      const body = await callApplication(() => service.updateExecutiveApprover({
        ...req.context,
        projectId,
        approverUid,
        expectedVersion,
        reason,
      }));
      return { status: 200, body };
    }),
  );

  app.post(
    '/api/v1/admin/cashflow-period-policy/projects/:projectId/cumulative-close-head-recovery',
    createMutatingRoute(idempotencyService, async (req) => {
      const projectId = readOptionalText(req.params.projectId);
      const reason = readOptionalText(req.body?.reason);
      const expectedEvidence = req.body?.expectedEvidence;
      if (!validProjectId(projectId) || !reason || reason.length > 500 || !validEvidence(expectedEvidence)) {
        throw createHttpError(
          400,
          '프로젝트, 복구 사유, 화면에서 확인한 복구 근거를 다시 확인해 주세요.',
          'cashflow_close_head_recovery_payload_invalid',
        );
      }
      const body = await callApplication(() => service.recoverCumulativeCloseHead({
        ...req.context,
        projectId,
        reason,
        expectedEvidence,
      }));
      return { status: 200, body };
    }),
  );

  app.post(
    '/api/v1/admin/cashflow-period-policy/projects/:projectId/cumulative-close-reset-to-reclose',
    createMutatingRoute(idempotencyService, async (req) => {
      const projectId = readOptionalText(req.params.projectId);
      const reason = readOptionalText(req.body?.reason);
      const expectedEvidence = req.body?.expectedEvidence;
      if (!validProjectId(projectId) || !reason || reason.length > 500 || !validEvidence(expectedEvidence)) {
        throw createHttpError(
          400,
          '프로젝트, 재결산 준비 사유, 화면에서 확인한 회차 근거를 다시 확인해 주세요.',
          'cashflow_close_reset_to_reclose_payload_invalid',
        );
      }
      const body = await callApplication(() => service.resetCumulativeCloseToReclose({
        ...req.context,
        projectId,
        reason,
        expectedEvidence,
      }));
      return { status: 200, body };
    }),
  );
}
