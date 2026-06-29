import { describe, expect, it } from 'vitest';
import { recomputeCashflowWeeks } from './projections.mjs';

class FakeDoc {
  constructor(private db: FakeDb, public path: string) {}

  async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
    const current = this.db.data.get(this.path) || {};
    this.db.data.set(this.path, options?.merge ? { ...current, ...data } : data);
  }
}

class FakeCollection {
  constructor(private db: FakeDb, private path: string) {}

  async get() {
    const prefix = `${this.path}/`;
    const docs = Array.from(this.db.data.entries())
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, value]) => ({
        id: path.slice(prefix.length),
        data: () => value,
      }));
    return { docs };
  }
}

class FakeBatch {
  private writes: Array<{ ref: FakeDoc; data: Record<string, unknown>; options?: { merge?: boolean } }> = [];

  set(ref: FakeDoc, data: Record<string, unknown>, options?: { merge?: boolean }) {
    this.writes.push({ ref, data, options });
  }

  async commit() {
    for (const write of this.writes) {
      await write.ref.set(write.data, write.options);
    }
  }
}

class FakeDb {
  data = new Map<string, Record<string, any>>();

  collection(path: string) {
    return new FakeCollection(this, path);
  }

  doc(path: string) {
    return new FakeDoc(this, path);
  }

  batch() {
    return new FakeBatch();
  }
}

describe('cashflow week projection', () => {
  it('syncs approved transactions into weekly actual amounts', async () => {
    const db = new FakeDb();
    db.data.set('orgs/mysc/transactions/tx001', {
      id: 'tx001',
      projectId: 'p001',
      dateTime: '2026-02-16',
      direction: 'IN',
      state: 'APPROVED',
      cashflowCategory: 'CONTRACT_PAYMENT',
      amounts: { bankAmount: 1000 },
    });
    db.data.set('orgs/mysc/transactions/tx002', {
      id: 'tx002',
      projectId: 'p001',
      dateTime: '2026-02-17',
      direction: 'OUT',
      state: 'APPROVED',
      cashflowCategory: 'LABOR_COST',
      amounts: { bankAmount: 300 },
    });

    await recomputeCashflowWeeks(db as any, 'mysc', '2026-02-20T00:00:00.000Z');

    expect(db.data.get('orgs/mysc/cashflow_weeks/p001-2026-02-w3')?.actual).toEqual({
      SALES_IN: 1000,
      MYSC_LABOR_OUT: 300,
    });
  });

  it('clears stale actual amounts when no approved transaction remains', async () => {
    const db = new FakeDb();
    db.data.set('orgs/mysc/cashflow_weeks/p001-2026-02-w3', {
      id: 'p001-2026-02-w3',
      tenantId: 'mysc',
      projectId: 'p001',
      yearMonth: '2026-02',
      weekNo: 3,
      weekStart: '2026-02-16',
      weekEnd: '2026-02-22',
      projection: { SALES_IN: 5000 },
      actual: { SALES_IN: 1000 },
    });

    await recomputeCashflowWeeks(db as any, 'mysc', '2026-02-20T00:00:00.000Z');

    expect(db.data.get('orgs/mysc/cashflow_weeks/p001-2026-02-w3')).toMatchObject({
      projection: { SALES_IN: 5000 },
      actual: {},
    });
  });
});
