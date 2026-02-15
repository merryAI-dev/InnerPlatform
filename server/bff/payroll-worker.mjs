function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseIsoDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim());
  if (!m) throw new Error(`Invalid ISO date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toUtcDate(date) {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDateUtc(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekendUtc(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(date, deltaDays) {
  const cursor = toUtcDate(date);
  const next = new Date(cursor.getTime() + Number(deltaDays) * 24 * 60 * 60 * 1000);
  return formatIsoDateUtc(next);
}

export function subtractBusinessDays(date, businessDays) {
  let cursor = toUtcDate(date);
  let remaining = Number(businessDays) || 0;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    if (!isWeekendUtc(cursor)) remaining -= 1;
  }
  return formatIsoDateUtc(cursor);
}

function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function computePlannedPayDate(yearMonth, dayOfMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || '').trim());
  if (!m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const last = daysInMonth(year, month);
  const day = Math.max(1, Math.min(last, Math.trunc(Number(dayOfMonth) || 1)));
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addMonthsToYearMonth(yearMonth, deltaMonths) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || '').trim());
  if (!m) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const next = new Date(Date.UTC(year, month0 + Number(deltaMonths || 0), 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}`;
}

export function formatDateInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getSeoulTodayIso(now = new Date()) {
  return formatDateInTimeZone(now, 'Asia/Seoul');
}

function normalizeSchedule(raw, tenantId) {
  if (!raw || typeof raw !== 'object') return null;
  const projectId = typeof raw.projectId === 'string' ? raw.projectId.trim() : '';
  if (!projectId) return null;
  const dayOfMonth = Math.max(1, Math.min(31, Math.trunc(Number(raw.dayOfMonth) || 0)));
  if (!dayOfMonth) return null;
  const active = raw.active !== false;
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim() : 'Asia/Seoul';
  const lead = Math.max(0, Math.min(10, Math.trunc(Number(raw.noticeLeadBusinessDays) || 3)));
  return {
    id: projectId,
    tenantId,
    projectId,
    dayOfMonth,
    timezone,
    noticeLeadBusinessDays: lead,
    active,
  };
}

