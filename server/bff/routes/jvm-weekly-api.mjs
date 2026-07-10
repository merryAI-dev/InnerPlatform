import {
  asyncHandler,
  assertActorRoleAllowed,
  createHttpError,
  readOptionalText,
  ROUTE_ROLES,
} from '../bff-utils.mjs';

function resolveJavaWeeklyApiBaseUrl(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiBaseUrl)
    || readOptionalText(env.JVM_WEEKLY_API_BASE_URL)
    || readOptionalText(env.WEEKLY_API_BASE_URL);
}

function resolveJavaWeeklyApiServiceToken(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceToken)
    || readOptionalText(env.JVM_WEEKLY_INTERNAL_API_TOKEN)
    || readOptionalText(env.WEEKLY_API_INTERNAL_TOKEN);
}

function resolveJavaWeeklyApiIdTokenAudience(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiIdTokenAudience)
    || readOptionalText(env.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE)
    || readOptionalText(env.WEEKLY_API_ID_TOKEN_AUDIENCE);
}

function resolveJavaWeeklyAuthMode(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyAuthMode)
    || readOptionalText(env.JVM_WEEKLY_AUTH_MODE)
    || readOptionalText(env.WEEKLY_AUTH_MODE)
    || 'strict';
}

function resolveJavaWeeklyWorkspaceEmailDomain(options = {}, env = process.env) {
  const raw = readOptionalText(options.jvmWeeklyWorkspaceEmailDomain)
    || readOptionalText(env.JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || readOptionalText(env.WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || 'mysc.co.kr';
  return raw.replace(/^@+/, '').toLowerCase();
}

function resolveJavaWeeklyFirestoreProjectId(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyFirestoreProjectId)
    || readOptionalText(env.JVM_WEEKLY_FIRESTORE_PROJECT_ID)
    || readOptionalText(env.WEEKLY_FIRESTORE_PROJECT_ID);
}

function resolveBffDataProjectId(env = process.env) {
  return readOptionalText(env.FIREBASE_PROJECT_ID)
    || readOptionalText(env.GCLOUD_PROJECT)
    || readOptionalText(env.GOOGLE_CLOUD_PROJECT);
}

function isWorkspaceAuthMode(authMode) {
  const normalized = readOptionalText(authMode).toLowerCase();
  return normalized === 'internal_saas_workspace' || normalized === 'workspace';
}

async function fetchGoogleIdentityToken(fetchImpl, audience) {
  if (!audience) return '';
  const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
  const response = await fetchImpl(tokenUrl, {
    method: 'GET',
    headers: { 'Metadata-Flavor': 'Google' },
  });
  const token = await response.text();
  if (!response.ok || !readOptionalText(token)) {
    throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
  }
  return token.trim();
}

async function buildTrustedHeaders({
  fetchImpl,
  context,
  serviceToken,
  idTokenAudience,
  authMode,
  workspaceEmailDomain,
  editSession,
  dataProjectId,
}) {
  if (!serviceToken) {
    throw createHttpError(503, 'JVM weekly API service token is not configured.', 'jvm_weekly_api_token_unconfigured');
  }
  const actorRole = isWorkspaceAuthMode(authMode) && isWorkspaceUser(context, workspaceEmailDomain) ? 'workspace_user' : context.actorRole || '';
  const headers = {
    'content-type': 'application/json',
    'x-inner-platform-service-token': serviceToken,
    'x-tenant-id': context.tenantId,
    'x-actor-id': context.actorId,
    'x-actor-role': actorRole,
  };
  if (context.actorEmail) {
    headers['x-actor-email'] = context.actorEmail;
  }
  if (context.actorName) {
    headers['x-actor-name'] = encodeURIComponent(context.actorName);
  }
  if (dataProjectId) headers['x-data-project-id'] = dataProjectId;
  if (editSession) {
    headers['x-edit-session-id'] = editSession.sessionId;
    headers['x-edit-lease-id'] = editSession.leaseId;
    headers['x-edit-fence'] = String(editSession.fence);
  }
  const identityToken = await fetchGoogleIdentityToken(fetchImpl, idTokenAudience);
  if (identityToken) {
    headers.authorization = `Bearer ${identityToken}`;
  }
  return headers;
}

function readJavaError(status, payload) {
  const message = readOptionalText(payload?.message) || readOptionalText(payload?.error) || `Java weekly API request failed with ${status}`;
  const code = readOptionalText(payload?.code) || readOptionalText(payload?.error) || 'java_weekly_api_error';
  return createHttpError(status, message, code);
}

async function proxyJavaWeeklyJson({
  fetchImpl,
  baseUrl,
  serviceToken,
  idTokenAudience,
  authMode,
  workspaceEmailDomain,
  context,
  method,
  path,
  body,
  editSession,
  dataProjectId,
}) {
  if (!baseUrl) {
    throw createHttpError(503, 'JVM weekly API base URL is not configured.', 'jvm_weekly_api_unconfigured');
  }
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: await buildTrustedHeaders({
      fetchImpl,
      context,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      editSession,
      dataProjectId,
    }),
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw readJavaError(response.status, payload);
  }
  return payload;
}

