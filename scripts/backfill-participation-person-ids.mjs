#!/usr/bin/env node
// One-time People SSOT migration. Runtime never falls back to name/nickname.
// 1) backup: node scripts/backfill-participation-person-ids.mjs --dump <dir>
// 2) dry run: node scripts/backfill-participation-person-ids.mjs
// 3) apply:   node scripts/backfill-participation-person-ids.mjs --apply

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function flag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] || fallback);
}

function text(value) {
  return String(value || '').trim();
}

function key(value) {
  return text(value).normalize('NFC').toLowerCase();
}

function syncKey(member) {
  const segment = (value, fallback) => key(value).replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
  return `${segment(member?.memberNickname || member?.memberName, 'member')}__${segment(member?.role, 'role')}`;
}

function add(index, value, personId) {
  const valueKey = key(value);
  if (!valueKey) return;
  const ids = index.get(valueKey) || new Set();
  ids.add(personId);
  index.set(valueKey, ids);
}

function unique(index, values) {
  let candidates = null;
  for (const value of values.map(key).filter(Boolean)) {
    const ids = index.get(value);
    if (!ids?.size) continue;
    candidates = candidates ? new Set([...candidates].filter((id) => ids.has(id))) : new Set(ids);
  }
  return candidates?.size === 1 ? [...candidates][0] : '';
}

const firebaseProjectId = flag('--firebase-project', flag('--project', resolveProjectId()));
const tenantId = flag('--tenant', 'mysc');
const dumpDir = flag('--dump');
const apply = process.argv.includes('--apply');

async function main() {
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const [peopleSnap, projectsSnap, entriesSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/persons`).get(),
    db.collection(`orgs/${tenantId}/projects`).get(),
    db.collection(`orgs/${tenantId}/partEntries`).get(),
  ]);
  const people = peopleSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const knownPersonIds = new Set();
  const peopleByUid = new Map();
  const peopleByName = new Map();
  const peopleByNickname = new Map();
  for (const person of people) {
    const personId = text(person.personId) || person.id;
    if (!personId) continue;
    knownPersonIds.add(personId);
    add(peopleByUid, person.uid, personId);
    add(peopleByName, person.name, personId);
    add(peopleByNickname, person.nickname, personId);
  }
  const teamMemberByProjectKey = new Map();
  for (const projectDoc of projectsSnap.docs) {
    for (const member of (Array.isArray(projectDoc.data()?.teamMembersDetailed) ? projectDoc.data().teamMembersDetailed : [])) {
      teamMemberByProjectKey.set(`${projectDoc.id}:${syncKey(member)}`, member);
    }
  }

  const entries = entriesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const entryPlans = [];
  const resolvedByProjectKey = new Map();
  const unresolved = [];
  for (const entry of entries) {
    const projectId = text(entry.projectId);
    const entryKey = text(entry.projectTeamMemberKey);
    const member = teamMemberByProjectKey.get(`${projectId}:${entryKey}`);
    const existing = text(entry.personId);
    let personId = knownPersonIds.has(existing) ? existing : unique(peopleByUid, [entry.memberId]);
    let source = personId ? (existing ? 'EXISTING_PERSON_ID' : 'EXACT_UID') : '';
    if (!personId && member) {
      const nameId = unique(peopleByName, [member.memberName]);
      const nicknameId = unique(peopleByNickname, [member.memberNickname || member.memberName]);
      personId = nameId && nicknameId && nameId === nicknameId ? nameId : (nameId || nicknameId);
      source = personId ? 'UNIQUE_PEOPLE_IDENTITY' : '';
    }
    if (!personId) {
      unresolved.push({ entryId: entry.id, projectId, projectTeamMemberKey: entryKey, reason: member ? 'NO_UNIQUE_PEOPLE_IDENTITY' : 'PROJECT_TEAM_MEMBER_NOT_FOUND' });
      continue;
    }
    if (existing !== personId) entryPlans.push({ entryId: entry.id, personId, source });
    if (entryKey) {
      const mapKey = `${projectId}:${entryKey}`;
      const previous = resolvedByProjectKey.get(mapKey);
      resolvedByProjectKey.set(mapKey, previous && previous !== personId ? null : personId);
    }
  }

  const projectPlans = [];
  for (const projectDoc of projectsSnap.docs) {
    const current = Array.isArray(projectDoc.data()?.teamMembersDetailed) ? projectDoc.data().teamMembersDetailed : [];
    let changed = false;
    const next = current.map((member) => {
      if (text(member?.personId)) return member;
      const personId = resolvedByProjectKey.get(`${projectDoc.id}:${syncKey(member)}`);
      if (!personId) return member;
      changed = true;
      return { ...member, personId };
    });
    if (changed) projectPlans.push({ projectId: projectDoc.id, teamMembersDetailed: next });
  }

  const report = {
    firebaseProjectId, tenantId, people: people.length, projects: projectsSnap.size, entries: entries.length,
    partEntriesToUpdate: entryPlans.length, projectsToUpdate: projectPlans.length,
    exactUidMatches: entryPlans.filter((plan) => plan.source === 'EXACT_UID').length,
    uniquePeopleIdentityMatches: entryPlans.filter((plan) => plan.source === 'UNIQUE_PEOPLE_IDENTITY').length,
    unresolvedCount: unresolved.length, unresolvedPreview: unresolved.slice(0, 20),
  };
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const file = join(dumpDir, `participation-person-id-${tenantId}-${firebaseProjectId}.json`);
    writeFileSync(file, JSON.stringify({ report, unresolved, projects: projectsSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })), entries: entriesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() })) }, null, 2));
    console.log(`사본 저장: ${file}`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;
  const writes = [
    ...entryPlans.map((plan) => ({ ref: db.doc(`orgs/${tenantId}/partEntries/${plan.entryId}`), data: { personId: plan.personId } })),
    ...projectPlans.map((plan) => ({ ref: db.doc(`orgs/${tenantId}/projects/${plan.projectId}`), data: { teamMembersDetailed: plan.teamMembersDetailed } })),
  ];
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) batch.update(write.ref, write.data);
    await batch.commit();
  }
  console.log(`적용 완료: 참여행 ${entryPlans.length}건 · 프로젝트 ${projectPlans.length}건`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
