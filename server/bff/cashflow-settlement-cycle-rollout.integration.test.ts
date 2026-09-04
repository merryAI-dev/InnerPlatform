import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { readSettlementCycleRolloutInventory } from './cashflow-settlement-cycle-rollout.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('cashflow settlement-cycle rollout inventory (Firestore emulator)', () => {
  const firebaseProjectId = 'demo-settlement-cycle-rollout';
  const tenantId = 'tenant-settlement-cycle-rollout';
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const rootHash = `sha256:${'a'.repeat(64)}`;
  const paths = [
    `orgs/${tenantId}/cashflow_month_close_requests`,
    `orgs/${tenantId}/cashflow_cumulative_close_heads`,
    `orgs/${tenantId}/cashflow_settlement_statuses`,
  ];

  async function clear() {
    for (const path of paths) {
      const snapshot = await db.collection(path).get();
      if (snapshot.empty) continue;
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  beforeEach(async () => {
    await clear();
    const batch = db.batch();
    batch.set(db.doc(`${paths[0]}/project-b-2026-09`), {
      documentType: 'REQUEST', contractVersion: 'cashflow-cumulative-close-v2',
      requestId: 'project-b-2026-09', tenantId, projectId: 'project-b', status: 'APPROVED',
      cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
    });
    batch.set(db.doc(`${paths[1]}/project-a`), {
      contractVersion: 'cashflow-cumulative-close-v2', tenantId, projectId: 'project-a',
      status: 'CLOSED', fromMonth: '2023-01', closedThrough: '2026-08',
      settlementMonth: '2026-09', revision: 4, rootHash,
      requestId: 'project-a-2026-09', requestRevision: 2,
      approvalId: 'approval-a', operationId: 'operation-a',
    });
    batch.set(db.doc(`${paths[2]}/project-a-2026-08`), {
      tenantId, projectId: 'project-a', yearMonth: '2026-08',
      periods: { MONTH: { status: 'COMPLETED' } },
    });
    await batch.commit();
  });
  afterAll(clear);

  it('classifies one consistent snapshot without mutating canonical documents', async () => {
    const before = await db.doc(`${paths[1]}/project-a`).get();
    const statusBefore = await db.doc(`${paths[2]}/project-a-2026-08`).get();

    const inventory = await readSettlementCycleRolloutInventory({ db, tenantId });

    const after = await db.doc(`${paths[1]}/project-a`).get();
    const statusAfter = await db.doc(`${paths[2]}/project-a-2026-08`).get();
    expect(inventory.counts).toMatchObject({
      legacyHeads: 1, canonicalHeads: 0, invalidHeads: 0, genericMonthDocuments: 1,
    });
    expect(inventory.legacyHeads).toEqual([{
      projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
    }]);
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime?.toMillis()).toBe(before.updateTime?.toMillis());
    expect(inventory.protectedSettlementStatuses).toHaveLength(1);
    expect(statusAfter.data()).toEqual(statusBefore.data());
    expect(statusAfter.updateTime?.toMillis()).toBe(statusBefore.updateTime?.toMillis());
  });
});
