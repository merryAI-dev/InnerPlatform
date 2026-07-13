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
    this.db.readCollections.push(this.path);
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

class FakeDb {
  data = new Map<string, Record<string, any>>();
  readCollections: string[] = [];

  collection(path: string) {
    return new FakeCollection(this, path);
  }

  doc(path: string) {
    return new FakeDoc(this, path);
  }
}

describe('cashflow week projection', () => {
  it('observes canonical JVM weeks without deriving or mutating them from transactions', async () => {
    const db = new FakeDb();
    const canonicalWeek = {
      id: 'p001-2026-02-w3',
      tenantId: 'mysc',
      projectId: 'p001',
      yearMonth: '2026-02',
      weekNo: 3,
      weekStart: '2026-02-16',
      weekEnd: '2026-02-22',
      projection: {
        MYSC_PREPAY_IN: 1000,
        MYSC_PREPAY_LABOR_IN: 2000,
        MYSC_PREPAY_INPUT_VAT_IN: 300,
      },
      actual: {
        MYSC_PREPAY_IN: 900,
        MYSC_PREPAY_LABOR_IN: 1800,
        MYSC_PREPAY_INPUT_VAT_IN: 270,
        MYSC_PREPAY_DIRECT_OUT: 700,
        MYSC_PREPAY_LABOR_OUT: 600,
      },
      weeklyExpenseActualBySheet: {
        'sheet-001': { DIRECT_COST_OUT: 420 },
      },
      actualTotals: {
        totalIn: 2970,
        totalOut: 1720,
        balance: 1250,
      },
      updatedAt: '2026-02-19T00:00:00.000Z',
      updatedByUid: 'jvm-weekly-api',
    };
    db.data.set('orgs/mysc/cashflow_weeks/p001-2026-02-w3', canonicalWeek);
    db.data.set('orgs/mysc/transactions/tx001', {
      id: 'tx001',
      projectId: 'p002',
      dateTime: '2026-02-16',
      direction: 'IN',
      state: 'APPROVED',
      cashflowCategory: 'CONTRACT_PAYMENT',
      amounts: { bankAmount: 1000 },
    });

    const payload = await recomputeCashflowWeeks(db as any, 'mysc', '2026-02-20T00:00:00.000Z');

    expect(db.readCollections).toEqual(['orgs/mysc/cashflow_weeks']);
    expect(db.data.get('orgs/mysc/cashflow_weeks/p001-2026-02-w3')).toEqual(canonicalWeek);
    expect(db.data.has('orgs/mysc/cashflow_weeks/p002-2026-02-w3')).toBe(false);
    expect(payload).toEqual({
      tenantId: 'mysc',
      view: 'cashflow_weeks',
      updatedAt: '2026-02-20T00:00:00.000Z',
      observedWeeks: 1,
      syncedWeeks: 0,
      canonicalWriter: 'jvm_weekly_api',
      writeMode: 'metadata_only',
    });
    expect(db.data.get('orgs/mysc/views/cashflow_weeks')).toEqual(payload);
  });
});