function commandBody(req) {
  const body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    idempotencyKey: req.context.idempotencyKey,
  };
  delete body.actor;
  delete body.tenantId;
  delete body.actorRole;
  delete body.dataProjectId;
  delete body.sourceSheetKey;
  return body;
}

function readCashflowEditSession(req) {
  const sessionId = readOptionalText(req.header('x-edit-session-id'));
  const leaseId = readOptionalText(req.header('x-edit-lease-id'));
  const fence = Number(req.header('x-edit-fence'));
  if (!sessionId || !leaseId || !Number.isSafeInteger(fence) || fence < 1) {
    throw createHttpError(400, 'Cashflow edit lease headers are required.', 'cashflow_edit_lease_request_invalid');
  }
  return { sessionId, leaseId, fence };
}

function createJavaMutatingProxyRoute(routeHandler) {
  return asyncHandler(async (req, res) => {
    const result = await routeHandler(req, res);
    const status = result?.status ?? 200;
    const body = result?.body ?? null;
    res.status(status).json(body);
  });
}

function isWorkspaceUser(context, workspaceEmailDomain) {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function assertWeeklyWorkspaceOrRoleAllowed(req, allowedRoles, action, authMode, workspaceEmailDomain) {
  if (isWorkspaceAuthMode(authMode) && isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  assertActorRoleAllowed(req, allowedRoles, action);
}

export function mountJvmWeeklyApiRoutes(app, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  jvmWeeklyApiBaseUrl,
  jvmWeeklyApiServiceToken,
  jvmWeeklyApiIdTokenAudience,
  jvmWeeklyAuthMode,
  jvmWeeklyWorkspaceEmailDomain,
  jvmWeeklyFirestoreProjectId,
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);
  const authMode = resolveJavaWeeklyAuthMode({ jvmWeeklyAuthMode }, env);
  const workspaceEmailDomain = resolveJavaWeeklyWorkspaceEmailDomain({ jvmWeeklyWorkspaceEmailDomain }, env);
  const firestoreProjectId = resolveJavaWeeklyFirestoreProjectId({ jvmWeeklyFirestoreProjectId }, env);
  const bffDataProjectId = resolveBffDataProjectId(env);
  const editLeasesEnabled = readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() === 'true';

  async function proxyMutation(req, path, body, { cashflowWrite = false } = {}) {
    let editSession;
    let dataProjectId;
    if (cashflowWrite) {
      if (!editLeasesEnabled) {
        throw createHttpError(503, 'Cashflow writes require the Stage edit-lease runtime.', 'cashflow_edit_leases_disabled');
      }
      if (readOptionalText(env.BFF_DEPLOY_ENV).toLowerCase() !== 'stage') {
        throw createHttpError(503, 'Cashflow writes are restricted to Stage.', 'unsafe_bff_runtime');
      }
      const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
      if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
        throw createHttpError(503, 'BFF and JVM cashflow data projects do not match.', 'jvm_weekly_data_project_mismatch');
      }
      if (bffDataProjectId === liveProjectId) {
        throw createHttpError(503, 'Cashflow Stage writes cannot target the Live data project.', 'unsafe_bff_runtime');
      }
      editSession = readCashflowEditSession(req);
      dataProjectId = bffDataProjectId;
    }
    return proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      context: req.context,
      method: 'POST',
      path,
      body,
      editSession,
      dataProjectId,
    });
  }

  app.get('/api/v1/weekly-expenses/:projectId/sheets', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheets', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets`,
    });
    res.status(200).json(result);
  }));

  app.get('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheet', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/save-draft', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'save weekly expense draft', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/save-draft`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/import-batch', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'import weekly expense bank statement batch', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/bank-statements/import-batch`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.get('/api/v1/weekly-expenses/:projectId/bank-statements/import-lines', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense bank statement import lines', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const status = readOptionalText(req.query.status);
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/bank-statements/import-lines${query}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/apply-items', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'apply weekly expense bank statement items', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/bank-statements/apply-items`, commandBody(req));
    return { status: 200, body: result };
  }));

  for (const command of ['cell-patch', 'copy', 'paste', 'cut', 'row-insert', 'row-delete']) {
    app.post(`/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/commands/${command}`, createJavaMutatingProxyRoute(async (req) => {
      assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, `run weekly expense ${command}`, authMode, workspaceEmailDomain);
      const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
      const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
      const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/commands/${command}`, commandBody(req));
      return { status: 200, body: result };
    }));
  }

  app.post('/api/v1/weekly-expenses/:projectId/submit', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'submit weekly expense week', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/submit`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/close', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'close weekly expense week', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/close`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/audit-export', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'create weekly expense audit export', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/audit-export`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/projection', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'write Java weekly projection', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/projection`,
      commandBody(req),
      { cashflowWrite: true },
    );
    if (readOptionalText(result?.projectId) !== readOptionalText(req.params.projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read Java weekly cashflow snapshot', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      authMode,
      workspaceEmailDomain,
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}`,
    });
    res.status(200).json(result);
  }));
}
