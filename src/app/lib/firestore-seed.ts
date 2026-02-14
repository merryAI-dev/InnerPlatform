// ═══════════════════════════════════════════════════════════════
// MYSC — Firestore 시딩 (하드코딩 → Firestore 일괄 업로드)
// ═══════════════════════════════════════════════════════════════

import {
  writeBatch,
  doc,
  collection,
  getDocs,
  type Firestore,
} from 'firebase/firestore';
import { ORG_COLLECTIONS, getOrgCollectionPath } from './firebase';

import { EMPLOYEES, PART_PROJECTS, PARTICIPATION_ENTRIES } from '../data/participation-data';
import { KOICA_PROJECTS } from '../data/koica-data';
import {
  ORG_MEMBERS,
  PROJECTS,
  LEDGERS,
  TRANSACTIONS,
  COMMENTS,
  EVIDENCES,
  AUDIT_LOGS,
  LEDGER_TEMPLATES,
} from '../data/mock-data';

async function batchWrite<T extends Record<string, any>>(
  db: Firestore,
  collectionPath: string,
  items: T[],
  getId: (item: T) => string,
  orgId?: string,
): Promise<number> {
  const BATCH_LIMIT = 450;
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = items.slice(i, i + BATCH_LIMIT);

    for (const item of chunk) {
      const id = getId(item);
      const ref = doc(db, collectionPath, id);
      const clean = JSON.parse(JSON.stringify(orgId ? { ...item, tenantId: orgId } : item));
      batch.set(ref, clean, { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

export async function seedEmployees(db: Firestore, orgId: string): Promise<number> {
  return batchWrite(db, getOrgCollectionPath(orgId, 'employees'), EMPLOYEES, (e) => e.id, orgId);
}

export async function seedPartProjects(db: Firestore, orgId: string): Promise<number> {
  return batchWrite(db, getOrgCollectionPath(orgId, 'partProjects'), PART_PROJECTS, (p) => p.id, orgId);
}

export async function seedPartEntries(db: Firestore, orgId: string): Promise<number> {
  return batchWrite(db, getOrgCollectionPath(orgId, 'partEntries'), PARTICIPATION_ENTRIES, (e) => e.id, orgId);
}

export async function seedKoicaProjects(db: Firestore, orgId: string): Promise<number> {
  const projects = KOICA_PROJECTS.map((p) => ({
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    period: p.period,
    endDate: p.endDate,
    calcType: p.calcType,
    calcNote: p.calcNote,
    gradeConfigs: p.gradeConfigs,
    currentLabel: p.currentLabel,
    changedLabel: p.changedLabel,
    projectTotal: p.projectTotal || 0,
    notes: p.notes,
  }));

  const projectCount = await batchWrite(
    db,
    getOrgCollectionPath(orgId, 'koicaProjects'),
    projects,
    (p) => p.id,
    orgId,
  );

  const staffEntries: any[] = [];
  for (const project of KOICA_PROJECTS) {
    for (const staff of project.currentStaff) {
      staffEntries.push({ ...staff, projectId: project.id, staffType: 'current' });
    }
    for (const staff of project.changedStaff) {
      staffEntries.push({ ...staff, projectId: project.id, staffType: 'changed' });
    }
  }

  const staffCount = await batchWrite(
    db,
    getOrgCollectionPath(orgId, 'koicaStaff'),
    staffEntries,
    (staff) => `${staff.projectId}_${staff.staffType}_${staff.id}`,
    orgId,
  );

  return projectCount + staffCount;
}

export async function seedMainPlatformData(db: Firestore, orgId: string): Promise<number> {
  let total = 0;

  total += await batchWrite(
    db,
    getOrgCollectionPath(orgId, 'members'),
    ORG_MEMBERS,
    (member) => member.uid,
    orgId,
  );

  total += await batchWrite(db, getOrgCollectionPath(orgId, 'projects'), PROJECTS, (p) => p.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'ledgers'), LEDGERS, (l) => l.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'transactions'), TRANSACTIONS, (t) => t.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'comments'), COMMENTS, (c) => c.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'evidences'), EVIDENCES, (e) => e.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'auditLogs'), AUDIT_LOGS, (a) => a.id, orgId);
  total += await batchWrite(db, getOrgCollectionPath(orgId, 'ledgerTemplates'), LEDGER_TEMPLATES, (t) => t.id, orgId);

  return total;
}

export interface SeedProgress {
  step: string;
  count: number;
  total: number;
}

export async function seedAll(
  db: Firestore,
  orgId: string,
  onProgress?: (p: SeedProgress) => void,
): Promise<{ success: boolean; totalDocs: number; error?: string }> {
  let totalDocs = 0;
  const steps = [
    { name: '직원 데이터', fn: () => seedEmployees(db, orgId) },
    { name: '참여율 사업 정의', fn: () => seedPartProjects(db, orgId) },
    { name: '참여율 배정 데이터', fn: () => seedPartEntries(db, orgId) },
    { name: 'KOICA 프로젝트 & 인력', fn: () => seedKoicaProjects(db, orgId) },
    { name: '메인 플랫폼 데이터', fn: () => seedMainPlatformData(db, orgId) },
  ];

  try {
    for (let i = 0; i < steps.length; i++) {
      onProgress?.({ step: steps[i].name, count: i, total: steps.length });
      const count = await steps[i].fn();
      totalDocs += count;
    }
    onProgress?.({ step: '완료', count: steps.length, total: steps.length });
    return { success: true, totalDocs };
  } catch (err: any) {
    console.error('[MYSC Seed] Error:', err);
    return { success: false, totalDocs, error: err.message || String(err) };
  }
}

export async function getCollectionCounts(db: Firestore, orgId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const key of Object.keys(ORG_COLLECTIONS) as Array<keyof typeof ORG_COLLECTIONS>) {
    try {
      const path = getOrgCollectionPath(orgId, key);
      const snap = await getDocs(collection(db, path));
      counts[key] = snap.size;
    } catch {
      counts[key] = -1;
    }
  }

  return counts;
}
