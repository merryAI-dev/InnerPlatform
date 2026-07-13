import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  formatProjectTypeSlackLabel,
  mergeProjectAndRequestDocs,
  mountProjectRoutes,
  readProjectRequestById,
  resolveProjectRequestDocuments,
  resolveProjectTeamMemberLookupKeys,
  tryEnsureProjectRootFolder,
  tryRenameManagedProjectRootFolder,
} from './projects.mjs';

describe('project route helpers', () => {
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
