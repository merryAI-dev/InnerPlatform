export interface ProjectOwnerAssignmentMemberSnapshot {
  projectIds?: string[];
  projectNames?: Record<string, string>;
}

export interface ProjectOwnerAssignmentOwner {
  uid: string;
  name: string;
  email?: string;
}

export function buildProjectOwnerAssignmentPatches(input: {
  projectId: string;
  projectName: string;
  previousOwnerId?: string;
  nextOwner?: ProjectOwnerAssignmentOwner;
  previousMember?: ProjectOwnerAssignmentMemberSnapshot;
  nextMember?: ProjectOwnerAssignmentMemberSnapshot;
}) {
  const projectId = input.projectId.trim();
  const projectName = input.projectName.trim();
  const nextOwnerId = input.nextOwner?.uid.trim() || '';
  const nextOwnerName = input.nextOwner?.name.trim() || '';
  const nextOwnerEmail = input.nextOwner?.email?.trim() || '';
  const previousIds = (input.previousMember?.projectIds || []).filter((id) => id !== projectId);
  const previousNames = { ...(input.previousMember?.projectNames || {}) };
  delete previousNames[projectId];

  const nextIds = Array.from(new Set([...(input.nextMember?.projectIds || []), projectId]));
  const nextNames = { ...(input.nextMember?.projectNames || {}), [projectId]: projectName };

  const ownerPatch = nextOwnerId ? {
    registeredById: nextOwnerId,
    registeredByName: nextOwnerName,
    registeredByEmail: nextOwnerEmail,
    managerId: nextOwnerId,
    managerName: nextOwnerName,
  } : null;

  return {
    project: ownerPatch,
    requestPayload: ownerPatch,
    previous: input.previousOwnerId && input.previousOwnerId !== nextOwnerId
      ? { projectIds: previousIds, projectNames: previousNames }
      : null,
    next: nextOwnerId
      ? { projectIds: nextIds, projectNames: nextNames, projectId }
      : null,
  };
}
