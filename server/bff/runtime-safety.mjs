const DEPLOY_ENV_ALIASES = new Map([
  ['dev', 'local'],
  ['development', 'local'],
  ['test', 'local'],
  ['local', 'local'],
  ['preview', 'preview'],
  ['staging', 'stage'],
  ['stage', 'stage'],
  ['prod', 'live'],
  ['production', 'live'],
  ['live', 'live'],
]);

const SCHEDULER_OWNER_ALIASES = new Map([
  ['none', 'disabled'],
  ['off', 'disabled'],
  ['disabled', 'disabled'],
  ['manual', 'manual'],
  ['vercel', 'vercel'],
  ['k8s', 'k8s'],
  ['kubernetes', 'k8s'],
]);

export const DEFAULT_LIVE_FIREBASE_PROJECT_ID = 'inner-platform-live-20260316';
export const DEFAULT_LIVE_ALLOWED_ORIGINS = ['https://myscube.myscguard.app'];

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDeployEnv(value) {
  const normalized = readOptionalText(value).toLowerCase();
  if (!normalized) return '';
  return DEPLOY_ENV_ALIASES.get(normalized) || `invalid:${normalized}`;
}

function normalizeSchedulerOwner(value) {
  const normalized = readOptionalText(value).toLowerCase();
  if (!normalized) return '';
  return SCHEDULER_OWNER_ALIASES.get(normalized) || `invalid:${normalized}`;
}

function readBooleanFlag(value) {
  const normalized = readOptionalText(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseOriginList(value, fallback = []) {
  const parsed = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function resolveDeployEnv(env = process.env) {
  const explicit = normalizeDeployEnv(env.BFF_DEPLOY_ENV || env.DEPLOY_ENV);
  if (explicit) return explicit;

  const vercelEnv = normalizeDeployEnv(env.VERCEL_ENV);
  if (vercelEnv) return vercelEnv;

  if (readOptionalText(env.NODE_ENV).toLowerCase() === 'production') return 'live';
  return 'local';
}

function resolveSchedulerOwner(deployEnv, env = process.env) {
  const explicit = normalizeSchedulerOwner(env.BFF_SCHEDULER_OWNER || env.SCHEDULER_OWNER);
  if (explicit) return explicit;

  const workersEnabled = readBooleanFlag(env.BFF_WORKERS_ENABLED);
  if (workersEnabled === false) return 'disabled';

  if (readOptionalText(env.VERCEL_ENV)) return 'vercel';
  if (deployEnv === 'stage' || deployEnv === 'live') return 'disabled';
  return 'manual';
}

function isFirestoreEmulatorEnabled(env = process.env) {
  return !!readOptionalText(env.FIRESTORE_EMULATOR_HOST);
}

function isKnownMyscPreviewOrigin(origin) {
  return /^https:\/\/inner-platform(?:-[a-z0-9-]+)?-merryai-devs-projects\.vercel\.app$/i.test(origin);
}

function isLiveAllowedOrigin(origin, liveAllowedOrigins = DEFAULT_LIVE_ALLOWED_ORIGINS) {
  return new Set(liveAllowedOrigins.map(readOptionalText).filter(Boolean)).has(readOptionalText(origin));
}

function buildRuntimeSafetyError(violations) {
  const error = new Error(`Unsafe BFF runtime configuration: ${violations.join('; ')}`);
  error.code = 'unsafe_bff_runtime';
  error.violations = violations;
  return error;
}

function resolveWorkerSecrets(input = {}, env = process.env) {
  return {
    manual: readOptionalText(input.workerSecret)
      || readOptionalText(env.BFF_WORKER_SECRET)
      || readOptionalText(env.CRON_SECRET),
    vercel: readOptionalText(env.CRON_SECRET),
    k8s: readOptionalText(env.K8S_WORKER_SECRET)
      || readOptionalText(env.BFF_WORKER_SECRET)
      || readOptionalText(input.workerSecret),
  };
}

export function parseBffAllowedOrigins(value) {
  const rawValue = String(value || '');
  const parsed = rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsed.length > 0) {
    return parsed;
  }

  return ['http://127.0.0.1:5173', 'http://localhost:5173'];
}

export function resolveBffRuntimeSafetyConfig(input = {}, env = process.env) {
  const deployEnv = resolveDeployEnv(env);
  const schedulerOwner = resolveSchedulerOwner(deployEnv, env);
  const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID)
    || readOptionalText(env.FIREBASE_LIVE_PROJECT_ID)
    || DEFAULT_LIVE_FIREBASE_PROJECT_ID;
  const liveAllowedOrigins = parseOriginList(env.BFF_LIVE_ALLOWED_ORIGINS, DEFAULT_LIVE_ALLOWED_ORIGINS);
  const workerSecrets = input.workerSecrets || resolveWorkerSecrets(input, env);

  return {
    deployEnv,
    schedulerOwner,
    liveProjectId,
    liveAllowedOrigins,
    projectId: readOptionalText(input.projectId),
    allowedOrigins: Array.isArray(input.allowedOrigins) ? input.allowedOrigins : [],
    workerSecrets,
    firestoreEmulator: input.firestoreEmulator ?? isFirestoreEmulatorEnabled(env),
  };
}

export function resolveBffWorkerAuthPolicy(input = {}, env = process.env) {
  const deployEnv = resolveDeployEnv(env);
  const schedulerOwner = resolveSchedulerOwner(deployEnv, env);
  return {
    deployEnv,
    schedulerOwner,
    secrets: resolveWorkerSecrets(input, env),
  };
}

export function assertBffRuntimeSafety(config) {
  const violations = [];
  const {
    deployEnv,
    schedulerOwner,
    liveProjectId,
    liveAllowedOrigins,
    projectId,
    allowedOrigins,
    workerSecrets,
    firestoreEmulator,
  } = config;

  if (!['local', 'preview', 'stage', 'live'].includes(deployEnv)) {
    violations.push(`BFF_DEPLOY_ENV must be one of local, preview, stage, live (received: ${deployEnv || 'missing'})`);
  }

  if (!['manual', 'vercel', 'k8s', 'disabled'].includes(schedulerOwner)) {
    violations.push(`BFF_SCHEDULER_OWNER must be one of manual, vercel, k8s, disabled (received: ${schedulerOwner || 'missing'})`);
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && !projectId) {
    violations.push('FIREBASE_PROJECT_ID is required for stage/live BFF');
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && allowedOrigins.includes('*')) {
    violations.push('BFF_ALLOWED_ORIGINS cannot include * for stage/live BFF');
  }

  if (deployEnv === 'live' && allowedOrigins.some(isKnownMyscPreviewOrigin)) {
    violations.push('live BFF cannot allow Vercel preview deployment origins');
  }

  if (deployEnv === 'live' && (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !isLiveAllowedOrigin(origin, liveAllowedOrigins)))) {
    violations.push(`live BFF_ALLOWED_ORIGINS must contain only approved live origins: ${liveAllowedOrigins.join(', ')}`);
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && schedulerOwner === 'manual') {
    violations.push('BFF_SCHEDULER_OWNER cannot be manual for stage/live BFF');
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && schedulerOwner === 'k8s') {
    violations.push('BFF_SCHEDULER_OWNER=k8s is blocked for stage/live until Vercel crons are removed');
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && schedulerOwner === 'vercel' && workerSecrets.vercel.length < 32) {
    violations.push('CRON_SECRET must be at least 32 characters when stage/live workers are owned by Vercel');
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && schedulerOwner === 'k8s' && workerSecrets.k8s.length < 32) {
    violations.push('K8S_WORKER_SECRET or BFF_WORKER_SECRET must be at least 32 characters when stage/live workers are owned by Kubernetes');
  }

  if (deployEnv === 'live' && firestoreEmulator) {
    violations.push('live BFF cannot use Firestore emulator');
  }

  if (deployEnv === 'live' && projectId !== liveProjectId) {
    violations.push(`live BFF must use live Firebase project ${liveProjectId}`);
  }

  if (deployEnv !== 'live' && projectId === liveProjectId && !firestoreEmulator) {
    violations.push('non-live BFF cannot use the live Firebase project without Firestore emulator');
  }

  if (violations.length > 0) {
    throw buildRuntimeSafetyError(violations);
  }
}

