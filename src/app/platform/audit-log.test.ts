import { describe, expect, it } from 'vitest';
import { createAuditLogEntry, generateAuditLogId } from './audit-log';

describe('audit-log helpers', () => {
  it('generates stable audit log id prefix', () => {
    const id = generateAuditLogId('2026-02-14T09:30:00.000Z');
    expect(id).toMatch(/^al_20260214093000_/);
  });

  it('creates normalized audit log entries', () => {
    const entry = createAuditLogEntry({
      tenantId: 'mysc',
      entityType: 'project',
      entityId: 'p001',
      action: 'UPDATE',
      details: '프로젝트 수정',
      actor: { id: 'u001', name: '관리자', role: 'admin' },
      requestId: 'req-1',
      timestamp: '2026-02-14T09:30:00.000Z',
    });

    expect(entry).toMatchObject({
      tenantId: 'mysc',
      entityType: 'project',
      entityId: 'p001',
      action: 'UPDATE',
      userId: 'u001',
      userName: '관리자',
      userRole: 'admin',
      requestId: 'req-1',
      timestamp: '2026-02-14T09:30:00.000Z',
    });
  });
});
