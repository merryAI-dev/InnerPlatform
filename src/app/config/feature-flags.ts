export interface FeatureFlags {
  firebaseAuthEnabled: boolean;
  firestoreCoreEnabled: boolean;
  firebaseUseEnvConfig: boolean;
  firebaseUseEmulators: boolean;
  tenantIsolationStrict: boolean;
  platformApiEnabled: boolean;
  demoLoginEnabled: boolean;
}

const TRUE_SET = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_SET = new Set(['0', 'false', 'no', 'off', 'disabled']);

export function parseFeatureFlag(value: unknown, defaultValue: boolean): boolean {
  if (typeof value !== 'string') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (TRUE_SET.has(normalized)) return true;
  if (FALSE_SET.has(normalized)) return false;
  return defaultValue;
}

export function readFeatureFlags(env: Record<string, unknown> = import.meta.env): FeatureFlags {
  return {
    firebaseAuthEnabled: parseFeatureFlag(env.VITE_FIREBASE_AUTH_ENABLED, false),
    firestoreCoreEnabled: parseFeatureFlag(env.VITE_FIRESTORE_CORE_ENABLED, false),
    firebaseUseEnvConfig: parseFeatureFlag(env.VITE_FIREBASE_USE_ENV_CONFIG, true),
    firebaseUseEmulators: parseFeatureFlag(env.VITE_FIREBASE_USE_EMULATORS, false),
    tenantIsolationStrict: parseFeatureFlag(env.VITE_TENANT_ISOLATION_STRICT, true),
    platformApiEnabled: parseFeatureFlag(env.VITE_PLATFORM_API_ENABLED, false),
    demoLoginEnabled: parseFeatureFlag(env.VITE_DEMO_LOGIN_ENABLED, Boolean(env.DEV)),
  };
}

export const featureFlags = readFeatureFlags();
