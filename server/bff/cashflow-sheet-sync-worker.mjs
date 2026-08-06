import { createHttpError, readOptionalText } from './bff-utils.mjs';

function hasCashflowSheetConnection(project = {}) {
  if (readOptionalText(project?.cashflowSheetLab?.value)) return true;
  return Object.values(project?.cashflowSheetLabSources || {})
    .some((source) => readOptionalText(source?.value));
}

function failureSummary(projectId, error) {
  return {
    projectId,
    code: readOptionalText(error?.code) || readOptionalText(error?.name) || 'cashflow_sheet_sync_failed',
    message: readOptionalText(error?.message) || 'Cashflow sheet sync failed.',
  };
}

export function assertCashflowSheetSyncComplete(discoveredProjects, processedProjects) {
  if (discoveredProjects === processedProjects) return;
  throw createHttpError(
    500,
    `Cashflow sheet sync was partial (${processedProjects}/${discoveredProjects}).`,
    'cashflow_sheet_sync_partial_forbidden',
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runCashflowSheetSyncWorker(db, {
  tenantId = 'mysc',
  concurrency = 4,
  syncProject,
  runId,
} = {}) {
  const resolvedTenantId = readOptionalText(tenantId) || 'mysc';
  if (typeof syncProject !== 'function') {
    throw createHttpError(503, 'Cashflow sheet sync is not configured.', 'cashflow_sheet_sync_unconfigured');
  }
  const normalizedConcurrency = Math.max(1, Math.min(8, Math.trunc(Number(concurrency) || 4)));
  const snapshot = await db.collection(`orgs/${resolvedTenantId}/projects`).get();
  const projects = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter(hasCashflowSheetConnection)
    .sort((left, right) => left.id.localeCompare(right.id));
  const resolvedRunId = readOptionalText(runId) || `cashflow-sheet-sync:${new Date().toISOString()}`;
  const settled = await mapWithConcurrency(projects, normalizedConcurrency, (project) => syncProject({
    tenantId: resolvedTenantId,
    projectId: project.id,
    runId: resolvedRunId,
  }));
  assertCashflowSheetSyncComplete(projects.length, settled.length);

  const failures = [];
  let changedCount = 0;
  let appliedCount = 0;
  let noChangeProjects = 0;
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push(failureSummary(projects[index].id, result.reason));
      return;
    }
    changedCount += Math.max(0, Number(result.value?.comparisons?.sheetToJvm?.changeCount) || 0);
    appliedCount += Math.max(0, Number(result.value?.appliedCount) || 0);
    if (readOptionalText(result.value?.classification) === 'ALL_SYNCED') noChangeProjects += 1;
  });

  return {
    ok: failures.length === 0,
    tenantId: resolvedTenantId,
    runId: resolvedRunId,
    concurrency: normalizedConcurrency,
    discoveredProjects: projects.length,
    processedProjects: settled.length,
    succeededProjects: settled.length - failures.length,
    failedProjects: failures.length,
    changedCount,
    appliedCount,
    noChangeProjects,
    failures,
  };
}
