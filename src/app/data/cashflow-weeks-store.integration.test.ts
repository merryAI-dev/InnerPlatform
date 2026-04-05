import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirestoreDb } from '../../../server/bff/firestore.mjs';
import { getMonthMondayWeeks } from '../platform/cashflow-weeks';
import {
  buildCashflowWeekUpdatePatch,
  buildInitialCashflowWeekDoc,
  resolveWeekDocId,
} from './cashflow-weeks.persistence';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('cashflow-weeks persistence integration (Firestore emulator)', () => {
  const tenantId = 'mysc';
  const projectId = 'p-settlement-it';
  const db = createFirestoreDb({ projectId: 'cashflow-weeks-it' });

  async function clearCollection(path: string): Promise<void> {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((docItem) => batch.delete(docItem.ref));
    await batch.commit();
  }

  beforeEach(async () => {
    await clearCollection(`orgs/${tenantId}/cashflowWeeks`);
  });

  afterAll(async () => {
    await clearCollection(`orgs/${tenantId}/cashflowWeeks`);
  });

  it('creates the initial actual week document with normalized amounts', async () => {
    const [firstWeek] = getMonthMondayWeeks('2026-03');
    expect(firstWeek).toBeTruthy();
    const docData = buildInitialCashflowWeekDoc({
      orgId: tenantId,
      actorUid: 'u-pm-001',
      actorName: 'PM 보람',
      projectId,
      yearMonth: '2026-03',
      weekNo: firstWeek.weekNo,
      weekStart: firstWeek.weekStart,
      weekEnd: firstWeek.weekEnd,
      mode: 'actual',
      amounts: {
        DIRECT_COST_OUT: 45000.8 as any,
        VAT_OUT: 4500.2 as any,
      },
      now: '2026-04-05T10:00:00.000Z',
    });

    const id = resolveWeekDocId(projectId, '2026-03', firstWeek.weekNo);
    await db.doc(`orgs/${tenantId}/cashflowWeeks/${id}`).set(docData, { merge: false });

    const stored = await db.doc(`orgs/${tenantId}/cashflowWeeks/${id}`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      tenantId,
      projectId,
      yearMonth: '2026-03',
      weekNo: firstWeek.weekNo,
      actual: {
        DIRECT_COST_OUT: 45000,
        VAT_OUT: 4500,
      },
      projection: {},
      updatedByUid: 'u-pm-001',
      updatedByName: 'PM 보람',
    });
  });

  it('updates only the targeted nested actual fields during retry sync', async () => {
    const [firstWeek] = getMonthMondayWeeks('2026-03');
    const id = resolveWeekDocId(projectId, '2026-03', firstWeek.weekNo);
    await db.doc(`orgs/${tenantId}/cashflowWeeks/${id}`).set(buildInitialCashflowWeekDoc({
      orgId: tenantId,
      actorUid: 'u-pm-001',
      actorName: 'PM 보람',
      projectId,
      yearMonth: '2026-03',
      weekNo: firstWeek.weekNo,
      weekStart: firstWeek.weekStart,
      weekEnd: firstWeek.weekEnd,
      mode: 'actual',
      amounts: {
        DIRECT_COST_OUT: 15000 as any,
      },
      now: '2026-04-05T10:00:00.000Z',
    }), { merge: false });

    await db.doc(`orgs/${tenantId}/cashflowWeeks/${id}`).update(buildCashflowWeekUpdatePatch({
      orgId: tenantId,
      actorUid: 'u-pm-001',
      actorName: 'PM 보람',
      mode: 'actual',
      amounts: {
        DIRECT_COST_OUT: 45000 as any,
        VAT_OUT: 4500 as any,
      },
      now: '2026-04-05T10:05:00.000Z',
    }));

    const stored = await db.doc(`orgs/${tenantId}/cashflowWeeks/${id}`).get();
    expect(stored.data()).toMatchObject({
      actual: {
        DIRECT_COST_OUT: 45000,
        VAT_OUT: 4500,
      },
      updatedAt: '2026-04-05T10:05:00.000Z',
      updatedByName: 'PM 보람',
    });
  });
});
