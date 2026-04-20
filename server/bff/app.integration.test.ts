import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createBffApp } from './app.mjs';
import { createFirestoreDb } from './firestore.mjs';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeIfEmulator('BFF integration (Firestore emulator)', () => {
  const projectId = 'demo-bff-it';
  const tenantId = 'mysc';
  const actorId = 'u001';
  const workerSecret = 'it-worker-secret';
  const defaultHeaders = {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': 'admin',
  };

  const db = createFirestoreDb({ projectId });
  const app = createBffApp({ projectId, workerSecret });
  const api = request(app);

  function parseBinaryResponse(res: any, callback: (err: Error | null, body?: Buffer) => void) {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    res.on('end', () => callback(null, Buffer.concat(chunks)));
    res.on('error', callback);
  }

  async function downloadCashflowExport(body: Record<string, unknown>) {
    return api
      .post('/api/v1/cashflow-exports')
      .set({
        ...defaultHeaders,
        'idempotency-key': `idem-cashflow-export-${Math.random().toString(16).slice(2)}`,
      })
      .buffer(true)
      .parse(parseBinaryResponse)
      .send(body);
  }

  async function readWorkbook(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  async function clearCollection(path: string): Promise<void> {
    const snap = await db.collection(path).get();
    if (snap.empty) return;

    const chunks: Array<typeof snap.docs> = [];
    for (let i = 0; i < snap.docs.length; i += 400) {
      chunks.push(snap.docs.slice(i, i + 400));
    }

    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  async function resetTenantData(): Promise<void> {
    const collections = [
      'projects',
      'ledgers',
      'transactions',
      'comments',
      'evidences',
      'client_error_events',
      'audit_logs',
      'audit_chain',
      'change_events',
      'views',
      'members',
      'cashflow_weeks',
      'outbox_deliveries',
      'idempotency_keys',
      'relation_rules',
    ];

    for (const collectionName of collections) {
      await clearCollection(`orgs/${tenantId}/${collectionName}`);
    }

    await clearCollection('outbox');
    await clearCollection('work_queue');
  }

  beforeAll(async () => {
    await resetTenantData();
  });

  beforeEach(async () => {
    await resetTenantData();
  });

  afterAll(async () => {
    await resetTenantData();
  });

  it('returns health metadata', async () => {
    const response = await api.get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.projectId).toBe(projectId);
  });

  it('ingests client error events into Firestore', async () => {
    const response = await api
      .post('/api/v1/client-errors')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-client-error-001' })
      .send({
        eventType: 'exception',
        message: 'Portal projects listen failed',
        name: 'FirebaseError',
        stack: 'Error: Portal projects listen failed',
        level: 'error',
        source: 'portal_store',
        route: '/portal/project-settings',
        href: 'https://inner-platform.vercel.app/portal/project-settings',
        clientRequestId: 'ui_req_001',
        tags: {
          action: 'projects_listen',
        },
        extra: {
          requestId: 'req_001',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.id).toMatch(/^cerr_/);

    const stored = await db.doc(`orgs/${tenantId}/client_error_events/${response.body.id}`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      tenantId,
      actorId,
      source: 'portal_store',
      message: 'Portal projects listen failed',
      clientRequestId: 'ui_req_001',
    });
  });

  it('delivers project registration Slack notifications for stored project requests', async () => {
    const projectRegistrationSlackService = {
      enabled: true,
      notifyMessage: vi.fn(async () => {}),
    };
    const notifyApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      projectRegistrationSlackService,
    }));

    await db.doc(`orgs/${tenantId}/projectRequests/pr_notify_001`).set({
      id: 'pr_notify_001',
      tenantId,
      status: 'APPROVED',
      approvedProjectId: 'p_notify_001',
      requestedByName: '보람',
      requestedByEmail: 'boram@example.com',
      payload: {
        name: '2026 CTS2',
        officialContractName: 'CTS 역량강화 사업',
        clientOrg: 'CTS',
        department: '개발협력센터',
        managerName: '보람',
        teamName: 'AXR팀',
        contractStart: '2026-04-01',
        contractEnd: '2026-12-31',
        contractAmount: 120000000,
        projectPurpose: '역량강화 교육 운영',
      },
      createdAt: '2026-03-31T10:00:00.000Z',
      updatedAt: '2026-03-31T10:00:00.000Z',
    }, { merge: true });

    const response = await notifyApi
      .post('/api/v1/project-requests/pr_notify_001/notify-registration')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-request-notify-001' })
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      enabled: true,
      delivered: true,
      requestId: 'pr_notify_001',
      projectId: 'p_notify_001',
    });
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledTimes(1);
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('2026 CTS2'),
    }));
  });

  it('allows executive review reversal, appends history, and posts Slack on rejection', async () => {
    const projectRegistrationSlackService = {
      enabled: true,
      notifyMessage: vi.fn(async () => {}),
    };
    const reviewApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      projectRegistrationSlackService,
    }));

    await db.doc(`orgs/${tenantId}/projects/p_exec_review_001`).set({
      id: 'p_exec_review_001',
      tenantId,
      name: '네팔 귀환노동자 재정착 사업',
      registrationSource: 'pm_portal',
      executiveReviewStatus: 'APPROVED',
      executiveReviewedAt: '2026-04-20T09:00:00.000Z',
      executiveReviewedById: 'u-old',
      executiveReviewedByName: '임원A',
      executiveReviewComment: '초안 승인',
      executiveReviewHistory: [
        {
          status: 'APPROVED',
          previousStatus: 'PENDING',
          reviewedAt: '2026-04-20T09:00:00.000Z',
          reviewedById: 'u-old',
          reviewedByName: '임원A',
          reviewComment: '초안 승인',
        },
      ],
      createdAt: '2026-04-20T08:00:00.000Z',
      updatedAt: '2026-04-20T09:00:00.000Z',
    }, { merge: true });

    await db.doc(`orgs/${tenantId}/project_requests/pr_exec_review_001`).set({
      id: 'pr_exec_review_001',
      tenantId,
      status: 'APPROVED',
      approvedProjectId: 'p_exec_review_001',
      requestedByName: '변민욱',
      requestedByEmail: 'boram@example.com',
      payload: {
        name: '네팔 귀환노동자 재정착 사업',
        officialContractName: '네팔 귀환노동자 재정착 사업',
        clientOrg: 'KOICA',
        department: 'CIC1',
        managerName: '변민욱',
        teamName: 'AXR팀',
      },
      createdAt: '2026-04-20T08:00:00.000Z',
      updatedAt: '2026-04-20T09:00:00.000Z',
    }, { merge: true });

    const response = await reviewApi
      .post('/api/v1/projects/p_exec_review_001/executive-review')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-executive-review-001' })
      .send({
        requestId: 'pr_exec_review_001',
        reviewStatus: 'REVISION_REJECTED',
        reviewComment: '예산 산출 근거 보완 필요',
        reviewerName: '임원B',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      projectId: 'p_exec_review_001',
      requestId: 'pr_exec_review_001',
      reviewStatus: 'REVISION_REJECTED',
      slackDelivered: true,
    });

    const projectSnap = await db.doc(`orgs/${tenantId}/projects/p_exec_review_001`).get();
    expect(projectSnap.exists).toBe(true);
    expect(projectSnap.data()).toMatchObject({
      executiveReviewStatus: 'REVISION_REJECTED',
      executiveReviewedByName: '임원B',
      executiveReviewComment: '예산 산출 근거 보완 필요',
    });
    expect(projectSnap.data()?.executiveReviewHistory).toHaveLength(2);
    expect(projectSnap.data()?.executiveReviewHistory?.[1]).toMatchObject({
      status: 'REVISION_REJECTED',
      previousStatus: 'APPROVED',
      reviewedByName: '임원B',
      reviewComment: '예산 산출 근거 보완 필요',
    });

    const requestSnap = await db.doc(`orgs/${tenantId}/project_requests/pr_exec_review_001`).get();
    expect(requestSnap.exists).toBe(true);
    expect(requestSnap.data()).toMatchObject({
      status: 'REJECTED',
      reviewOutcome: 'REVISION_REJECTED',
      reviewedByName: '임원B',
      rejectedReason: '예산 산출 근거 보완 필요',
    });
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('수정 요청 후 반려'),
    }));
  });

  it('requires a rejection reason for executive rejection and discard', async () => {
    const reviewApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
    }));

    await db.doc(`orgs/${tenantId}/projects/p_exec_review_002`).set({
      id: 'p_exec_review_002',
      tenantId,
      name: '사유 필수 테스트',
      registrationSource: 'pm_portal',
      createdAt: '2026-04-20T08:00:00.000Z',
      updatedAt: '2026-04-20T08:00:00.000Z',
    }, { merge: true });

    const response = await reviewApi
      .post('/api/v1/projects/p_exec_review_002/executive-review')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-executive-review-002' })
      .send({
        reviewStatus: 'REVISION_REJECTED',
        reviewerName: '임원B',
      });

    expect(response.status).toBe(400);
    expect(response.body?.error || response.text).toMatch(/reviewComment/i);
  });

  it('resubmits an executive-rejected pm portal project back to pending', async () => {
    const reviewApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
    }));

    await db.doc(`orgs/${tenantId}/projects/p_exec_review_003`).set({
      id: 'p_exec_review_003',
      tenantId,
      name: '재제출 테스트 사업',
      registrationSource: 'pm_portal',
      executiveReviewStatus: 'REVISION_REJECTED',
      executiveReviewedAt: '2026-04-20T09:00:00.000Z',
      executiveReviewedById: 'u-old',
      executiveReviewedByName: '임원A',
      executiveReviewComment: '계약서 다시 올려 주세요',
      executiveReviewHistory: [
        {
          status: 'REVISION_REJECTED',
          previousStatus: 'APPROVED',
          reviewedAt: '2026-04-20T09:00:00.000Z',
          reviewedById: 'u-old',
          reviewedByName: '임원A',
          reviewComment: '계약서 다시 올려 주세요',
        },
      ],
      contractDocument: {
        path: 'orgs/mysc/project-request-contracts/u-old/contract.pdf',
        name: '재제출_계약서.pdf',
        downloadURL: 'https://example.com/recontract.pdf',
        size: 2345,
        contentType: 'application/pdf',
        uploadedAt: '2026-04-20T08:00:00.000Z',
      },
      createdAt: '2026-04-20T08:00:00.000Z',
      updatedAt: '2026-04-20T09:00:00.000Z',
    }, { merge: true });

    await db.doc(`orgs/${tenantId}/project_requests/pr_exec_review_003`).set({
      id: 'pr_exec_review_003',
      tenantId,
      status: 'REJECTED',
      reviewOutcome: 'REVISION_REJECTED',
      approvedProjectId: 'p_exec_review_003',
      rejectedReason: '계약서 다시 올려 주세요',
      payload: {
        name: '재제출 테스트 사업',
        officialContractName: '재제출 테스트 사업',
        clientOrg: 'KOICA',
        department: 'CIC1',
        managerName: '변민욱',
        teamName: 'AXR팀',
        contractDocument: {
          path: 'orgs/mysc/project-request-contracts/u-old/contract.pdf',
          name: '재제출_계약서.pdf',
          downloadURL: 'https://example.com/recontract.pdf',
          size: 2345,
          contentType: 'application/pdf',
          uploadedAt: '2026-04-20T08:00:00.000Z',
        },
        contractAnalysis: {
          provider: 'heuristic',
          model: 'fallback',
          summary: '기존 분석',
          warnings: [],
          nextActions: [],
          extractedAt: '2026-04-20T08:01:00.000Z',
          fields: {},
        },
      },
      createdAt: '2026-04-20T08:00:00.000Z',
      updatedAt: '2026-04-20T09:00:00.000Z',
    }, { merge: true });

    const response = await reviewApi
      .post('/api/v1/projects/p_exec_review_003/executive-review/resubmit')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-executive-review-003-resubmit' })
      .send({
        requestId: 'pr_exec_review_003',
        reviewComment: '계약서 보완 후 다시 제출',
        reviewerName: '변민욱',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      projectId: 'p_exec_review_003',
      requestId: 'pr_exec_review_003',
      reviewStatus: 'PENDING',
    });
  });

  it('persists explicit zero contract amounts through project upsert', async () => {
    const response = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-zero-contract-001' })
      .send({
        id: 'p-zero-contract-001',
        name: 'Zero Contract Project',
        contractAmount: 0,
      });

    expect([200, 201]).toContain(response.status);

    const stored = await db.doc(`orgs/${tenantId}/projects/p-zero-contract-001`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      id: 'p-zero-contract-001',
      name: 'Zero Contract Project',
      contractAmount: 0,
    });
  });

  it('delivers project registration Slack notifications only for PM portal-created projects', async () => {
    const projectRegistrationSlackService = {
      enabled: true,
      notifyMessage: vi.fn(async () => {}),
    };
    const projectsApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      projectRegistrationSlackService,
    }));

    const adminCreated = await projectsApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-slack-001' })
      .send({
        id: 'p-slack-create-admin-001',
        name: 'Admin Create Project',
        type: 'I1',
        department: '투자센터',
        managerName: '보람',
        contractAmount: 0,
        financialInputFlags: { contractAmount: false },
      });

    expect(adminCreated.status).toBe(201);
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledTimes(0);

    const pmCreated = await projectsApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-slack-002' })
      .send({
        id: 'p-slack-create-pm-001',
        name: 'PM Portal Create Project',
        type: 'I1',
        department: '투자센터',
        managerName: '보람',
        contractAmount: 0,
        financialInputFlags: { contractAmount: false },
        registrationSource: 'pm_portal',
      });

    expect(pmCreated.status).toBe(201);
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledTimes(1);
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('PM Portal Create Project'),
      blocks: expect.any(Array),
    }));

    const updated = await projectsApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-slack-003' })
      .send({
        id: 'p-slack-create-pm-001',
        name: 'PM Portal Create Project Updated',
        type: 'I1',
        expectedVersion: 1,
        registrationSource: 'pm_portal',
      });

    expect(updated.status).toBe(200);
    expect(projectRegistrationSlackService.notifyMessage).toHaveBeenCalledTimes(1);
  });

  it('previews google sheet rows for an existing project', async () => {
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async ({ value, sheetName }) => ({
        spreadsheetId: 'sheet-001',
        spreadsheetTitle: '주간 사업비 시트',
        selectedSheetName: sheetName || '주간정산',
        availableSheets: [
          { sheetId: 0, title: '요약', index: 0 },
          { sheetId: 1, title: '주간정산', index: 1 },
        ],
        matrix: [
          ['작성자', '거래일시', '지급처'],
          ['홍길동', '2026-03-12', '카페 메리'],
        ],
      })),
    };
    const sheetsApi = request(createBffApp({ projectId, workerSecret, db, googleSheetsService }));

    await sheetsApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-sheets-001' })
      .send({ id: 'p-sheets-001', name: 'Sheets Project' });

    const preview = await sheetsApi
      .post('/api/v1/projects/p-sheets-001/google-sheet-import/preview')
      .set({
        ...defaultHeaders,
        'x-google-access-token': 'google-token-123',
        'idempotency-key': 'idem-google-sheet-preview-001',
      })
      .send({ value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit#gid=1' });

    expect(preview.status).toBe(200);
    expect(preview.body.spreadsheetTitle).toBe('주간 사업비 시트');
    expect(preview.body.selectedSheetName).toBe('주간정산');
    expect(preview.body.matrix[1]).toEqual(['홍길동', '2026-03-12', '카페 메리']);
    expect(googleSheetsService.previewSpreadsheet).toHaveBeenCalledWith({
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit#gid=1',
      sheetName: undefined,
      accessToken: 'google-token-123',
    });
  });

  it('analyzes google sheet migration guidance for an existing project', async () => {
    const googleSheetMigrationAiService = {
      analyzePreview: vi.fn(async ({ spreadsheetTitle, selectedSheetName, matrix }) => ({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        summary: `${spreadsheetTitle}의 ${selectedSheetName} 탭은 사용내역으로 보입니다.`,
        confidence: 'high',
        likelyTarget: 'expense_sheet',
        usageTips: ['비목/세목 컬럼을 먼저 확인하세요.'],
        warnings: ['2줄 헤더 여부를 확인하세요.'],
        nextActions: ['표본 3행을 먼저 검증하세요.'],
        suggestedMappings: [
          {
            sourceHeader: '입금합계 > 입금액',
            platformField: '입금합계/입금액',
            confidence: 'high',
            reason: '입금 금액 그룹으로 보입니다.',
          },
        ],
        headerPreview: ['작성자', '입금합계 > 입금액'],
      })),
    };
    const analysisApi = request(createBffApp({ projectId, workerSecret, db, googleSheetMigrationAiService }));

    await analysisApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-sheets-002' })
      .send({ id: 'p-sheets-002', name: 'Sheets Analysis Project' });

    const analysis = await analysisApi
      .post('/api/v1/projects/p-sheets-002/google-sheet-import/analyze')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-google-sheet-analyze-001' })
      .send({
        spreadsheetTitle: '2026 사업비 관리 시트',
        selectedSheetName: '사용내역',
        matrix: [
          ['작성자', '입금합계', '사업팀'],
          ['No.', '입금액', '지급처'],
        ],
      });

    expect(analysis.status).toBe(200);
    expect(analysis.body.likelyTarget).toBe('expense_sheet');
    expect(analysis.body.usageTips[0]).toContain('비목/세목');
    expect(googleSheetMigrationAiService.analyzePreview).toHaveBeenCalledWith({
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: '사용내역',
      matrix: [
        ['작성자', '입금합계', '사업팀'],
        ['No.', '입금액', '지급처'],
      ],
    });
  });

  it('uploads and persists project sheet source snapshots for an existing project', async () => {
    const projectSheetSourceStorageService = {
      uploadSource: vi.fn(async () => ({
        path: 'orgs/mysc/project-sheet-sources/p-source-001/usage/123-환경AC.xlsx',
        name: '환경AC.xlsx',
        downloadURL: 'https://example.com/source.xlsx',
        size: 1024,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uploadedAt: '2026-03-19T12:00:00.000Z',
      })),
    };
    const sourceApi = request(createBffApp({ projectId, workerSecret, db, projectSheetSourceStorageService }));

    await sourceApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-source-001' })
      .send({ id: 'p-source-001', name: 'Source Project' });

    const upload = await sourceApi
      .post('/api/v1/projects/p-source-001/sheet-sources/upload')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-sheet-source-upload-001' })
      .send({
        sourceType: 'usage',
        sheetName: '사용내역',
        fileName: '환경AC.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 1024,
        contentBase64: 'ZmFrZS14bHN4',
        rowCount: 176,
        columnCount: 27,
        matchedColumns: ['작성자', '비목'],
        unmatchedColumns: ['정산증빙자료 부착완료 여부'],
        previewMatrix: [
          ['작성자', '비목'],
          ['메리', '여비'],
        ],
        applyTarget: 'expense_sheet',
      });

    expect(upload.status).toBe(200);
    expect(projectSheetSourceStorageService.uploadSource).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      actorId,
      projectId: 'p-source-001',
      sourceType: 'usage',
      fileName: '환경AC.xlsx',
    }));
    expect(upload.body.sourceType).toBe('usage');
    expect(upload.body.previewMatrix[1]).toEqual(['메리', '여비']);

    const snap = await db.doc(`orgs/${tenantId}/projects/p-source-001/sheet_sources/usage`).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.sheetName).toBe('사용내역');
    expect(snap.data()?.applyTarget).toBe('expense_sheet');
  });

  it('allows viewer role to process project request contract uploads', async () => {
    const projectRequestContractStorageService = {
      uploadContract: vi.fn(async ({ fileName, mimeType, fileSize }) => ({
        path: `orgs/${tenantId}/project-request-contracts/${actorId}/${fileName}`,
        name: fileName,
        downloadURL: `https://example.com/contracts/${encodeURIComponent(fileName)}`,
        size: fileSize,
        contentType: mimeType,
        uploadedAt: '2026-03-23T08:40:00.000Z',
      })),
    };
    const projectRequestContractAiService = {
      analyzeContract: vi.fn(async ({ fileName, documentText }) => ({
        provider: 'heuristic',
        model: 'deterministic-fallback',
        summary: `${fileName} 요약`,
        warnings: [],
        nextActions: [],
        extractedAt: '2026-03-23T08:40:00.000Z',
        fields: {
          officialContractName: { value: '공식 계약명', confidence: 'medium', evidence: documentText || fileName },
          suggestedProjectName: { value: '신규 사업', confidence: 'medium', evidence: fileName },
          clientOrg: { value: '발주처', confidence: 'low', evidence: '' },
          projectPurpose: { value: '', confidence: 'low', evidence: '' },
          description: { value: '', confidence: 'low', evidence: '' },
          contractStart: { value: '', confidence: 'low', evidence: '' },
          contractEnd: { value: '', confidence: 'low', evidence: '' },
          contractAmount: { value: null, confidence: 'low', evidence: '' },
          salesVatAmount: { value: null, confidence: 'low', evidence: '' },
        },
      })),
    };
    const contractApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      projectRequestContractStorageService,
      projectRequestContractAiService,
    }));

    const upload = await contractApi
      .post('/api/v1/project-requests/contract/process')
      .set({
        ...defaultHeaders,
        'x-actor-role': 'viewer',
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('viewer-contract.pdf'),
        'x-file-type': 'application/pdf',
        'x-file-size': '9',
        'idempotency-key': 'idem-project-request-contract-001',
      })
      .send(Buffer.from('%PDF-test'));

    expect(upload.status).toBe(200);
    expect(upload.body.contractDocument.name).toBe('viewer-contract.pdf');
    expect(upload.body.analysis.fields.officialContractName.value).toBe('공식 계약명');
    expect(projectRequestContractStorageService.uploadContract).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      actorId,
      fileName: 'viewer-contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 9,
    }));
    expect(projectRequestContractAiService.analyzeContract).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'viewer-contract.pdf',
    }));
  });

  it('rejects disallowed CORS origin', async () => {
    const corsApi = request(createBffApp({
      projectId,
      allowedOrigins: 'http://localhost:5173',
    }));

    const denied = await corsApi
      .get('/api/v1/health')
      .set('origin', 'https://evil.example.com');

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('origin_not_allowed');
  });

  it('enforces firebase_required auth mode and blocks header spoofing', async () => {
    const verifier = vi.fn(async (token: string) => {
      if (token !== 'valid-token') {
        throw new Error('invalid token');
      }
      return {
        uid: actorId,
        email: 'admin@mysc.co.kr',
        role: 'admin',
        tenantId,
      };
    });

    const secureApi = request(createBffApp({
      projectId,
      authMode: 'firebase_required',
      tokenVerifier: verifier,
    }));

    const missingToken = await secureApi
      .get('/api/v1/projects')
      .set(defaultHeaders);

    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error).toBe('missing_bearer_token');

    const ok = await secureApi
      .get('/api/v1/projects')
      .set({ ...defaultHeaders, authorization: 'Bearer valid-token' });

    expect(ok.status).toBe(200);

    const spoofed = await secureApi
      .get('/api/v1/projects')
      .set({
        ...defaultHeaders,
        'x-actor-id': 'spoofed-user',
        authorization: 'Bearer valid-token',
      });

    expect(spoofed.status).toBe(403);
    expect(spoofed.body.error).toBe('actor_mismatch');
  });

  it('handles project upsert idempotency and version conflicts', async () => {
    const createPayload = {
      id: 'p-bff-001',
      name: 'BFF Integration Project',
      slug: 'bff-integration-project',
      status: 'IN_PROGRESS',
    };

    const first = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send(createPayload);

    expect(first.status).toBe(201);
    expect(first.body.id).toBe(createPayload.id);
    expect(first.body.version).toBe(1);

    const replay = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send(createPayload);

    expect(replay.status).toBe(201);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(replay.body.version).toBe(1);

    const noExpectedVersion = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-001' })
      .send({ ...createPayload, name: 'Updated without version' });

    expect(noExpectedVersion.status).toBe(409);
    expect(noExpectedVersion.body.error).toBe('version_required');

    const update = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-002' })
      .send({ ...createPayload, name: 'Updated with version', expectedVersion: 1 });

    expect(update.status).toBe(200);
    expect(update.body.version).toBe(2);

    const wrongVersion = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-update-003' })
      .send({ ...createPayload, name: 'Wrong version', expectedVersion: 1 });

    expect(wrongVersion.status).toBe(409);
    expect(wrongVersion.body.error).toBe('version_conflict');

    const conflict = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-create-001' })
      .send({ ...createPayload, name: 'Different Project Name' });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_conflict');
  });

  it('supports ledger and transaction upsert with validation', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-001' })
      .send({ id: 'p-bff-002', name: 'Project 2' });

    const missingProject = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-404' })
      .send({ id: 'l404', projectId: 'no-project', name: 'Invalid ledger' });

    expect(missingProject.status).toBe(404);

    const ledger = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-create-001' })
      .send({ id: 'l001', projectId: 'p-bff-002', name: 'Main Ledger' });

    expect(ledger.status).toBe(201);
    expect(ledger.body.version).toBe(1);

    const ledgerUpdate = await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-update-001' })
      .send({ id: 'l001', projectId: 'p-bff-002', name: 'Main Ledger V2', expectedVersion: 1 });

    expect(ledgerUpdate.status).toBe(200);
    expect(ledgerUpdate.body.version).toBe(2);

    const tx = await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-tx-create-001' })
      .send({
        id: 'tx001',
        projectId: 'p-bff-002',
        ledgerId: 'l001',
        counterparty: 'Vendor A',
      });

    expect(tx.status).toBe(201);
    expect(tx.body.state).toBe('DRAFT');
    expect(tx.body.version).toBe(1);

    const txList = await api
      .get('/api/v1/transactions')
      .set(defaultHeaders);

    expect(txList.status).toBe(200);
    expect(txList.body.count).toBe(1);
  });

  it('supports deterministic cursor pagination for project list', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-1' })
      .send({ id: 'p-page-001', name: 'Paged Project 1' });
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-2' })
      .send({ id: 'p-page-002', name: 'Paged Project 2' });
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-page-project-3' })
      .send({ id: 'p-page-003', name: 'Paged Project 3' });

    const firstPage = await api
      .get('/api/v1/projects?limit=2')
      .set(defaultHeaders);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.count).toBe(2);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await api
      .get(`/api/v1/projects?limit=2&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`)
      .set(defaultHeaders);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.count).toBe(1);

    const seenIds = new Set([
      ...firstPage.body.items.map((item: any) => item.id),
      ...secondPage.body.items.map((item: any) => item.id),
    ]);
    expect(seenIds.size).toBe(3);
  });

  it('moves projects to trash and restores them with version checks', async () => {
    const created = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-trash-project-001-create' })
      .send({ id: 'p-trash-001', name: 'Trash Target Project' });

    expect(created.status).toBe(201);

    const trashed = await api
      .post('/api/v1/projects/p-trash-001/trash')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-trash-project-001-trash' })
      .send({ expectedVersion: 1, reason: '중복 등록 테스트' });

    expect(trashed.status).toBe(200);
    expect(trashed.body.version).toBe(2);
    expect(typeof trashed.body.trashedAt).toBe('string');

    const trashedSnap = await db.doc(`orgs/${tenantId}/projects/p-trash-001`).get();
    expect(trashedSnap.exists).toBe(true);
    expect(trashedSnap.data()).toMatchObject({
      trashedById: actorId,
      trashedReason: '중복 등록 테스트',
    });
    expect(typeof trashedSnap.data()?.trashedAt).toBe('string');

    const restoreConflict = await api
      .post('/api/v1/projects/p-trash-001/restore')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-trash-project-001-restore-conflict' })
      .send({ expectedVersion: 1 });

    expect(restoreConflict.status).toBe(409);

    const restored = await api
      .post('/api/v1/projects/p-trash-001/restore')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-trash-project-001-restore' })
      .send({ expectedVersion: 2 });

    expect(restored.status).toBe(200);
    expect(restored.body.version).toBe(3);

    const restoredSnap = await db.doc(`orgs/${tenantId}/projects/p-trash-001`).get();
    expect(restoredSnap.exists).toBe(true);
    expect(restoredSnap.data()).toMatchObject({
      trashedAt: null,
      trashedById: null,
      trashedByEmail: null,
      trashedReason: null,
    });
  });

  it('auto-provisions a default ledger when a transaction is created before ledger setup', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-auto-ledger-project-001' })
      .send({
        id: 'p-auto-ledger-001',
        name: 'Auto Ledger Project',
        accountType: 'DEDICATED',
      });

    const tx = await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-auto-ledger-tx-001' })
      .send({
        id: 'tx-auto-ledger-001',
        projectId: 'p-auto-ledger-001',
        ledgerId: 'l-p-auto-ledger-001',
        counterparty: 'Vendor Auto',
      });

    expect(tx.status).toBe(201);
    expect(tx.body.state).toBe('DRAFT');

    const ledgerSnap = await db.doc(`orgs/${tenantId}/ledgers/l-p-auto-ledger-001`).get();
    expect(ledgerSnap.exists).toBe(true);
    expect(ledgerSnap.data()?.projectId).toBe('p-auto-ledger-001');
    expect(ledgerSnap.data()?.name).toBe('전용통장 원장');
  });

  it('exports non-zero cashflow values from cashflow_weeks', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-cashflow-project-001' })
      .send({
        id: 'p-cashflow-001',
        name: 'Cashflow Project',
        accountType: 'DEDICATED',
      });

    await db.doc(`orgs/${tenantId}/cashflow_weeks/p-cashflow-001-2026-01-w1`).set({
      projectId: 'p-cashflow-001',
      yearMonth: '2026-01',
      weekNo: 1,
      weekStart: '2025-12-31',
      weekEnd: '2026-01-06',
      projection: { SALES_IN: 1250 },
      actual: { SALES_IN: 900 },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    await db.doc(`orgs/${tenantId}/transactions/tx-cashflow-001`).set({
      id: 'tx-cashflow-001',
      projectId: 'p-cashflow-001',
      dateTime: '2026-01-05',
      amount: 1250,
      createdAt: '2026-01-05T00:00:00.000Z',
      updatedAt: '2026-01-05T00:00:00.000Z',
    }, { merge: true });

    const response = await downloadCashflowExport({
      scope: 'single',
      projectId: 'p-cashflow-001',
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'single-project',
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const workbook = await readWorkbook(response.body);
    const worksheet = workbook.getWorksheet('Projection');
    const rows = worksheet.getSheetValues().filter(Boolean).map((row) => (Array.isArray(row) ? row.slice(1) : []));
    expect(rows[0]).toEqual(['사업', 'Cashflow Project', '사업 ID', 'p-cashflow-001', '거래 수', 1]);
    const salesRow = rows.find((row) => row[0] === '매출액(입금)');

    expect(salesRow).toBeTruthy();
    expect(salesRow).toEqual([
      '매출액(입금)',
      1250, 0, 0, 0, 0,
    ]);
  });

  it('filters exported projects by accountType', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-cashflow-project-002a' })
      .send({
        id: 'p-cashflow-002a',
        name: 'Dedicated Project',
        accountType: 'DEDICATED',
      });

    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-cashflow-project-002b' })
      .send({
        id: 'p-cashflow-002b',
        name: 'Operating Project',
        accountType: 'OPERATING',
      });

    await db.doc(`orgs/${tenantId}/cashflow_weeks/p-cashflow-002a-2026-01-w1`).set({
      projectId: 'p-cashflow-002a',
      yearMonth: '2026-01',
      weekNo: 1,
      weekStart: '2025-12-31',
      weekEnd: '2026-01-06',
      projection: { SALES_IN: 700 },
      actual: { SALES_IN: 500 },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    await db.doc(`orgs/${tenantId}/cashflow_weeks/p-cashflow-002b-2026-01-w1`).set({
      projectId: 'p-cashflow-002b',
      yearMonth: '2026-01',
      weekNo: 1,
      weekStart: '2025-12-31',
      weekEnd: '2026-01-06',
      projection: { SALES_IN: 900 },
      actual: { SALES_IN: 600 },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    await db.doc(`orgs/${tenantId}/transactions/tx-cashflow-002a`).set({
      id: 'tx-cashflow-002a',
      projectId: 'p-cashflow-002a',
      dateTime: '2026-01-04',
      amount: 700,
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    }, { merge: true });

    const response = await downloadCashflowExport({
      scope: 'all',
      accountType: 'DEDICATED',
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'multi-sheet',
    });

    expect(response.status).toBe(200);

    const workbook = await readWorkbook(response.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Dedicated Project']);

    const worksheet = workbook.getWorksheet('Dedicated Project');
    const rows = worksheet.getSheetValues().filter(Boolean).map((row) => (Array.isArray(row) ? row.slice(1) : []));
    expect(rows[0]).toEqual(['사업', 'Dedicated Project', '사업 ID', 'p-cashflow-002a', '거래 수', 1]);
    const salesRow = rows.find((row) => row[0] === '매출액(입금)');

    expect(salesRow).toEqual([
      '매출액(입금)',
      700, 0, 0, 0, 0,
    ]);
  });

  it('accepts legacy basis payloads for export requests', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-cashflow-project-legacy-basis' })
      .send({
        id: 'p-cashflow-legacy-basis',
        name: 'Legacy Basis Project',
        basis: '공급가액',
        accountType: 'NONE',
      });

    const response = await downloadCashflowExport({
      scope: 'all',
      basis: '공급가액',
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'multi-sheet',
    });

    expect(response.status).toBe(200);
    const workbook = await readWorkbook(response.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Legacy Basis Project']);
  });

  it('enforces deterministic state transitions and version checks', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-003' })
      .send({ id: 'p-bff-003', name: 'Project 3' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-003' })
      .send({ id: 'l003', projectId: 'p-bff-003', name: 'Ledger 3' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-003' })
      .send({ id: 'tx003', projectId: 'p-bff-003', ledgerId: 'l003', counterparty: 'Vendor C' });

    const invalidTransition = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-invalid-003' })
      .send({ newState: 'APPROVED', expectedVersion: 1 });

    expect(invalidTransition.status).toBe(400);
    expect(invalidTransition.body.message).toMatch(/Invalid state transition/);

    const submitted = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-submit-003' })
      .send({ newState: 'SUBMITTED', expectedVersion: 1 });

    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe('SUBMITTED');
    expect(submitted.body.version).toBe(2);

    const noReasonReject = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-reject-003a' })
      .send({ newState: 'REJECTED', expectedVersion: 2 });

    expect(noReasonReject.status).toBe(400);

    const rejected = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-reject-003b' })
      .send({ newState: 'REJECTED', expectedVersion: 2, reason: '증빙 부족' });

    expect(rejected.status).toBe(200);
    expect(rejected.body.state).toBe('REJECTED');
    expect(rejected.body.version).toBe(3);

    const staleVersion = await api
      .patch('/api/v1/transactions/tx003/state')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-state-resubmit-003a' })
      .send({ newState: 'SUBMITTED', expectedVersion: 2 });

    expect(staleVersion.status).toBe(409);
    expect(staleVersion.body.error).toBe('version_conflict');
  });

  it('creates and lists comments/evidences with immutable audit trail', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-004' })
      .send({ id: 'p-bff-004', name: 'Project 4' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-004' })
      .send({ id: 'l004', projectId: 'p-bff-004', name: 'Ledger 4' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-004' })
      .send({ id: 'tx004', projectId: 'p-bff-004', ledgerId: 'l004', counterparty: 'Vendor D' });

    const comment = await api
      .post('/api/v1/transactions/tx004/comments')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-comment-004' })
      .send({ content: '검토 요청', authorName: '관리자' });

    expect(comment.status).toBe(201);

    const evidence = await api
      .post('/api/v1/transactions/tx004/evidences')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-evidence-004' })
      .send({
        fileName: 'invoice.pdf',
        fileType: 'application/pdf',
        fileSize: 32000,
        category: '세금계산서',
      });

    expect(evidence.status).toBe(201);

    const comments = await api
      .get('/api/v1/transactions/tx004/comments')
      .set(defaultHeaders);

    const evidences = await api
      .get('/api/v1/transactions/tx004/evidences')
      .set(defaultHeaders);

    expect(comments.status).toBe(200);
    expect(comments.body.count).toBe(1);
    expect(evidences.status).toBe(200);
    expect(evidences.body.count).toBe(1);

    const audits = await api
      .get('/api/v1/audit-logs')
      .set(defaultHeaders);

    expect(audits.status).toBe(200);
    expect(audits.body.count).toBeGreaterThanOrEqual(5);
    const ids = audits.body.items.map((item: any) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const verify = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.checked).toBeGreaterThanOrEqual(5);
  });

  it('provisions and syncs evidence drive folders via injected drive service', async () => {
    const driveService = {
      getConfig: vi.fn(() => ({
        enabled: true,
        defaultParentFolderId: 'fld-company-root',
        sharedDriveId: 'shared-drive-001',
      })),
      ensureProjectRootFolder: vi.fn(async () => ({
        id: 'fld-project-root',
        name: 'Drive_Project_p-drive-001',
        webViewLink: 'https://drive.google.com/drive/folders/fld-project-root',
        driveId: 'shared-drive-001',
        mimeType: 'application/vnd.google-apps.folder',
      })),
      getFile: vi.fn(async (folderId: string) => ({
        id: folderId,
        name: 'Manual Root',
        webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
        driveId: 'shared-drive-001',
        mimeType: 'application/vnd.google-apps.folder',
      })),
      ensureTransactionFolder: vi.fn(async () => ({
        projectRootFolder: {
          id: 'fld-project-root',
          name: 'Drive_Project_p-drive-001',
          webViewLink: 'https://drive.google.com/drive/folders/fld-project-root',
          driveId: 'shared-drive-001',
          mimeType: 'application/vnd.google-apps.folder',
        },
        folder: {
          id: 'fld-tx-root',
          name: '20260311_회의비_다과비_tx-drive-001',
          webViewLink: 'https://drive.google.com/drive/folders/fld-tx-root',
          driveId: 'shared-drive-001',
          mimeType: 'application/vnd.google-apps.folder',
        },
      })),
      listFolderFiles: vi.fn(async () => ([
        {
          id: 'file-tax-001',
          name: '세금계산서_3월.pdf',
          mimeType: 'application/pdf',
          size: 18000,
          webViewLink: 'https://drive.google.com/file/d/file-tax-001/view',
        },
        {
          id: 'file-transfer-001',
          name: '입금확인서_3월.pdf',
          mimeType: 'application/pdf',
          size: 9000,
          webViewLink: 'https://drive.google.com/file/d/file-transfer-001/view',
        },
      ])),
    };
    const driveApi = request(createBffApp({ projectId, workerSecret, db, driveService }));

    const createdProject = await driveApi
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-project-drive-001' })
      .send({ id: 'p-drive-001', name: 'Drive Project' });

    expect(createdProject.status).toBe(201);
    expect(createdProject.body.evidenceDriveRootFolderId).toBe('fld-project-root');
    expect(driveService.ensureProjectRootFolder).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      projectId: 'p-drive-001',
      projectName: 'Drive Project',
    }));

    await driveApi
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-drive-001' })
      .send({ id: 'l-drive-001', projectId: 'p-drive-001', name: 'Drive Ledger' });

    await driveApi
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-tx-drive-001' })
      .send({
        id: 'tx-drive-001',
        projectId: 'p-drive-001',
        ledgerId: 'l-drive-001',
        counterparty: 'Vendor Drive',
        budgetCategory: '회의비',
        budgetSubCategory: '다과비',
        dateTime: '2026-03-11',
        evidenceRequired: ['세금계산서', '입금확인서'],
        evidenceStatus: 'MISSING',
        evidenceMissing: ['세금계산서', '입금확인서'],
        attachmentsCount: 0,
        state: 'DRAFT',
      });

    const projectRoot = await driveApi
      .post('/api/v1/projects/p-drive-001/evidence-drive/root/provision')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-project-drive-root-001' })
      .send({});

    expect(projectRoot.status).toBe(200);
    expect(projectRoot.body.folderId).toBe('fld-project-root');

    const linkedRoot = await driveApi
      .post('/api/v1/projects/p-drive-001/evidence-drive/root/link')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-project-drive-link-001' })
      .send({ value: 'https://drive.google.com/drive/folders/1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg?usp=share_link' });

    expect(linkedRoot.status).toBe(200);
    expect(linkedRoot.body.folderId).toBe('1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg');
    expect(driveService.getFile).toHaveBeenCalledWith('1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg');

    const txFolder = await driveApi
      .post('/api/v1/transactions/tx-drive-001/evidence-drive/provision')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-tx-drive-provision-001' })
      .send({});

    expect(txFolder.status).toBe(200);
    expect(txFolder.body.folderId).toBe('fld-tx-root');
    expect(driveService.ensureTransactionFolder).toHaveBeenCalled();

    const sync = await driveApi
      .post('/api/v1/transactions/tx-drive-001/evidence-drive/sync')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-tx-drive-sync-001' })
      .send({});

    expect(sync.status).toBe(200);
    expect(sync.body.evidenceCount).toBe(2);
    expect(sync.body.evidenceStatus).toBe('COMPLETE');
    expect(sync.body.evidenceCompletedDesc).toContain('세금계산서');

    const txSnap = await db.doc(`orgs/${tenantId}/transactions/tx-drive-001`).get();
    expect(txSnap.exists).toBe(true);
    expect(txSnap.data()?.evidenceDriveFolderId).toBe('fld-tx-root');
    expect(txSnap.data()?.evidenceAutoListedDesc).toBe('세금계산서, 입금확인서');
    expect(txSnap.data()?.evidenceMissing).toEqual([]);

    const projectSnap = await db.doc(`orgs/${tenantId}/projects/p-drive-001`).get();
    expect(projectSnap.data()?.evidenceDriveRootFolderId).toBe('fld-project-root');

    const evidenceSnap = await db
      .collection(`orgs/${tenantId}/evidences`)
      .where('transactionId', '==', 'tx-drive-001')
      .get();
    expect(evidenceSnap.size).toBe(2);
    expect(evidenceSnap.docs.map((doc) => doc.data().driveFileId).sort()).toEqual(['file-tax-001', 'file-transfer-001']);
  });

  it('creates project roots per project and uploads files with parser categories', async () => {
    const folderState = new Map<string, Array<any>>();
    const ensureProjectRootFolder = vi.fn(async ({ projectId, projectName }) => ({
      id: `fld-project-${projectId}`,
      name: `${projectName}_${projectId}`,
      webViewLink: `https://drive.google.com/drive/folders/fld-project-${projectId}`,
      driveId: 'shared-drive-001',
      mimeType: 'application/vnd.google-apps.folder',
    }));
    const ensureTransactionFolder = vi.fn(async ({ projectId, transaction }) => ({
      projectRootFolder: {
        id: `fld-project-${projectId}`,
        name: `Project_${projectId}`,
        webViewLink: `https://drive.google.com/drive/folders/fld-project-${projectId}`,
        driveId: 'shared-drive-001',
        mimeType: 'application/vnd.google-apps.folder',
      },
      folder: {
        id: `fld-${transaction.id}`,
        name: `${transaction.id}_folder`,
        webViewLink: `https://drive.google.com/drive/folders/fld-${transaction.id}`,
        driveId: 'shared-drive-001',
        mimeType: 'application/vnd.google-apps.folder',
      },
    }));
    const driveService = {
      getConfig: vi.fn(() => ({
        enabled: true,
        defaultParentFolderId: 'fld-company-root',
        sharedDriveId: 'shared-drive-001',
      })),
      ensureProjectRootFolder,
      getFile: vi.fn(),
      ensureTransactionFolder,
      uploadFileToFolder: vi.fn(async ({ folderId, fileName, mimeType, appProperties }) => {
        const fileId = `drv-${folderId}-${folderState.get(folderId)?.length || 0}`;
        const uploaded = {
          id: fileId,
          name: fileName,
          mimeType,
          size: 1024,
          webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
          parents: [folderId],
          driveId: 'shared-drive-001',
          appProperties,
        };
        folderState.set(folderId, [...(folderState.get(folderId) || []), uploaded]);
        return uploaded;
      }),
      listFolderFiles: vi.fn(async ({ folderId }) => folderState.get(folderId) || []),
    };
    const driveApi = request(createBffApp({ projectId, workerSecret, db, driveService }));

    for (const project of [
      { id: 'p-upload-001', name: '온드림 교육사업' },
      { id: 'p-upload-002', name: '체인지메이커 운영사업' },
    ]) {
      const createdProject = await driveApi
        .post('/api/v1/projects')
        .set({ ...defaultHeaders, 'idempotency-key': `idem-project-${project.id}` })
        .send(project);

      expect(createdProject.status).toBe(201);
      expect(createdProject.body.evidenceDriveRootFolderId).toBe(`fld-project-${project.id}`);
    }

    expect(ensureProjectRootFolder).toHaveBeenCalledTimes(2);

    await driveApi
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-ledger-upload-001' })
      .send({ id: 'l-upload-001', projectId: 'p-upload-001', name: 'Upload Ledger' });

    await driveApi
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-tx-upload-001' })
      .send({
        id: 'tx-upload-001',
        projectId: 'p-upload-001',
        ledgerId: 'l-upload-001',
        counterparty: 'Zoom',
        budgetCategory: '교육운영비',
        budgetSubCategory: '강의자료',
        dateTime: '2026-03-11',
        evidenceRequired: ['강의자료', 'ZOOM invoice'],
        evidenceStatus: 'MISSING',
        evidenceMissing: ['강의자료', 'ZOOM invoice'],
        attachmentsCount: 0,
        state: 'DRAFT',
      });

    const firstUpload = await driveApi
      .post('/api/v1/transactions/tx-upload-001/evidence-drive/upload')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-upload-file-001' })
      .send({
        fileName: '강의자료_1차시.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        contentBase64: 'ZmFrZS1wZGY=',
      });

    expect(firstUpload.status).toBe(201);
    expect(firstUpload.body.parserCategory).toBe('강의자료');
    expect(firstUpload.body.evidenceCompletedDesc).toBe('강의자료');
    expect(firstUpload.body.evidencePendingDesc).toBe('ZOOM invoice');

    const secondUpload = await driveApi
      .post('/api/v1/transactions/tx-upload-001/evidence-drive/upload')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-upload-file-002' })
      .send({
        fileName: 'ZOOM invoice March.pdf',
        mimeType: 'application/pdf',
        fileSize: 2048,
        contentBase64: 'ZmFrZS16b29tLXBkZg==',
      });

    expect(secondUpload.status).toBe(201);
    expect(secondUpload.body.parserCategory).toBe('ZOOM invoice');
    expect(secondUpload.body.evidenceStatus).toBe('COMPLETE');
    expect(secondUpload.body.evidenceCompletedDesc).toContain('강의자료');
    expect(secondUpload.body.evidenceCompletedDesc).toContain('ZOOM invoice');

    const evidenceSnap = await db
      .collection(`orgs/${tenantId}/evidences`)
      .where('transactionId', '==', 'tx-upload-001')
      .get();

    expect(evidenceSnap.size).toBe(2);
    expect(evidenceSnap.docs.map((doc) => doc.data().parserCategory).sort()).toEqual(['ZOOM invoice', '강의자료']);
  });

  it('detects tampering in audit hash chain', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-audit' })
      .send({ id: 'p-audit-001', name: 'Audit Project' });

    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-audit-2' })
      .send({ id: 'p-audit-001', name: 'Audit Project v2', expectedVersion: 1 });

    const verifyBefore = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verifyBefore.status).toBe(200);
    expect(verifyBefore.body.ok).toBe(true);

    const firstAudit = await db
      .collection(`orgs/${tenantId}/audit_logs`)
      .orderBy('chainSeq', 'asc')
      .limit(1)
      .get();
    expect(firstAudit.empty).toBe(false);
    await firstAudit.docs[0].ref.set({ details: 'tampered' }, { merge: true });

    const verifyAfter = await api
      .get('/api/v1/audit-logs/verify')
      .set(defaultHeaders);
    expect(verifyAfter.status).toBe(409);
    expect(verifyAfter.body.ok).toBe(false);
    expect(verifyAfter.body.reason).toBe('hash_mismatch');
  });

  it('handles high concurrency with exactly one successful state transition per version', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-project-race' })
      .send({ id: 'p-race-001', name: 'Race Project' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-ledger-race' })
      .send({ id: 'l-race-001', projectId: 'p-race-001', name: 'Race Ledger' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-seed-tx-race' })
      .send({ id: 'tx-race-001', projectId: 'p-race-001', ledgerId: 'l-race-001', counterparty: 'Race Vendor' });

    const workers = Array.from({ length: 25 }, (_, idx) => (
      api
        .patch('/api/v1/transactions/tx-race-001/state')
        .set({ ...defaultHeaders, 'idempotency-key': `idem-race-${idx}` })
        .send({ newState: 'SUBMITTED', expectedVersion: 1 })
    ));

    const responses = await Promise.all(workers);
    const successCount = responses.filter((r) => r.status === 200).length;
    const conflictCount = responses.filter((r) => r.status === 409 && r.body.error === 'version_conflict').length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(24);
  });

  it('audits member role changes and blocks unauthorized actor role', async () => {
    await db.doc(`orgs/${tenantId}/members/u-target`).set({
      uid: 'u-target',
      tenantId,
      role: 'viewer',
      email: 'target@example.com',
      updatedAt: new Date().toISOString(),
    });

    const forbidden = await api
      .patch('/api/v1/members/u-target/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-role-pm-deny' })
      .send({ role: 'finance', reason: 'test' });

    expect(forbidden.status).toBe(403);

    const changed = await api
      .patch('/api/v1/members/u-target/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-role-admin-allow' })
      .send({ role: 'finance', reason: 'quarter close' });

    expect(changed.status).toBe(200);
    expect(changed.body.previousRole).toBe('viewer');
    expect(changed.body.role).toBe('finance');

    const memberSnap = await db.doc(`orgs/${tenantId}/members/u-target`).get();
    expect(memberSnap.data()?.role).toBe('finance');

    const auditSnap = await db
      .collection(`orgs/${tenantId}/audit_logs`)
      .where('entityType', '==', 'member')
      .limit(5)
      .get();
    const roleChangeLog = auditSnap.docs.map((doc) => doc.data()).find((item: any) => item.action === 'ROLE_CHANGE');
    expect(roleChangeLog).toBeTruthy();
  });

  it('uses member fallback for firebase auth when token role is missing and ignores spoofed header role', async () => {
    await db.doc(`orgs/${tenantId}/members/u-firebase-roleless`).set({
      uid: 'u-firebase-roleless',
      tenantId,
      role: 'pm',
      email: 'roleless@mysc.co.kr',
      updatedAt: new Date().toISOString(),
    });

    await db.doc(`orgs/${tenantId}/members/u-target`).set({
      uid: 'u-target',
      tenantId,
      role: 'viewer',
      email: 'target@example.com',
      updatedAt: new Date().toISOString(),
    });

    const firebaseApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      authMode: 'firebase_required',
      tokenVerifier: async () => ({
        uid: 'u-firebase-roleless',
        tenantId,
        email: 'roleless@mysc.co.kr',
      }),
    }));

    const denied = await firebaseApi
      .patch('/api/v1/members/u-target/role')
      .set({
        authorization: 'Bearer firebase-token',
        'x-tenant-id': tenantId,
        'x-actor-id': 'u-firebase-roleless',
        'x-actor-role': 'admin',
        'x-actor-email': 'spoofed@mysc.co.kr',
        'idempotency-key': 'idem-firebase-roleless-denied',
      })
      .send({ role: 'finance', reason: 'spoofed header should not escalate' });

    expect(denied.status).toBe(403);

    await db.doc(`orgs/${tenantId}/members/u-firebase-roleless`).set({
      role: 'admin',
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    const allowed = await firebaseApi
      .patch('/api/v1/members/u-target/role')
      .set({
        authorization: 'Bearer firebase-token',
        'x-tenant-id': tenantId,
        'x-actor-id': 'u-firebase-roleless',
        'x-actor-role': 'pm',
        'x-actor-email': 'spoofed@mysc.co.kr',
        'idempotency-key': 'idem-firebase-roleless-allowed',
      })
      .send({ role: 'finance', reason: 'member fallback admin should allow' });

    expect(allowed.status).toBe(200);
    expect(allowed.body.role).toBe('finance');
  });

  it('lists auth governance rows merged from auth users and member docs', async () => {
    await db.doc(`orgs/${tenantId}/members/jslee_mysc_co_kr`).set({
      uid: 'jslee_mysc_co_kr',
      tenantId,
      role: 'admin',
      email: 'jslee@mysc.co.kr',
      name: 'Legacy JS',
    });
    await db.doc(`orgs/${tenantId}/members/u-jslee`).set({
      uid: 'u-jslee',
      tenantId,
      role: 'pm',
      email: 'jslee@mysc.co.kr',
      name: 'Canonical JS',
      status: 'ACTIVE',
    });

    const governanceApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      authAdminService: {
        listUsers: async () => ({
          users: [{
            uid: 'u-jslee',
            email: 'jslee@mysc.co.kr',
            displayName: 'JS Lee',
            disabled: false,
            customClaims: { role: 'pm', tenantId },
          }],
        }),
      },
    }));

    const response = await governanceApi
      .get('/api/v1/admin/auth-governance/users')
      .set(defaultHeaders);

    expect(response.status).toBe(200);
    const row = response.body.items.find((item: any) => item.email === 'jslee@mysc.co.kr');
    expect(row).toBeTruthy();
    expect(row).toMatchObject({
      authUid: 'u-jslee',
      effectiveRole: 'pm',
      driftFlags: expect.arrayContaining(['duplicate_member_docs', 'legacy_role_mismatch', 'bootstrap_admin_not_adopted']),
    });
    expect(response.body.summary.duplicateMemberDocs).toBeGreaterThanOrEqual(1);
  });

  it('deep syncs canonical member, legacy member, and custom claims together', async () => {
    await db.doc(`orgs/${tenantId}/members/jhsong_mysc_co_kr`).set({
      uid: 'jhsong_mysc_co_kr',
      tenantId,
      role: 'pm',
      email: 'jhsong@mysc.co.kr',
      name: 'Legacy Song',
      status: 'ACTIVE',
      projectIds: ['p-sync-1'],
    });

    const setCustomUserClaims = vi.fn(async () => {});
    const governanceApi = request(createBffApp({
      projectId,
      workerSecret,
      db,
      authAdminService: {
        listUsers: async () => ({
          users: [{
            uid: 'u-jhsong',
            email: 'jhsong@mysc.co.kr',
            displayName: 'JH Song',
            disabled: false,
            customClaims: { role: 'pm', tenantId },
          }],
        }),
        setCustomUserClaims,
      },
    }));

    const response = await governanceApi
      .post('/api/v1/admin/auth-governance/users/jhsong%40mysc.co.kr/deep-sync')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-auth-governance-sync-001' })
      .send({ role: 'admin', reason: 'cashflow export alignment' });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('admin');
    expect(response.body.mirroredLegacyCount).toBe(1);

    const canonicalSnap = await db.doc(`orgs/${tenantId}/members/u-jhsong`).get();
    expect(canonicalSnap.data()).toMatchObject({
      uid: 'u-jhsong',
      email: 'jhsong@mysc.co.kr',
      role: 'admin',
      projectIds: ['p-sync-1'],
    });

    const legacySnap = await db.doc(`orgs/${tenantId}/members/jhsong_mysc_co_kr`).get();
    expect(legacySnap.data()).toMatchObject({
      role: 'admin',
      canonicalUid: 'u-jhsong',
    });

    expect(setCustomUserClaims).toHaveBeenCalledWith('u-jhsong', { role: 'admin', tenantId });
  });

  it('blocks demoting the last remaining admin (lockout protection)', async () => {
    await db.doc(`orgs/${tenantId}/members/u-admin-1`).set({
      uid: 'u-admin-1',
      tenantId,
      role: 'admin',
      email: 'admin1@example.com',
      updatedAt: new Date().toISOString(),
    });

    const denied = await api
      .patch('/api/v1/members/u-admin-1/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-last-admin-demote' })
      .send({ role: 'viewer', reason: 'test lockout prevention' });

    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('last_admin_lockout');

    await db.doc(`orgs/${tenantId}/members/u-admin-2`).set({
      uid: 'u-admin-2',
      tenantId,
      role: 'admin',
      email: 'admin2@example.com',
      updatedAt: new Date().toISOString(),
    });

    const ok = await api
      .patch('/api/v1/members/u-admin-2/role')
      .set({ ...defaultHeaders, 'x-actor-role': 'admin', 'idempotency-key': 'idem-second-admin-demote' })
      .send({ role: 'viewer', reason: 'leaving one admin' });

    expect(ok.status).toBe(200);
    expect(ok.body.previousRole).toBe('admin');
    expect(ok.body.role).toBe('viewer');
  });

  it('enforces permission-level RBAC for transaction state changes (submit vs approve)', async () => {
    await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-project-001' })
      .send({ id: 'p-perm-001', name: 'Permission Project' });

    await api
      .post('/api/v1/ledgers')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-ledger-001' })
      .send({ id: 'l-perm-001', projectId: 'p-perm-001', name: 'Permission Ledger' });

    await api
      .post('/api/v1/transactions')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-perm-tx-001' })
      .send({ id: 'tx-perm-001', projectId: 'p-perm-001', ledgerId: 'l-perm-001', counterparty: 'Vendor' });

    const submitted = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-perm-submit-001' })
      .send({ newState: 'SUBMITTED', expectedVersion: 1 });

    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe('SUBMITTED');

    const deniedApprove = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm', 'idempotency-key': 'idem-perm-approve-deny-001' })
      .send({ newState: 'APPROVED', expectedVersion: 2 });

    expect(deniedApprove.status).toBe(403);
    expect(deniedApprove.body.error).toBe('forbidden');

    const approved = await api
      .patch('/api/v1/transactions/tx-perm-001/state')
      .set({ ...defaultHeaders, 'x-actor-role': 'finance', 'idempotency-key': 'idem-perm-approve-allow-001' })
      .send({ newState: 'APPROVED', expectedVersion: 2 });

    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe('APPROVED');
  });

  it('enforces route-level RBAC for audit reads and write APIs', async () => {
    const deniedAudit = await api
      .get('/api/v1/audit-logs')
      .set({ ...defaultHeaders, 'x-actor-role': 'pm' });

    expect(deniedAudit.status).toBe(403);
    expect(deniedAudit.body.error).toBe('forbidden');

    const deniedWrite = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'x-actor-role': 'viewer', 'idempotency-key': 'idem-rbac-deny-write' })
      .send({ id: 'p-rbac-denied', name: 'Denied Project' });

    expect(deniedWrite.status).toBe(403);
    expect(deniedWrite.body.error).toBe('forbidden');
  });

  it('writes through generic pipeline and synchronizes projection views', async () => {
    const createProject = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-project-001' })
      .send({
        entityType: 'project',
        entityId: 'p-gw-001',
        patch: {
          id: 'p-gw-001',
          name: 'Pipeline Project',
        },
      });

    expect(createProject.status).toBe(201);
    expect(createProject.body.eventId).toBeTruthy();
    expect(createProject.body.affectedViews).toContain('project_financials');

    const createLedger = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-ledger-001' })
      .send({
        entityType: 'ledger',
        entityId: 'l-gw-001',
        patch: {
          id: 'l-gw-001',
          projectId: 'p-gw-001',
          name: 'Pipeline Ledger',
        },
      });
    expect(createLedger.status).toBe(201);

    const createTx = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-tx-001' })
      .send({
        entityType: 'transaction',
        entityId: 'tx-gw-001',
        patch: {
          id: 'tx-gw-001',
          projectId: 'p-gw-001',
          ledgerId: 'l-gw-001',
          counterparty: 'Pipeline Vendor',
          direction: 'OUT',
          state: 'SUBMITTED',
          amounts: {
            bankAmount: 150000,
          },
          submittedBy: actorId,
          submittedAt: '2026-02-14T12:00:00.000Z',
        },
      });

    expect(createTx.status).toBe(201);
    expect(createTx.body.affectedViews).toContain('approval_inbox');

    const financials = await api
      .get('/api/v1/views/project_financials?projectId=p-gw-001')
      .set(defaultHeaders);
    expect(financials.status).toBe(200);
    expect(financials.body.item).toBeTruthy();
    expect(financials.body.item.projectId).toBe('p-gw-001');

    const inbox = await api
      .get('/api/v1/views/approval_inbox')
      .set(defaultHeaders);
    expect(inbox.status).toBe(200);
    expect(inbox.body.totalPending).toBeGreaterThanOrEqual(1);
    const hasTx = (inbox.body.items || []).some((item: any) => item.itemId === 'tx-gw-001');
    expect(hasTx).toBe(true);

    const queueJobs = await api
      .get('/api/v1/queue/jobs?eventId=' + encodeURIComponent(createTx.body.eventId))
      .set(defaultHeaders);
    expect(queueJobs.status).toBe(200);
    expect(queueJobs.body.count).toBeGreaterThanOrEqual(1);
  });

  it('replays queue jobs from a change event', async () => {
    const write = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-replay-seed' })
      .send({
        entityType: 'member',
        entityId: 'u-replay-001',
        patch: {
          id: 'u-replay-001',
          name: 'Replay User',
          role: 'pm',
          email: 'replay@example.com',
        },
      });

    expect(write.status).toBe(201);
    expect(write.body.eventId).toBeTruthy();

    const replay = await api
      .post(`/api/v1/queue/replay/${write.body.eventId}`)
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-gw-replay-run' })
      .send({});

    expect(replay.status).toBe(200);
    expect(replay.body.queued).toBeGreaterThanOrEqual(1);

    const jobs = await api
      .get('/api/v1/queue/jobs?eventId=' + encodeURIComponent(write.body.eventId))
      .set(defaultHeaders);
    expect(jobs.status).toBe(200);
    expect(jobs.body.count).toBeGreaterThanOrEqual(1);
  });

  it('rejects internal worker endpoints without a valid secret', async () => {
    const deniedQueue = await api
      .post('/api/internal/workers/work-queue/run')
      .send({});
    expect(deniedQueue.status).toBe(401);
    expect(deniedQueue.body.error).toBe('unauthorized_worker');

    const deniedOutbox = await api
      .post('/api/internal/workers/outbox/run')
      .send({});
    expect(deniedOutbox.status).toBe(401);
    expect(deniedOutbox.body.error).toBe('unauthorized_worker');

    // Vercel Cron invokes worker endpoints via HTTP GET.
    const deniedQueueGet = await api
      .get('/api/internal/workers/work-queue/run');
    expect(deniedQueueGet.status).toBe(401);
    expect(deniedQueueGet.body.error).toBe('unauthorized_worker');

    const deniedOutboxGet = await api
      .get('/api/internal/workers/outbox/run');
    expect(deniedOutboxGet.status).toBe(401);
    expect(deniedOutboxGet.body.error).toBe('unauthorized_worker');
  });

  it('processes work queue jobs through internal worker endpoint', async () => {
    const write = await api
      .post('/api/v1/write')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-worker-queue-seed' })
      .send({
        entityType: 'project',
        entityId: 'p-worker-queue-001',
        patch: {
          id: 'p-worker-queue-001',
          name: 'Queue Worker Seed',
        },
        options: {
          sync: false,
        },
      });

    expect(write.status).toBe(201);
    expect(write.body.eventId).toBeTruthy();

    const runQueue = await api
      .get('/api/internal/workers/work-queue/run')
      .set('authorization', `Bearer ${workerSecret}`)
      .query({ tenantId, eventId: write.body.eventId });

    expect(runQueue.status).toBe(200);
    expect(runQueue.body.ok).toBe(true);
    expect(runQueue.body.worker).toBe('work_queue');
    expect(runQueue.body.processed).toBeGreaterThanOrEqual(1);

    const jobs = await api
      .get(`/api/v1/queue/jobs?eventId=${encodeURIComponent(write.body.eventId)}`)
      .set(defaultHeaders);

    expect(jobs.status).toBe(200);
    expect(jobs.body.count).toBeGreaterThanOrEqual(1);
    const allDone = (jobs.body.items || []).every((item: any) => item.status === 'DONE');
    expect(allDone).toBe(true);
  });

  it('processes outbox events through internal worker endpoint', async () => {
    const createProject = await api
      .post('/api/v1/projects')
      .set({ ...defaultHeaders, 'idempotency-key': 'idem-worker-outbox-seed' })
      .send({
        id: 'p-worker-outbox-001',
        name: 'Outbox Worker Seed',
      });
    expect(createProject.status).toBe(201);

    const pendingBefore = await db
      .collection('outbox')
      .where('status', '==', 'PENDING')
      .limit(5)
      .get();
    expect(pendingBefore.empty).toBe(false);

    const runOutbox = await api
      .get('/api/internal/workers/outbox/run')
      .set('authorization', `Bearer ${workerSecret}`);

    expect(runOutbox.status).toBe(200);
    expect(runOutbox.body.ok).toBe(true);
    expect(runOutbox.body.worker).toBe('outbox');
    expect(runOutbox.body.processed).toBeGreaterThanOrEqual(1);
    expect(runOutbox.body.succeeded).toBeGreaterThanOrEqual(1);

    const doneAfter = await db
      .collection('outbox')
      .where('status', '==', 'DONE')
      .limit(5)
      .get();
    expect(doneAfter.empty).toBe(false);
  });
});