export function assertBffStandaloneWorkerExecutionAllowed(config, workerName = 'worker') {
  assertBffRuntimeSafety(config);

  const violations = [];
  const normalizedWorkerName = readOptionalText(workerName) || 'worker';

  if (config.schedulerOwner === 'disabled') {
    violations.push(`${normalizedWorkerName} cannot run because BFF worker scheduling is disabled`);
  }

  if (config.schedulerOwner === 'vercel') {
    violations.push(`${normalizedWorkerName} cannot run as a standalone process when BFF_SCHEDULER_OWNER=vercel`);
  }

  if (violations.length > 0) {
    throw buildRuntimeSafetyError(violations);
  }
}

export function evaluateWorkerAuthorization({ headerSecret = '', bearerSecret = '' } = {}, policy) {
  const schedulerOwner = policy?.schedulerOwner || 'manual';
  const deployEnv = policy?.deployEnv || 'local';
  const secrets = policy?.secrets || {};

  if (schedulerOwner === 'disabled') {
    return {
      ok: false,
      statusCode: 503,
      code: 'worker_scheduler_disabled',
      message: 'Worker scheduler is disabled for this BFF runtime',
    };
  }

  if ((deployEnv === 'stage' || deployEnv === 'live') && !['vercel', 'k8s'].includes(schedulerOwner)) {
    return {
      ok: false,
      statusCode: 503,
      code: 'worker_scheduler_owner_invalid',
      message: 'Worker scheduler owner is invalid for this BFF runtime',
    };
  }

  if (schedulerOwner === 'vercel') {
    if (!secrets.vercel) {
      return {
        ok: false,
        statusCode: 503,
        code: 'worker_secret_missing',
        message: 'Vercel cron secret is not configured',
      };
    }
    return bearerSecret === secrets.vercel
      ? { ok: true }
      : {
        ok: false,
        statusCode: 401,
        code: 'unauthorized_worker',
        message: 'Worker authorization failed',
      };
  }

  if (schedulerOwner === 'k8s') {
    if (!secrets.k8s) {
      return {
        ok: false,
        statusCode: 503,
        code: 'worker_secret_missing',
        message: 'Kubernetes worker secret is not configured',
      };
    }
    return headerSecret === secrets.k8s || bearerSecret === secrets.k8s
      ? { ok: true }
      : {
        ok: false,
        statusCode: 401,
        code: 'unauthorized_worker',
        message: 'Worker authorization failed',
      };
  }

  if (!secrets.manual) {
    return {
      ok: false,
      statusCode: 503,
      code: 'worker_secret_missing',
      message: 'Worker secret is not configured',
    };
  }

  return headerSecret === secrets.manual || bearerSecret === secrets.manual
    ? { ok: true }
    : {
      ok: false,
      statusCode: 401,
      code: 'unauthorized_worker',
      message: 'Worker authorization failed',
    };
}
