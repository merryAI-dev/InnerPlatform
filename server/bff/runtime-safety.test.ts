import { describe, expect, it } from 'vitest';
import {
  assertBffRuntimeSafety,
  assertBffStandaloneWorkerExecutionAllowed,
  evaluateWorkerAuthorization,
  resolveBffRuntimeSafetyConfig,
  resolveBffWorkerAuthPolicy,
} from './runtime-safety.mjs';

const LIVE_PROJECT_ID = 'inner-platform-live-20260316';
const LONG_CRON_SECRET = 'vercel-cron-secret-32-characters-ok';
const LONG_K8S_SECRET = 'k8s-worker-secret-32-characters-ok';

function buildConfig(input: Parameters<typeof resolveBffRuntimeSafetyConfig>[0], env: Record<string, string>) {
  return resolveBffRuntimeSafetyConfig(input, env);
}

describe('BFF runtime safety', () => {
  it('rejects stage/live wildcard origins before Firestore can be initialized', () => {
    const config = buildConfig({
      projectId: 'inner-platform-stage-20260316',
      allowedOrigins: ['*'],
    }, {
      BFF_DEPLOY_ENV: 'stage',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: LONG_CRON_SECRET,
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/BFF_ALLOWED_ORIGINS cannot include \*/);
  });

  it('rejects an invalid explicit deploy env instead of falling back to NODE_ENV or local', () => {
    const config = buildConfig({
      projectId: 'demo-mysc',
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      BFF_DEPLOY_ENV: 'liv',
      NODE_ENV: 'production',
      BFF_WORKERS_ENABLED: 'false',
    });

    expect(config.deployEnv).toBe('invalid:liv');
    expect(() => assertBffRuntimeSafety(config)).toThrow(/BFF_DEPLOY_ENV must be one of/);
  });

  it('rejects an invalid explicit scheduler owner even when workers are disabled', () => {
    const config = buildConfig({
      projectId: 'demo-mysc',
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      BFF_DEPLOY_ENV: 'local',
      BFF_WORKERS_ENABLED: 'false',
      BFF_SCHEDULER_OWNER: 'cron',
    });

    expect(config.schedulerOwner).toBe('invalid:cron');
    expect(() => assertBffRuntimeSafety(config)).toThrow(/BFF_SCHEDULER_OWNER must be one of/);
  });

  it('rejects Vercel preview origins in live BFF allowed origins', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['https://inner-platform-git-feature-merryai-devs-projects.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: LONG_CRON_SECRET,
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/live BFF cannot allow Vercel preview deployment origins/);
  });

  it('rejects non-canonical origins in live BFF even when NODE_ENV implies production', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      NODE_ENV: 'production',
      BFF_WORKERS_ENABLED: 'false',
    });

    expect(config.deployEnv).toBe('live');
    expect(() => assertBffRuntimeSafety(config)).toThrow(/live BFF_ALLOWED_ORIGINS must contain only/);
  });

  it('rejects live BFF when the Firebase project is not the declared live project', () => {
    const config = buildConfig({
      projectId: 'inner-platform-stage-20260316',
      allowedOrigins: ['https://inner-platform.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: LONG_CRON_SECRET,
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/live BFF must use live Firebase project/);
  });

  it('rejects non-live BFF pointed at the live Firebase project without emulator', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      BFF_DEPLOY_ENV: 'stage',
      BFF_SCHEDULER_OWNER: 'disabled',
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/non-live BFF cannot use the live Firebase project/);
  });

  it('allows local emulator runs to use the live project id as an emulator namespace', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      BFF_DEPLOY_ENV: 'local',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    });

    expect(() => assertBffRuntimeSafety(config)).not.toThrow();
  });

  it('rejects weak stage/live scheduler secrets when workers are enabled', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['https://inner-platform.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: 'short',
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/CRON_SECRET must be at least 32 characters/);
  });

  it('treats BFF_WORKERS_ENABLED=false as disabled worker ownership', () => {
    const policy = resolveBffWorkerAuthPolicy({}, {
      BFF_DEPLOY_ENV: 'live',
      BFF_WORKERS_ENABLED: 'false',
      CRON_SECRET: LONG_CRON_SECRET,
    });

    expect(policy.schedulerOwner).toBe('disabled');
    expect(evaluateWorkerAuthorization({ bearerSecret: LONG_CRON_SECRET }, policy)).toMatchObject({
      ok: false,
      code: 'worker_scheduler_disabled',
    });
  });

  it('blocks standalone worker CLIs when workers are disabled', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['https://inner-platform.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_WORKERS_ENABLED: 'false',
    });

    expect(() => assertBffStandaloneWorkerExecutionAllowed(config, 'outbox worker')).toThrow(/worker scheduling is disabled/);
  });

  it('blocks standalone worker CLIs when Vercel owns the scheduler', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['https://inner-platform.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: LONG_CRON_SECRET,
    });

    expect(() => assertBffStandaloneWorkerExecutionAllowed(config, 'outbox worker')).toThrow(/BFF_SCHEDULER_OWNER=vercel/);
  });

  it('blocks Kubernetes scheduler ownership for stage/live while Vercel crons remain configured', () => {
    const config = buildConfig({
      projectId: LIVE_PROJECT_ID,
      allowedOrigins: ['https://inner-platform.vercel.app'],
    }, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'k8s',
      K8S_WORKER_SECRET: LONG_K8S_SECRET,
    });

    expect(() => assertBffRuntimeSafety(config)).toThrow(/k8s is blocked for stage\/live/);
  });

  it('allows standalone worker CLIs when local Kubernetes owns the scheduler', () => {
    const config = buildConfig({
      projectId: 'local-bff',
      allowedOrigins: ['http://127.0.0.1:5173'],
    }, {
      BFF_DEPLOY_ENV: 'local',
      BFF_SCHEDULER_OWNER: 'k8s',
      K8S_WORKER_SECRET: LONG_K8S_SECRET,
    });

    expect(() => assertBffStandaloneWorkerExecutionAllowed(config, 'outbox worker')).not.toThrow();
  });

  it('allows Vercel-owned workers only through the Vercel cron bearer secret', () => {
    const policy = resolveBffWorkerAuthPolicy({}, {
      BFF_DEPLOY_ENV: 'live',
      BFF_SCHEDULER_OWNER: 'vercel',
      CRON_SECRET: LONG_CRON_SECRET,
      BFF_WORKER_SECRET: LONG_K8S_SECRET,
    });

    expect(evaluateWorkerAuthorization({ bearerSecret: LONG_CRON_SECRET }, policy)).toEqual({ ok: true });
    expect(evaluateWorkerAuthorization({ headerSecret: LONG_CRON_SECRET }, policy)).toMatchObject({
      ok: false,
      code: 'unauthorized_worker',
    });
    expect(evaluateWorkerAuthorization({ bearerSecret: LONG_K8S_SECRET }, policy)).toMatchObject({
      ok: false,
      code: 'unauthorized_worker',
    });
  });

  it('allows Kubernetes-owned workers only through the Kubernetes worker secret', () => {
    const policy = resolveBffWorkerAuthPolicy({}, {
      BFF_DEPLOY_ENV: 'local',
      BFF_SCHEDULER_OWNER: 'k8s',
      CRON_SECRET: LONG_CRON_SECRET,
      K8S_WORKER_SECRET: LONG_K8S_SECRET,
    });

    expect(evaluateWorkerAuthorization({ headerSecret: LONG_K8S_SECRET }, policy)).toEqual({ ok: true });
    expect(evaluateWorkerAuthorization({ bearerSecret: LONG_K8S_SECRET }, policy)).toEqual({ ok: true });
    expect(evaluateWorkerAuthorization({ bearerSecret: LONG_CRON_SECRET }, policy)).toMatchObject({
      ok: false,
      code: 'unauthorized_worker',
    });
  });
});
