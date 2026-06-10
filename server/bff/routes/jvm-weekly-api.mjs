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

async function buildTrustedHeaders({ fetchImpl, context, serviceToken, idTokenAudience }) {
  if (!serviceToken) {
    throw createHttpError(503, 'JVM weekly API service token is not configured.', 'jvm_weekly_api_token_unconfigured');
  }
  const headers = {
    'content-type': 'application/json',
    'x-inner-platform-service-token': serviceToken,
    'x-tenant-id': context.tenantId,
    'x-actor-id': context.actorId,
    'x-actor-role': context.actorRole || '',
  };
  if (context.actorEmail) {
    headers['x-actor-email'] = context.actorEmail;
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
  context,
  method,
  path,
  body,
}) {
  if (!baseUrl) {
    throw createHttpError(503, 'JVM weekly API base URL is not configured.', 'jvm_weekly_api_unconfigured');
  }
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: await buildTrustedHeaders({ fetchImpl, context, serviceToken, idTokenAudience }),
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
  return body;
}

function createJavaMutatingProxyRoute(routeHandler) {
  return asyncHandler(async (req, res) => {
    const result = await routeHandler(req, res);
    const status = result?.status ?? 200;
    const body = result?.body ?? null;
    res.status(status).json(body);
  });
}

export function mountJvmWeeklyApiRoutes(app, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  jvmWeeklyApiBaseUrl,
  jvmWeeklyApiServiceToken,
  jvmWeeklyApiIdTokenAudience,
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);

  async function proxyMutation(req, path, body) {
    return proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      context: req.context,
      method: 'POST',
      path,
      body,
    });
  }

  app.get('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheet');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/save-draft', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save weekly expense draft');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/save-draft`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/import-batch', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'import weekly expense bank statement batch');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/bank-statements/import-batch`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.get('/api/v1/weekly-expenses/:projectId/bank-statements/import-lines', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense bank statement import lines');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const status = readOptionalText(req.query.status);
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/bank-statements/import-lines${query}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/apply-items', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'apply weekly expense bank statement items');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/bank-statements/apply-items`, commandBody(req));
    return { status: 200, body: result };
  }));

  for (const command of ['cell-patch', 'copy', 'paste', 'cut', 'row-insert', 'row-delete']) {
    app.post(`/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/commands/${command}`, createJavaMutatingProxyRoute(async (req) => {
      assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, `run weekly expense ${command}`);
      const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
      const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
      const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/commands/${command}`, commandBody(req));
      return { status: 200, body: result };
    }));
  }

  app.post('/api/v1/weekly-expenses/:projectId/submit', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'submit weekly expense week');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/submit`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/close', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ['admin', 'finance'], 'close weekly expense week');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/close`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/audit-export', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ['admin', 'finance'], 'create weekly expense audit export');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/audit-export`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/projection', createJavaMutatingProxyRoute(async (req) => {
    assertActorRoleAllowed(req, ['admin', 'finance'], 'write Java weekly projection');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/cashflow/${projectId}/projection`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read Java weekly cashflow snapshot');
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}`,
    });
    res.status(200).json(result);
  }));
}