async function chunkedBatch(db, writes, chunkSize = 450) {
  for (let i = 0; i < writes.length; i += chunkSize) {
    const batch = db.batch();
    const chunk = writes.slice(i, i + chunkSize);
    chunk.forEach((w) => w(batch));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

export async function runPayrollWorker(db, {
  tenantId,
  nowIso,
  monthsAhead = 1,
  leadBusinessDays = 3,
  matchWindowDays = 2,
} = {}) {
  const resolvedTenantId = String(tenantId || '').trim() || 'mysc';
  const now = nowIso ? new Date(nowIso) : new Date();
  const today = getSeoulTodayIso(now);
  const yearMonth = today.slice(0, 7);
  const months = [];
  for (let i = 0; i <= monthsAhead; i += 1) {
    months.push(addMonthsToYearMonth(yearMonth, i));
  }

  const schedulesSnap = await db.collection(`orgs/${resolvedTenantId}/payroll_schedules`).get();
  const schedules = schedulesSnap.docs
    .map((d) => normalizeSchedule(d.data(), resolvedTenantId))
    .filter(Boolean);

  const upserts = [];
  const updatedAt = now.toISOString();

  // 1) Ensure payroll run docs exist (idempotent).
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    for (const ym of months) {
      const plannedPayDate = computePlannedPayDate(ym, schedule.dayOfMonth);
      const noticeDate = subtractBusinessDays(plannedPayDate, schedule.noticeLeadBusinessDays || leadBusinessDays);
      const runId = `${schedule.projectId}-${ym}`;
      const ref = db.doc(`orgs/${resolvedTenantId}/payroll_runs/${runId}`);
      upserts.push((batch) => {
        batch.set(ref, {
          id: runId,
          tenantId: resolvedTenantId,
          projectId: schedule.projectId,
          yearMonth: ym,
          plannedPayDate,
          noticeDate,
          noticeLeadBusinessDays: schedule.noticeLeadBusinessDays || leadBusinessDays,
          updatedAt,
        }, { merge: true });
      });
    }
  }
  await chunkedBatch(db, upserts);

  // 2) Auto-match transactions around planned pay date for this month.
  const matchResults = [];
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const ym = yearMonth;
    const plannedPayDate = computePlannedPayDate(ym, schedule.dayOfMonth);
    const runId = `${schedule.projectId}-${ym}`;
    const runRef = db.doc(`orgs/${resolvedTenantId}/payroll_runs/${runId}`);

    // eslint-disable-next-line no-await-in-loop
    const runSnap = await runRef.get();
    const current = runSnap.exists ? (runSnap.data() || {}) : {};
    const currentPaid = typeof current.paidStatus === 'string' ? current.paidStatus : 'UNKNOWN';
    const isConfirmed = currentPaid === 'CONFIRMED';

    const start = addDays(plannedPayDate, -matchWindowDays);
    const end = addDays(plannedPayDate, matchWindowDays);

    // eslint-disable-next-line no-await-in-loop
    const txSnap = await db.collection(`orgs/${resolvedTenantId}/transactions`)
      .where('projectId', '==', schedule.projectId)
      .where('cashflowCategory', '==', 'LABOR_COST')
      .where('direction', '==', 'OUT')
      .where('state', '==', 'APPROVED')
      .where('dateTime', '>=', start)
      .where('dateTime', '<=', end)
      .orderBy('dateTime', 'asc')
      .get();

    const txIds = txSnap.docs.map((d) => d.id);

    let nextPaid = currentPaid;
    if (!isConfirmed) {
      if (txIds.length > 0) nextPaid = 'AUTO_MATCHED';
      else if (today > plannedPayDate) nextPaid = 'MISSING';
    }

    if (!isConfirmed && (nextPaid !== currentPaid || JSON.stringify(txIds) !== JSON.stringify(current.matchedTxIds || []))) {
      matchResults.push((batch) => {
        batch.set(runRef, {
          tenantId: resolvedTenantId,
          matchedTxIds: txIds,
          paidStatus: nextPaid,
          updatedAt,
        }, { merge: true });
      });
    }
  }
  await chunkedBatch(db, matchResults);

  return {
    ok: true,
    tenantId: resolvedTenantId,
    today,
    schedules: schedules.length,
    upsertedRuns: upserts.length,
    matchedRuns: matchResults.length,
  };
}

export async function runMonthlyCloseWorker(db, {
  tenantId,
  nowIso,
  createMonths = 2,
} = {}) {
  const resolvedTenantId = String(tenantId || '').trim() || 'mysc';
  const now = nowIso ? new Date(nowIso) : new Date();
  const today = getSeoulTodayIso(now);
  const currentYm = today.slice(0, 7);
  const months = [];
  for (let i = 0; i < createMonths; i += 1) {
    months.push(addMonthsToYearMonth(currentYm, -i));
  }

  const projectsSnap = await db.collection(`orgs/${resolvedTenantId}/projects`).get();
  const projectIds = projectsSnap.docs.map((d) => d.id).filter(Boolean);
  const updatedAt = now.toISOString();
  let created = 0;

  for (const projectId of projectIds) {
    for (const ym of months) {
      const closeId = `${projectId}-${ym}`;
      const ref = db.doc(`orgs/${resolvedTenantId}/monthly_closes/${closeId}`);
      // eslint-disable-next-line no-await-in-loop
      await ref.create({
        id: closeId,
        tenantId: resolvedTenantId,
        projectId,
        yearMonth: ym,
        status: 'OPEN',
        acknowledged: false,
        createdAt: updatedAt,
        updatedAt,
      }).then(() => { created += 1; }).catch((err) => {
        // Already exists
        if (err?.code === 6 || err?.code === 'already-exists') return;
      });
    }
  }

  return {
    ok: true,
    tenantId: resolvedTenantId,
    today,
    projects: projectIds.length,
    created,
  };
}
