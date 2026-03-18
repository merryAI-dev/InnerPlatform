import { describe, expect, it } from 'vitest';
import { buildNotificationId, buildTransactionStateNotificationDoc } from './notifications.mjs';

describe('notifications helpers', () => {
  it('builds deterministic notification ids per event+recipient', () => {
    const a = buildNotificationId({ eventId: 'ob_001', recipientId: 'u1' });
    const b = buildNotificationId({ eventId: 'ob_001', recipientId: 'u1' });
    const c = buildNotificationId({ eventId: 'ob_001', recipientId: 'u2' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('ntf_')).toBe(true);
  });

  it('renders transaction state notifications with correct severity and reason', () => {
    const doc = buildTransactionStateNotificationDoc({
      tenantId: 'mysc',
      nowIso: '2026-02-15T00:00:00.000Z',
      event: {
        id: 'ob_001',
        createdAt: '2026-02-15T00:00:00.000Z',
        eventType: 'transaction.state_changed',
        entityId: 'tx1',
        payload: { nextState: 'REJECTED', reason: '증빙 누락', actorId: 'a1', actorRole: 'finance' },
      },
      tx: {
        id: 'tx1',
        projectId: 'p1',
        ledgerId: 'l1',
        counterparty: '거래처',
        amounts: { bankAmount: 1234 },
      },
      recipientId: 'u1',
      recipientRole: 'pm',
    });

    expect(doc.severity).toBe('critical');
    expect(doc.title).toContain('반려');
    expect(doc.description).toContain('증빙 누락');
    expect(doc.recipientId).toBe('u1');
    expect(doc.projectId).toBe('p1');
  });
});

