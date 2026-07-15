import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  buildProjectRegistrationCanonicalDocuments,
  buildProjectPatchFromChangeRequestPayload,
  formatProjectTypeSlackLabel,
  mergeProjectAndRequestDocs,
  mountProjectRoutes,
  readProjectRequestById,
  resolveProjectRequestDocuments,
  resolveProjectTeamMemberLookupKeys,
  tryEnsureProjectRootFolder,
  tryRenameManagedProjectRootFolder,
} from './projects.mjs';

const registrationV2AttachmentKinds = ['contract', 'customer_business_registration', 'quote', 'rfp_request_evidence'];

function registrationV2Payload(overrides: Record<string, unknown> = {}) {
  return {
    name: '다년도 사업',
    officialContractName: '2026 다년도 사업 운영 계약',
    clientOrg: '발주기관 주식회사',
    projectPurpose: '사내기업가 육성',
    description: '교육 운영 및 성과보고서 제출',
    groupwareName: '2026 다년도 사업',
    type: 'D1',
    status: 'CONTRACT_PENDING',
    department: 'AXR',
    registeredById: 'pm-a',
    registeredByName: 'PM A',
    executiveApproverId: 'head-a',
    executiveApproverName: '조직장 A',
    executiveApproverEmail: 'head-a@mysc.co.kr',
    managerId: 'pm-a',
    managerName: 'PM A',
    contractStart: '2026-01-01',
    contractEnd: '2027-12-31',
    contractAmount: 300_000,
    salesVatAmount: 30_000,
    totalRevenueAmount: 120_000,
    supportAmount: 10_000,
    settlementType: 'TYPE1',
    basis: '공급가액',
    settlementSystem: 'BOTAEM_E',
    laborSettlementBasis: 'INCLUDE_ACTUAL_SALARY',
    paymentPlan: { contract: 150_000, interim: 60_000, final: 90_000 },
    paymentExpectedMonths: { contract: '2026-01', interim: '2026-06', final: '2027-12' },
    advanceInterimBelow70Reason: '',
    teamMembersDetailed: [{
      memberName: '변민욱',
      memberNickname: '보람',
      role: '실무책임자',
      participationRate: 50,
      isDocumentOnly: true,
    }],
    financialInputFlags: {
      contractAmount: true,
      salesVatAmount: true,
      totalRevenueAmount: true,
      supportAmount: true,
    },
    registrationRequirementsVersion: 2,
    financialYears: [
      { year: 2026, contractAmount: 100_000, salesVatAmount: 10_000, totalRevenueAmount: 40_000, supportAmount: 0, profitRate: 0.4, confirmed: true },
      { year: 2027, contractAmount: 200_000, salesVatAmount: 20_000, totalRevenueAmount: 80_000, supportAmount: 10_000, profitRate: 0.4, confirmed: true },
    ],
    registrationConfirmations: {
      laborIncludesFourInsurance: true,
      laborIncludesRetirementPay: true,
      customerSettlementBasisConfirmed: true,
      modusignContractUsed: false,
      originalContractSubmitted: true,
    },
    registrationOptionalDocumentNotes: {
      proposalWordOriginal: '해당 없음',
      proposalPptOriginal: '해당 없음',
      presentationPptOriginal: '해당 없음',
    },
    ...overrides,
  };
}

function registrationV2Canonical(payload = registrationV2Payload(), requiredKinds = registrationV2AttachmentKinds) {
  return buildProjectRegistrationCanonicalDocuments({
    tenantId: 'mysc',
    projectId: 'project-v2',
    projectRequestId: 'request-v2',
    sourceDraftId: 'draft-v2',
    payload,
    attachmentRefs: [],
    requirementsAttachmentRefs: requiredKinds.map((documentKind) => ({
      documentKind,
      path: `orgs/mysc/project-registration-drafts/draft-v2/${documentKind}.pdf`,
      name: `${documentKind}.pdf`,
      size: 3,
      contentType: 'application/pdf',
    })),
    actorId: 'pm-a',
    actorName: 'PM A',
    actorEmail: 'pm-a@example.com',
    timestamp: '2026-07-14T00:00:00.000Z',
  });
}

