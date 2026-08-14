// CLI compatibility boundary. The recovery planner/executor lives in the BFF application
// layer so the ERP route and this read-only-by-default audit command share one implementation.
export {
  applyCumulativeCloseHeadPlan,
  applyCumulativeCloseResetToReclose,
  assertLinkedActivePeopleUid,
  buildCumulativeCloseHeadPlan,
  buildCumulativeCloseResetToReclosePlan,
  executeCumulativeCloseHeadMigration,
  parseCumulativeCloseHeadMigrationArgs,
  validateCumulativeCloseHeadMigrationOptions,
} from '../server/bff/cashflow-cumulative-close-head-recovery.mjs';
