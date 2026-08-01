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
  return LIVE_MYSCGUARD_HOSTS.has(normalized);
}

export function shouldShowCashflowSheetLab(_hostname = readCurrentHostname()): boolean {
  return true;
}