describe('project route helpers', () => {
  it('builds a registration v2 canonical record only after all years, four attachments and confirmations pass', () => {
    const canonical = registrationV2Canonical();

    expect(canonical.projectRequest.payload).toMatchObject({
      registrationRequirementsVersion: 2,
      financialYears: [
        { year: 2026, confirmed: true, profitRate: 0.4 },
        { year: 2027, confirmed: true, profitRate: 0.4 },
      ],
      registrationConfirmations: {
        laborIncludesFourInsurance: true,
        laborIncludesRetirementPay: true,
        customerSettlementBasisConfirmed: true,
        modusignContractUsed: false,
        originalContractSubmitted: true,
      },
      registrationOptionalDocumentNotes: {
        proposalWordOriginal: '해당 없음',
        proposalPptOriginal: '해당 없음',
        presentationPptOriginal: '해당 없음',
      },
      groupwareName: '2026 다년도 사업',
      settlementSystem: 'BOTAEM_E',
      laborSettlementBasis: 'INCLUDE_ACTUAL_SALARY',
      paymentExpectedMonths: { contract: '2026-01', interim: '2026-06', final: '2027-12' },
      teamMembersDetailed: [{ role: '실무책임자', isDocumentOnly: true }],
    });
    expect(canonical.project.customerBusinessRegistrationDocument).toBeNull();
    expect(canonical.project).toMatchObject({
      registrationRequirementsVersion: 2,
      financialYears: [{ year: 2026, confirmed: true }, { year: 2027, confirmed: true }],
    });
  });

  it('requires either each optional original file or its explicit omission note', () => {
    expect(() => registrationV2Canonical(registrationV2Payload({
      registrationOptionalDocumentNotes: {
        proposalWordOriginal: '',
        proposalPptOriginal: '해당 없음',
        presentationPptOriginal: '해당 없음',
      },
    }))).toThrowError('Project registration optional attachment note is missing: proposal_word_original');

    expect(() => registrationV2Canonical(
      registrationV2Payload({
        registrationOptionalDocumentNotes: {
          proposalWordOriginal: '',
          proposalPptOriginal: '해당 없음',
          presentationPptOriginal: '해당 없음',
        },
      }),
      [...registrationV2AttachmentKinds, 'proposal_word_original'],
    )).not.toThrow();
  });

  it.each([undefined, 1])('rejects new canonical registration requirements version %s', (version) => {
    expect(() => registrationV2Canonical(registrationV2Payload({ registrationRequirementsVersion: version })))
      .toThrowError('New project registration requires requirements version 2');
  });

  it.each([
    ['ID', { executiveApproverId: '' }],
    ['name', { executiveApproverName: '' }],
  ])('rejects a registration without an executive approver %s', (_field, overrides) => {
    expect(() => registrationV2Canonical(registrationV2Payload(overrides)))
      .toThrowError('Project registration is missing required fields');
  });

  it('keeps legacy v1 team rows on the legacy path instead of applying v2 row rules', () => {
    expect(() => registrationV2Canonical(registrationV2Payload({
      registrationRequirementsVersion: 1,
      teamMembersDetailed: [{ memberName: '기존 담당자', role: 'PM', participationRate: 50 }],
    }))).toThrowError('New project registration requires requirements version 2');
  });

  it.each([
    ['groupware name', { groupwareName: '' }, 'Project registration groupwareName is required'],
    [
      'payment expected month',
      { paymentExpectedMonths: { contract: '', interim: '2026-06', final: '2027-12' } },
      'Project registration paymentExpectedMonths.contract is required',
    ],
    [
      'below 70 percent reason',
      {
        paymentPlan: { contract: 100_000, interim: 50_000, final: 150_000 },
        advanceInterimBelow70Reason: '',
      },
      'Project registration advance/interim below 70% reason is required',
    ],
    [
      'team role',
      { teamMembersDetailed: [{ memberName: '변민욱', role: 'PM', participationRate: 50, isDocumentOnly: false }] },
      'Project registration teamMembersDetailed.0.role is invalid',
    ],
    [
      'team document-only choice',
      { teamMembersDetailed: [{ memberName: '변민욱', role: '실무책임자', participationRate: 50 }] },
      'Project registration teamMembersDetailed.0.isDocumentOnly is required',
    ],
  ])('rejects registration v2 with incomplete %s', (_label, overrides, message) => {
    expect(() => registrationV2Canonical(registrationV2Payload(overrides))).toThrowError(message);
  });

  it('preserves version 1 compatibility for an existing-project change request', () => {
    const patch = buildProjectPatchFromChangeRequestPayload(
      registrationV2Payload({ registrationRequirementsVersion: 1 }),
      { id: 'existing-project', version: 3 },
    );

    expect(patch.registrationRequirementsVersion).toBe(1);
  });

  it.each(['pm', 'viewer'])('requires the private draft flow when %s creates a project directly', async (actorRole) => {
    const idempotencyService = {
      begin: vi.fn(async () => ({ mode: 'acquired', requestFingerprint: 'fingerprint-a' })),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const db = {
      doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: false, data: () => undefined })) })),
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.context = {
        tenantId: 'mysc',
        actorId: 'member-a',
        actorRole,
        actorEmail: 'member-a@example.com',
        requestId: 'request-a',
        idempotencyKey: `create-${actorRole}`,
      };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-14T00:00:00.000Z',
      idempotencyService,
    } as any);
    app.use((error: any, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
    });

    const response = await request(app).post('/api/v1/projects').send({ id: 'project-a', name: 'Project A' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('project_registration_draft_required');
    expect(idempotencyService.complete).not.toHaveBeenCalled();
  });

  it('applies checkout state and private evidence fields when a change request is approved', () => {
    const document = { path: 'orgs/mysc/project-registration-documents/project-v2/evidence.pdf', name: 'evidence.pdf' };
    const patch = buildProjectPatchFromChangeRequestPayload({
      ...registrationV2Payload(),
      status: 'COMPLETED',
      checkout: {
        finalPaymentReceived: true,
        bankBalanceZero: true,
        performanceCertificateReceived: true,
        taxInvoiceEvidenceConfirmed: true,
        finalSettlementReportConfirmed: true,
        usbEvidenceSubmitted: true,
        evidenceDeletedAfterUsb: true,
      },
      performanceCertificateDocument: document,
      taxInvoiceDocument: document,
      finalSettlementReportDocument: document,
    }, { id: 'project-v2' });

    expect(patch).toMatchObject({
      checkout: { usbEvidenceSubmitted: true, evidenceDeletedAfterUsb: true },
      performanceCertificateDocument: document,
      taxInvoiceDocument: document,
      finalSettlementReportDocument: document,
    });
  });

  it.each([
    [
      'one contract year is missing',
      registrationV2Payload({ financialYears: [
        { year: 2026, contractAmount: 300_000, salesVatAmount: 30_000, totalRevenueAmount: 120_000, supportAmount: 10_000, profitRate: 0.4, confirmed: true },
      ] }),
      registrationV2AttachmentKinds,
    ],
    [
      'annual totals do not match the canonical total',
      registrationV2Payload({ contractAmount: 300_001 }),
      registrationV2AttachmentKinds,
    ],
    [
      'annual profit rate is outside 0..1',
      registrationV2Payload({ financialYears: [
        { year: 2026, contractAmount: 100_000, salesVatAmount: 10_000, totalRevenueAmount: 40_000, supportAmount: 0, profitRate: 1.01, confirmed: true },
        { year: 2027, contractAmount: 200_000, salesVatAmount: 20_000, totalRevenueAmount: 80_000, supportAmount: 10_000, profitRate: 0.4, confirmed: true },
      ] }),
      registrationV2AttachmentKinds,
    ],
    [
      'customer business registration is missing',
      registrationV2Payload(),
      ['contract', 'quote', 'rfp_request_evidence'],
    ],
    [
      'original submission fallback is missing',
      registrationV2Payload({ registrationConfirmations: {
        laborIncludesFourInsurance: true,
        laborIncludesRetirementPay: true,
        customerSettlementBasisConfirmed: true,
        modusignContractUsed: false,
        originalContractSubmitted: false,
      } }),
      registrationV2AttachmentKinds,
    ],
  ])('rejects registration v2 when %s', (_label, payload, requiredKinds) => {
    let caught: unknown;
    try {
      registrationV2Canonical(payload, requiredKinds);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      statusCode: 422,
      code: 'project_registration_invalid',
    });
  });

  it('serves a canonical private attachment only through the authorized BFF route', async () => {
    const path = 'orgs/mysc/project-registration-documents/project-a/attachment-a-contract.pdf';
    const downloadProjectRegistrationAttachment = vi.fn(async () => ({
      buffer: Buffer.from('private-pdf'),
      contentType: 'application/pdf',
      size: 11,
    }));
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: vi.fn(async () => ({
          exists: true,
          data: () => documentPath.includes('/members/')
            ? { uid: 'admin-a', role: 'admin', status: 'ACTIVE', projectIds: [] }
            : {
                id: 'project-a',
                contractDocument: {
                  path,
                  name: '계약서"\r\nX-Test: injected.pdf',
                  contentType: 'application/pdf',
                },
              },
        })),
      })),
    };
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'admin-a', actorRole: 'admin' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);

    const response = await request(app).get('/api/v1/projects/project-a/attachments/contract');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain('%22%0D%0AX-Test%3A%20injected.pdf');
    expect(response.headers['x-test']).toBeUndefined();
    expect(response.body).toEqual(Buffer.from('private-pdf'));
    expect(downloadProjectRegistrationAttachment).toHaveBeenCalledWith({
      tenantId: 'mysc', projectId: 'project-a', path,
    });
  });

  it('denies an unassigned member using persisted access before reading attachment metadata', async () => {
    const projectGet = vi.fn(async () => ({
      exists: true,
      data: () => ({
        id: 'project-a',
        contractDocument: {
          path: 'orgs/mysc/project-registration-documents/project-a/contract.pdf',
          name: 'contract.pdf',
        },
      }),
    }));
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: documentPath.includes('/members/')
          ? vi.fn(async () => ({
              exists: true,
              data: () => ({ uid: 'pm-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-b'] }),
            }))
          : projectGet,
      })),
    };
    const downloadProjectRegistrationAttachment = vi.fn();
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'pm-a', actorRole: 'admin' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);
    app.use((error: any, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
    });

    const response = await request(app).get('/api/v1/projects/project-a/attachments/contract');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('forbidden');
    expect(projectGet).not.toHaveBeenCalled();
    expect(downloadProjectRegistrationAttachment).not.toHaveBeenCalled();
  });

  it('denies a persisted member document whose uid does not match the authenticated actor', async () => {
    const projectGet = vi.fn(async () => ({
      exists: true,
      data: () => ({
        id: 'project-a',
        contractDocument: {
          path: 'orgs/mysc/project-registration-documents/project-a/contract.pdf',
          name: 'contract.pdf',
        },
      }),
    }));
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: documentPath.includes('/members/')
          ? vi.fn(async () => ({
              exists: true,
              data: () => ({ uid: 'different-actor', role: 'admin', status: 'ACTIVE' }),
            }))
          : projectGet,
      })),
    };
    const downloadProjectRegistrationAttachment = vi.fn();
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'admin-a', actorRole: 'admin' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);
    app.use((error: any, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
    });

    const response = await request(app).get('/api/v1/projects/project-a/attachments/contract');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('forbidden');
    expect(projectGet).not.toHaveBeenCalled();
    expect(downloadProjectRegistrationAttachment).not.toHaveBeenCalled();
  });

  it('allows an ACTIVE PM assigned through the persisted portal profile', async () => {
    const path = 'orgs/mysc/project-registration-documents/project-a/contract.pdf';
    const downloadProjectRegistrationAttachment = vi.fn(async () => ({
      buffer: Buffer.from('assigned-private-pdf'), contentType: 'application/pdf', size: 20,
    }));
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: vi.fn(async () => ({
          exists: true,
          data: () => documentPath.includes('/members/')
            ? {
                uid: 'pm-a', role: 'pm', status: 'ACTIVE',
                portalProfile: { projectIds: ['project-a'] },
              }
            : { id: 'project-a', contractDocument: { path, name: 'contract.pdf' } },
        })),
      })),
    };
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'pm-a', actorRole: 'viewer' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);

    const response = await request(app).get('/api/v1/projects/project-a/attachments/contract');

    expect(response.status).toBe(200);
    expect(downloadProjectRegistrationAttachment).toHaveBeenCalledWith({
      tenantId: 'mysc', projectId: 'project-a', path,
    });
  });

  it('serves a pending project request attachment only to an active reviewer', async () => {
    const path = 'orgs/mysc/project-registration-documents/project-a/pending-contract.pdf';
    const downloadProjectRegistrationAttachment = vi.fn(async () => ({
      buffer: Buffer.from('pending-private-pdf'), contentType: 'application/pdf', size: 19,
    }));
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: vi.fn(async () => {
          if (documentPath.includes('/members/')) {
            return {
              exists: true,
              data: () => ({ uid: 'admin-a', role: 'admin', status: 'ACTIVE' }),
            };
          }
          if (documentPath.includes('/project_requests/')) {
            return {
              exists: true,
              data: () => ({
                id: 'change-project-a',
                status: 'PENDING',
                requestKind: 'CHANGE',
                targetProjectId: 'project-a',
                approvedProjectId: 'project-a',
                payload: {
                  contractDocument: { path, name: 'pending-contract.pdf', contentType: 'application/pdf' },
                },
              }),
            };
          }
          return { exists: false, data: () => null };
        }),
      })),
    };
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'admin-a', actorRole: 'admin' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);

    const response = await request(app)
      .get('/api/v1/project-requests/change-project-a/attachments/contract');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from('pending-private-pdf'));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(downloadProjectRegistrationAttachment).toHaveBeenCalledWith({
      tenantId: 'mysc', projectId: 'project-a', path,
    });
  });

  it('denies a PM before reading pending project request attachment metadata', async () => {
    const requestGet = vi.fn();
    const db = {
      doc: vi.fn((documentPath: string) => ({
        get: documentPath.includes('/members/')
          ? vi.fn(async () => ({
              exists: true,
              data: () => ({ uid: 'pm-a', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'] }),
            }))
          : requestGet,
      })),
    };
    const downloadProjectRegistrationAttachment = vi.fn();
    const app = express();
    app.use((req: any, _res, next) => {
      req.context = { tenantId: 'mysc', actorId: 'pm-a', actorRole: 'admin' };
      next();
    });
    mountProjectRoutes(app, {
      db,
      now: () => '2026-07-10T00:00:00.000Z',
      idempotencyService: {},
      projectRequestContractStorageService: { downloadProjectRegistrationAttachment },
    } as any);
    app.use((error: any, _req, res, _next) => {
      res.status(error.statusCode || 500).json({ error: error.code || 'internal_error' });
    });

    const response = await request(app)
      .get('/api/v1/project-requests/change-project-a/attachments/contract');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('forbidden');
    expect(requestGet).not.toHaveBeenCalled();
    expect(downloadProjectRegistrationAttachment).not.toHaveBeenCalled();
  });

  it('builds safe lookup keys when only nickname is present', () => {
    expect(resolveProjectTeamMemberLookupKeys({
      memberNickname: '보람',
      memberName: '',
    })).toEqual(['보람']);
  });

  it('formats project type labels for Slack with canonical dropdown labels', () => {
    expect(formatProjectTypeSlackLabel('D1')).toBe('D-1 개발협력사업 - AVPN 포함');
    expect(formatProjectTypeSlackLabel('I3')).toBe('I-3 투자조합운용 - LP수익');
    expect(formatProjectTypeSlackLabel('UNKNOWN')).toBe('D-1 개발협력사업 - AVPN 포함');
  });

  it('reads project request notifications from canonical project_requests before legacy path', async () => {
    const calls: string[] = [];
    const db = {
      doc: vi.fn((path: string) => {
        calls.push(path);
        return {
          get: vi.fn(async () => ({
            exists: path.includes('/project_requests/'),
            data: () => ({ approvedProjectId: 'p001', payload: { name: 'Canonical' } }),
          })),
        };
      }),
    };

    await expect(readProjectRequestById(db, 'mysc', 'pr001')).resolves.toMatchObject({
      id: 'pr001',
      approvedProjectId: 'p001',
      payload: { name: 'Canonical' },
    });
    expect(calls).toEqual(['orgs/mysc/project_requests/pr001']);
  });

  it('falls back to legacy projectRequests path for old project request notifications', async () => {
    const calls: string[] = [];
    const db = {
      doc: vi.fn((path: string) => {
        calls.push(path);
        return {
          get: vi.fn(async () => ({
            exists: path.includes('/projectRequests/'),
            data: () => ({ approvedProjectId: 'p002', payload: { name: 'Legacy' } }),
          })),
        };
      }),
    };

    await expect(readProjectRequestById(db, 'mysc', 'pr002')).resolves.toMatchObject({
      id: 'pr002',
      approvedProjectId: 'p002',
      payload: { name: 'Legacy' },
    });
    expect(calls).toEqual([
      'orgs/mysc/project_requests/pr002',
      'orgs/mysc/projectRequests/pr002',
    ]);
  });

  it('rejects stale explicit project request ids instead of creating a placeholder request', async () => {
    const db = {
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn(async () => ({ exists: false, data: () => null })),
      })),
    };

    await expect(resolveProjectRequestDocuments({
      db,
      tenantId: 'mysc',
      requestId: 'missing-request',
      projectId: 'p001',
    })).rejects.toMatchObject({
      statusCode: 404,
      code: 'not_found',
    });
    expect(db.doc).toHaveBeenCalledTimes(2);
  });

  it('rejects explicit project request ids that belong to another project', async () => {
    const db = {
      doc: vi.fn((path: string) => ({
        path,
        get: vi.fn(async () => ({
          exists: path.includes('/project_requests/'),
          data: () => ({ approvedProjectId: 'p-other', payload: { name: 'Wrong project' } }),
        })),
      })),
    };

    await expect(resolveProjectRequestDocuments({
      db,
      tenantId: 'mysc',
      requestId: 'pr001',
      projectId: 'p001',
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'request_project_mismatch',
    });
  });

  it('falls back to approvedProjectId lookup without requestedAt ordering for old request docs', async () => {
    const requestRef = { path: 'orgs/mysc/project_requests/pr001' };
    const orderedGet = vi.fn(async () => ({ empty: true, docs: [] }));
    const unorderedGet = vi.fn(async () => ({
      empty: false,
      docs: [{
        id: 'pr001',
        ref: requestRef,
        data: () => ({ approvedProjectId: 'p001', payload: { name: 'Legacy shape' } }),
      }],
    }));
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: orderedGet })) })),
      limit: vi.fn(() => ({ get: unorderedGet })),
    };
    const db = {
      collection: vi.fn(() => query),
      doc: vi.fn((path: string) => ({ path })),
    };

    await expect(resolveProjectRequestDocuments({
      db,
      tenantId: 'mysc',
      requestId: '',
      projectId: 'p001',
    })).resolves.toMatchObject({
      requestId: 'pr001',
      request: { approvedProjectId: 'p001', payload: { name: 'Legacy shape' } },
    });
    expect(orderedGet).toHaveBeenCalledTimes(1);
    expect(unorderedGet).toHaveBeenCalledTimes(1);
  });

  it('writes executive review project and request patches in one transaction', async () => {
    const projectRef = { path: 'orgs/mysc/projects/p001' };
    const requestRef = { path: 'orgs/mysc/project_requests/pr001' };
    const tx = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({
          id: 'p001',
          version: 2,
          createdAt: '2026-05-01T00:00:00.000Z',
          createdBy: 'pm-1',
          executiveReviewStatus: 'PENDING',
        }),
      })),
      set: vi.fn(),
    };
    const db = {
      doc: vi.fn(() => projectRef),
      runTransaction: vi.fn(async (handler) => handler(tx)),
    };

    const result = await mergeProjectAndRequestDocs({
      db,
      projectPath: 'orgs/mysc/projects/p001',
      buildProjectPatch: () => ({ executiveReviewStatus: 'APPROVED' }),
      buildRequestPatch: () => ({ status: 'APPROVED', approvedProjectId: 'p001' }),
      requestRefs: [requestRef],
      tenantId: 'mysc',
      actorId: 'admin-1',
      now: '2026-05-20T00:00:00.000Z',
      notFoundMessage: 'Project not found: p001',
    });

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(tx.set).toHaveBeenNthCalledWith(1, projectRef, expect.objectContaining({
      executiveReviewStatus: 'APPROVED',
      version: 3,
      updatedBy: 'admin-1',
    }), { merge: true });
    expect(tx.set).toHaveBeenNthCalledWith(2, requestRef, {
      status: 'APPROVED',
      approvedProjectId: 'p001',
    }, { merge: true });
    expect(result).toMatchObject({ version: 3, data: { executiveReviewStatus: 'APPROVED' } });
  });

  it('rejects a stale change request inside the executive approval transaction', async () => {
    const projectRef = { path: 'orgs/mysc/projects/p001' };
    const requestRef = { path: 'orgs/mysc/project_requests/change-p001' };
    const tx = {
      get: vi.fn(async (ref: { path: string }) => ref.path.includes('/projects/')
        ? { exists: true, data: () => ({ id: 'p001', version: 5 }) }
        : {
            exists: true,
            data: () => ({
              id: 'change-p001', requestKind: 'CHANGE', status: 'PENDING',
              baseProjectVersion: 3, targetProjectVersion: 4,
            }),
          }),
      set: vi.fn(),
    };
    const db = {
      doc: vi.fn(() => projectRef),
      runTransaction: vi.fn(async (handler) => handler(tx)),
    };

    await expect(mergeProjectAndRequestDocs({
      db,
      projectPath: projectRef.path,
      buildProjectPatch: () => ({ executiveReviewStatus: 'APPROVED' }),
      buildRequestPatch: () => ({ status: 'APPROVED' }),
      requestRefs: [requestRef],
      enforceChangeRequestVersion: true,
      tenantId: 'mysc',
      actorId: 'admin-1',
      now: '2026-07-12T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 409, code: 'canonical_version_conflict' });
    expect(tx.get).toHaveBeenCalledWith(requestRef);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('records the post-approval canonical version after a current change request is approved', async () => {
    const projectRef = { path: 'orgs/mysc/projects/p001' };
    const requestRef = { path: 'orgs/mysc/project_requests/change-p001' };
    const missingMirrorRef = { path: 'orgs/mysc/projectRequests/change-p001' };
    const tx = {
      get: vi.fn(async (ref: { path: string }) => ref.path.includes('/projects/')
        ? { exists: true, data: () => ({ id: 'p001', version: 4 }) }
        : ref === missingMirrorRef
          ? { exists: false, data: () => null }
        : {
            exists: true,
            data: () => ({
              id: 'change-p001', requestKind: 'CHANGE', status: 'PENDING',
              baseProjectVersion: 3, targetProjectVersion: 4,
            }),
          }),
      set: vi.fn(),
    };
    const db = {
      doc: vi.fn(() => projectRef),
      runTransaction: vi.fn(async (handler) => handler(tx)),
    };

    const result = await mergeProjectAndRequestDocs({
      db,
      projectPath: projectRef.path,
      buildProjectPatch: () => ({ executiveReviewStatus: 'APPROVED' }),
      buildRequestPatch: (_project, _request, nextVersion) => ({
        status: 'APPROVED', approvedProjectVersion: nextVersion,
      }),
      requestRefs: [requestRef, missingMirrorRef],
      enforceChangeRequestVersion: true,
      tenantId: 'mysc',
      actorId: 'admin-1',
      now: '2026-07-12T00:00:00.000Z',
    });

    expect(result.version).toBe(5);
    expect(tx.set).toHaveBeenCalledTimes(2);
    expect(tx.set).toHaveBeenNthCalledWith(2, requestRef, {
      status: 'APPROVED', approvedProjectVersion: 5,
    }, { merge: true });
    expect(tx.set).not.toHaveBeenCalledWith(missingMirrorRef, expect.anything(), expect.anything());
  });

  it('fails closed when duplicate request collections both exist during approval', async () => {
    const projectRef = { path: 'orgs/mysc/projects/p001' };
    const requestRefs = [
      { path: 'orgs/mysc/project_requests/change-p001' },
      { path: 'orgs/mysc/projectRequests/change-p001' },
    ];
    const tx = {
      get: vi.fn(async (ref: { path: string }) => ref.path.includes('/projects/')
        ? { exists: true, data: () => ({ id: 'p001', version: 4 }) }
        : {
            exists: true,
            data: () => ({
              id: 'change-p001', requestKind: 'CHANGE', status: 'PENDING',
              baseProjectVersion: 3, targetProjectVersion: 4,
            }),
          }),
      set: vi.fn(),
    };
    const db = {
      doc: vi.fn(() => projectRef),
      runTransaction: vi.fn(async (handler) => handler(tx)),
    };

    await expect(mergeProjectAndRequestDocs({
      db,
      projectPath: projectRef.path,
      buildProjectPatch: () => ({ executiveReviewStatus: 'APPROVED' }),
      buildRequestPatch: () => ({ status: 'APPROVED' }),
      requestRefs,
      enforceChangeRequestVersion: true,
      tenantId: 'mysc',
      actorId: 'admin-1',
      now: '2026-07-12T00:00:00.000Z',
    })).rejects.toMatchObject({ statusCode: 409, code: 'request_collection_conflict' });
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('builds safe lookup keys when only name is present', () => {
    expect(resolveProjectTeamMemberLookupKeys({
      memberNickname: '',
      memberName: '변민욱',
    })).toEqual(['변민욱']);
  });

  it('does not fail project save flow when managed Drive root rename throws', async () => {
    const logger = { error: vi.fn() };
    const driveService = {
      renameManagedProjectRootFolder: vi.fn(async () => {
        throw new Error('drive unavailable');
      }),
    };

    await expect(tryRenameManagedProjectRootFolder({
      driveService,
      projectId: 'p001',
      projectName: 'Updated Name',
      existingFolderId: 'folder-001',
      logger,
    })).resolves.toBeNull();

    expect(driveService.renameManagedProjectRootFolder).toHaveBeenCalledWith({
      projectId: 'p001',
      projectName: 'Updated Name',
      existingFolderId: 'folder-001',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not fail project save flow when managed Drive root provision throws', async () => {
    const logger = { error: vi.fn() };
    const driveService = {
      ensureProjectRootFolder: vi.fn(async () => {
        throw new Error('drive unavailable');
      }),
    };

    await expect(tryEnsureProjectRootFolder({
      driveService,
      tenantId: 'mysc',
      projectId: 'p001',
      projectName: 'Created Project',
      existingFolderId: '',
      logger,
    })).resolves.toBeNull();

    expect(driveService.ensureProjectRootFolder).toHaveBeenCalledWith({
      tenantId: 'mysc',
      projectId: 'p001',
      projectName: 'Created Project',
      existingFolderId: '',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
