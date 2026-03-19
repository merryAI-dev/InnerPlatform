import { normalizeEmail } from './auth-helpers';

type MemberRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MemberRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function pickPreferredValue<T>(primary: T | undefined, fallback: T | undefined): T | undefined {
  if (hasMeaningfulValue(primary)) return primary;
  if (hasMeaningfulValue(fallback)) return fallback;
  return undefined;
}

function mergeObject(primary: unknown, fallback: unknown): MemberRecord | undefined {
  const fallbackRecord = isRecord(fallback) ? fallback : undefined;
  const primaryRecord = isRecord(primary) ? primary : undefined;
  if (!fallbackRecord && !primaryRecord) return undefined;
  return {
    ...(fallbackRecord || {}),
    ...(primaryRecord || {}),
  };
}

function mergeArray(primary: unknown, fallback: unknown): unknown[] | undefined {
  const merged = [
    ...(Array.isArray(fallback) ? fallback : []),
    ...(Array.isArray(primary) ? primary : []),
  ];
  return merged.length > 0 ? merged : undefined;
}

export function buildLegacyMemberDocId(email: unknown): string {
  const normalized = normalizeEmail(typeof email === 'string' ? email : '');
  return normalized ? normalized.replace(/[@.]/g, '_') : '';
}

export function mergeMemberRecordSources(
  canonical: MemberRecord | undefined,
  legacy: MemberRecord | undefined,
): MemberRecord | undefined {
  if (!canonical && !legacy) return undefined;

  const merged: MemberRecord = {
    ...(legacy || {}),
    ...(canonical || {}),
  };

  const pickedFields = [
    'uid',
    'name',
    'email',
    'role',
    'tenantId',
    'department',
    'status',
    'avatarUrl',
    'createdAt',
    'updatedAt',
    'lastLoginAt',
    'defaultWorkspace',
    'lastWorkspace',
  ] as const;

  pickedFields.forEach((field) => {
    const next = pickPreferredValue(canonical?.[field], legacy?.[field]);
    if (next !== undefined) merged[field] = next;
  });

  const mergedProjectIds = mergeArray(canonical?.projectIds, legacy?.projectIds);
  if (mergedProjectIds) merged.projectIds = mergedProjectIds;

  const mergedProjectId = pickPreferredValue(canonical?.projectId, legacy?.projectId);
  if (mergedProjectId !== undefined) merged.projectId = mergedProjectId;

  const mergedProjectNames = mergeObject(canonical?.projectNames, legacy?.projectNames);
  if (mergedProjectNames) merged.projectNames = mergedProjectNames;

  const canonicalPortalProfile = isRecord(canonical?.portalProfile) ? canonical.portalProfile : undefined;
  const legacyPortalProfile = isRecord(legacy?.portalProfile) ? legacy.portalProfile : undefined;
  const mergedPortalProfile = mergeObject(canonicalPortalProfile, legacyPortalProfile);
  if (mergedPortalProfile) {
    const portalProjectIds = mergeArray(canonicalPortalProfile?.projectIds, legacyPortalProfile?.projectIds);
    if (portalProjectIds) mergedPortalProfile.projectIds = portalProjectIds;

    const portalProjectId = pickPreferredValue(
      canonicalPortalProfile?.projectId,
      legacyPortalProfile?.projectId,
    );
    if (portalProjectId !== undefined) mergedPortalProfile.projectId = portalProjectId;

    const portalProjectNames = mergeObject(
      canonicalPortalProfile?.projectNames,
      legacyPortalProfile?.projectNames,
    );
    if (portalProjectNames) mergedPortalProfile.projectNames = portalProjectNames;

    const portalFields = ['updatedAt', 'updatedByUid', 'updatedByName'] as const;
    portalFields.forEach((field) => {
      const next = pickPreferredValue(canonicalPortalProfile?.[field], legacyPortalProfile?.[field]);
      if (next !== undefined) mergedPortalProfile[field] = next;
    });

    merged.portalProfile = mergedPortalProfile;
  }

  return merged;
}
