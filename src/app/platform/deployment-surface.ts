const LIVE_MYSCGUARD_HOSTS = new Set([
  'myscube.myscguard.app',
  'soc.myscguard.app',
  'edge.myscguard.app',
  'audit.myscguard.app',
  'firestore.myscguard.app',
  'github.myscguard.app',
  'drive.myscguard.app',
  'devops.myscguard.app',
]);

function normalizeHostname(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function readCurrentHostname(): string {
  if (typeof window === 'undefined') return '';
  return normalizeHostname(window.location?.hostname);
}

export function isLiveMyscguardHost(hostname = readCurrentHostname()): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return false;
  if (LIVE_MYSCGUARD_HOSTS.has(normalized)) return true;
  return normalized.endsWith('.myscguard.app') && !normalized.includes('stage');
}

export function shouldShowStageOnlyCashflowSheetLab(hostname = readCurrentHostname()): boolean {
  return !isLiveMyscguardHost(hostname);
}
