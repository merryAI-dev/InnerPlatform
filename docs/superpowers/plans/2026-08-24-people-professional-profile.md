# People Professional Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People에서 최종학력·영어 증빙·자격증을 구조화해 입력하고, 같은 원장을 참여율 대시보드가 권한에 맞춰 표시·서버 필터링하도록 만든다.

**Architecture:** `orgs/{tenantId}/persons/{personId}.professionalProfile`을 유일한 원장으로 두되 Firestore client 직접 접근은 차단한다. 프로필 카탈로그·정규화·파생 facet은 BFF 순수 도메인 모듈 하나가 소유하고, People 하위 리소스 API는 revision 기반 전체 교체와 audit을 같은 transaction에 기록한다. 참여율 BFF는 이미 읽는 persons snapshot을 재사용해 profile summary·option count·필터 결과를 만들며, 프런트엔드는 capability, 선택 code, 서버 응답만 보관한다.

**Tech Stack:** Node.js ESM BFF, Express, Zod, Firestore transactions/rules emulator, policy-as-code RBAC, React 18, TypeScript, Vitest, Supertest, Playwright, Tailwind/shadcn UI.

---

## File map

- `policies/professional-profile-catalog.json`: 학력·영어 시험·점수 체계의 versioned 단일 진실.
- `server/bff/professional-profile-catalog.mjs`: catalog load/validate/label lookup.
- `server/bff/professional-profile.mjs`: profile 정규화, 최고학력, 영어 facet, 표시 문자열, filter option 계산.
- `server/bff/professional-profile.test.mjs`: catalog·정규화·RAG fingerprint·facet 순수 계약.
- `server/bff/schemas.mjs`: create/PUT profile payload의 구조·개수·길이 schema.
- `server/bff/routes/persons.mjs`: People 목록 allowlist/capability와 optional atomic create-with-profile.
- `server/bff/routes/person-professional-profiles.mjs`: catalog/GET/PUT 하위 리소스 API.
- `server/bff/routes/person-professional-profiles.test.mjs`: 권한, revision, idempotency, audit 원자성 route 계약.
- `server/bff/participation-dashboard.mjs`: profile summary, pre-filter option count, server-side filtering.
- `server/bff/routes/participation-dashboard.mjs`: permission-aware query validation/response shaping/no-store.
- `server/bff/participation-dashboard.test.mjs`: View/year/profile filter와 기존 월 집계 불변 계약.
- `server/bff/app.mjs`: RBAC policy와 새 profile route dependency injection.
- `server/bff/app.integration.test.ts`: People PUT → persisted person → participation GET end-to-end 및 read-only 증명.
- `policies/rbac-policy.json`: 현재 4-role 체계 안의 전문 프로필 read/write permission.
- `src/app/platform/rbac.ts`: 프런트 policy type/catalog 정렬. UI 권한 판단은 capability만 사용한다.
- `firebase/firestore.rules`: persons 전체를 BFF-only로 전환.
- `src/app/platform/firestore-rules-policy.test.ts`: rules 문자열 계약.
- `server/bff/firestore-rules.edit-leases.integration.test.ts`: 실제 rules emulator에서 persons direct CRUD 전부 거부.
- `src/app/lib/person-professional-profile-client.ts`: profile catalog/GET/PUT 전용 client와 DTO.
- `src/app/lib/person-professional-profile-client.test.ts`: method/path/body/idempotency/signal 전송 계약.
- `src/app/lib/platform-bff-client.ts`: People capability 및 participation profile response/query type.
- `src/app/components/people/ProfessionalProfileEditor.tsx`: dialog 생명주기의 local draft/revision editor.
- `src/app/components/people/PeopleDirectoryPage.tsx`: capability 기반 editor 조립.
- `src/app/components/participation/ParticipationProfileFilters.tsx`: 서버 option을 그대로 보여주는 controlled filter.
- `src/app/components/participation/ParticipationPage.tsx`: URL filter, abortable fetch, permission-aware 14/17열 렌더링.
- `src/app/data/persons-bff-boundary.contract.test.ts`: 프런트 People 소비자가 client Firestore persons를 직접 참조하지 않는 계약.
- `tests/e2e/people-professional-profile.spec.ts`: People 입력/저장/충돌/재조회 브라우저 흐름.
- `tests/e2e/participation-project-breakdown.spec.ts`: profile access/filter/0명/stale/mobile/17열 회귀.
- `docs/architecture/contracts/2026-08-24-people-professional-profile-contract.md`: 운영·권한·필터·RAG·배포 계약.

## 고정 불변조건

```text
1. persons professionalProfile은 BFF를 거치지 않고 읽거나 쓸 수 없다.
2. profile 실제 변경과 PROFILE_UPDATE audit은 한 transaction이다.
3. identical save와 stale-but-same save는 revision/time/audit을 바꾸지 않는다.
4. People 목록 DTO에는 professionalProfile이 절대 들어가지 않는다.
5. 참여율 무권한 응답에는 summary/options/raw profile 값이 없다.
6. 참여율 profile option/count/filter/display는 서버만 계산한다.
7. profile filter는 사람 목록만 줄이고 월 합계·프로젝트 breakdown을 다시 계산하지 않는다.
8. highest education은 전체 이력 중 catalog rank 최고 한 건이다.
9. TOEIC/TOEFL 등 시험 facet과 해외 대학 facet이 모두 없을 때만 영어 미입력이다.
10. canonical DB에는 code/fact/provenance만 저장하고 검색 문장·embedding은 저장하지 않는다.
```

### Task 0: Freeze the sprint contract and prove the baseline

**Files:**
- Create: `.gstack/sprint-contract-2026-08-24-people-professional-profile.md`
- Reference: `docs/superpowers/specs/2026-08-24-people-professional-profile-design.md`

- [ ] **Step 1: Use `/sprint` and record the approved contract**

The contract must explicitly fail on:

```text
- UI만 채워지고 persons 문서나 dashboard read-model이 바뀌지 않음
- client SDK가 persons를 직접 read/write함
- audit 실패 뒤 profile만 남거나 profile 실패 뒤 audit만 남음
- 무권한 body 또는 People 목록에 학교·점수·자격증 원문이 노출됨
- frontend가 profile filter, option count, highest education을 계산함
- stale PUT이 최신 profile을 덮음
- profile filter 적용 뒤 option count가 흔들리거나 월 합계가 바뀜
- dialog close 뒤 다른 사람에게 이전 draft가 남음
```

- [ ] **Step 2: Record the dirty-tree boundary before coding**

Run:

```bash
git status --short
git diff -- AGENTS.md src/app/components/participation/ParticipationPage.tsx tests/e2e/participation-project-breakdown.spec.ts
```

Expected: the existing AGENTS policy edit and already-approved blank profile-column work are preserved. Never stage `.superpowers/` or `.understand-anything/`.

- [ ] **Step 3: Run baseline gates**

Run:

```bash
npx vitest run server/bff/routes/persons.test.mjs server/bff/participation-dashboard.test.mjs src/app/platform/firestore-rules-policy.test.ts src/app/components/participation/ParticipationPage.shell.test.ts
npm run typecheck
npm run build
```

Expected: current baseline passes, with no new TypeScript errors and production build exit 0.

### Task 1: Build the versioned professional-profile domain

**Files:**
- Create: `policies/professional-profile-catalog.json`
- Create: `server/bff/professional-profile-catalog.mjs`
- Create: `server/bff/professional-profile.mjs`
- Create: `server/bff/professional-profile.test.mjs`

- [ ] **Step 1: Write catalog and normalization RED tests**

Cover these exact inputs:

```js
const input = {
  educationRecords: [
    { attainmentCode: 'BACHELOR_GRADUATED', institutionName: '연세대학교', countryCode: 'KR', major: '경영학' },
    { attainmentCode: 'MASTER_GRADUATED', institutionName: 'University of Sussex', countryCode: 'GB', major: 'Development Studies' },
  ],
  englishEvidence: [
    { testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '920', otherTestName: '', testedAt: '2026-06' },
    { testCode: 'TOEFL', scaleCode: 'TOEFL_IBT_120', resultValue: '105', otherTestName: null, testedAt: '2025-12' },
  ],
  certifications: [{ label: ' PMP ' }, { label: 'pmp' }, { label: 'ODA 전문가' }],
};
```

Assert:

```js
expect(normalizeProfessionalProfileInput(input)).toEqual({
  educationRecords: expect.arrayContaining([
    expect.objectContaining({ institutionName: '연세대학교', countryCode: 'KR' }),
    expect.objectContaining({ attainmentCode: 'MASTER_GRADUATED', countryCode: 'GB' }),
  ]),
  englishEvidence: expect.arrayContaining([
    expect.objectContaining({ testCode: 'TOEIC', resultValue: '920', otherTestName: null }),
  ]),
  certifications: [
    { key: 'pmp', label: 'PMP' },
    { key: 'oda 전문가', label: 'ODA 전문가' },
  ],
});
expect(deriveProfessionalProfileFacts(input)).toMatchObject({
  highestEducationCode: 'MASTER_GRADUATED',
  englishFacets: ['TOEIC', 'TOEFL', 'OVERSEAS_EDUCATION'],
  highestEducationDisplayText: '석사 졸업 · University of Sussex',
  englishEvidenceDisplayText: 'TOEIC 920 · TOEFL 105 · 해외 대학',
  certificationsDisplayText: 'PMP · ODA 전문가',
});
```

Also assert:

- whitespace becomes `null` for institution/country/major/otherTestName/testedAt;
- missing profile normalizes to empty arrays and revision 0;
- equal-rank education keeps the earlier record;
- highest-education filter uses only the winning record, not any lower record;
- any non-`KR` country adds `OVERSEAS_EDUCATION`;
- no test and no overseas education yields only `__MISSING__` at API facet time;
- `OTHER` requires `otherTestName`; standard tests reject it;
- TOEIC/TOEFL/OPIc/IELTS/TEPS range or enum violations fail;
- 11 education rows, 11 English rows, 21 certificates, or strings over 80 fail;
- RAG fingerprint changes when profile revision or `catalogVersion` changes.

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
npx vitest run server/bff/professional-profile.test.mjs
```

Expected: FAIL because the modules/catalog do not exist.

- [ ] **Step 3: Add the minimal catalog**

The JSON must contain:

```json
{
  "catalogVersion": 1,
  "educationAttainments": [
    { "code": "HIGH_SCHOOL_GRADUATED", "label": "고등학교 졸업", "rank": 10 },
    { "code": "ASSOCIATE_GRADUATED", "label": "전문학사 졸업", "rank": 20 },
    { "code": "BACHELOR_ENROLLED", "label": "학사 재학", "rank": 30 },
    { "code": "BACHELOR_GRADUATED", "label": "학사 졸업", "rank": 40 },
    { "code": "MASTER_ENROLLED", "label": "석사 재학", "rank": 50 },
    { "code": "MASTER_COMPLETED", "label": "석사 수료", "rank": 55 },
    { "code": "MASTER_GRADUATED", "label": "석사 졸업", "rank": 60 },
    { "code": "DOCTOR_ENROLLED", "label": "박사 재학", "rank": 70 },
    { "code": "DOCTOR_COMPLETED", "label": "박사 수료", "rank": 75 },
    { "code": "DOCTOR_GRADUATED", "label": "박사 졸업", "rank": 80 },
    { "code": "OTHER", "label": "기타", "rank": 1 }
  ]
}
```

Add English tests/scales for `TOEIC_990`, `TOEFL_IBT_120`, `TOEFL_IBT_6`, `TOEFL_PBT_677`, OPIc grades, IELTS 0–9, TEPS 0–600, and free-text `OTHER`. Keep labels/order/result validation in this file rather than React or route code.

Load the JSON through a statically traceable module-relative URL (or an explicit Vercel `includeFiles` entry), not an unconstrained runtime path. Add a packaging contract test that imports the catalog through the same production entry so a locally passing but serverless-missing JSON cannot ship.

- [ ] **Step 4: Implement pure catalog/domain helpers**

Export only focused operations:

```js
export function getProfessionalProfileCatalog() {}
export function normalizeProfessionalProfileInput(input) {}
export function normalizeStoredProfessionalProfile(value) {}
export function deriveProfessionalProfileFacts(profile) {}
export function serializeProfessionalProfile(profile) {}
export function buildProfessionalProfileRagFingerprint({ tenantId, personId, profile }) {}
```

Certification key normalization must be deterministic:

```js
const label = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
const key = label.toLocaleLowerCase('ko-KR');
```

Do not add a generic plugin/registry abstraction; this is one versioned catalog and one domain module.

- [ ] **Step 5: Re-run, sabotage, and commit**

Run:

```bash
npx vitest run server/bff/professional-profile.test.mjs
```

Expected: PASS. Temporarily select the first education record instead of highest rank and confirm the highest-education test fails; restore.

Commit only these files:

```bash
git add policies/professional-profile-catalog.json server/bff/professional-profile-catalog.mjs server/bff/professional-profile.mjs server/bff/professional-profile.test.mjs
git diff --cached --check
git commit -m "feat(people): define professional profile domain"
```

### Task 2: Establish policy-as-code and the Firestore security boundary

**Files:**
- Modify: `policies/rbac-policy.json`
- Modify: `src/app/platform/rbac.ts`
- Modify: `src/app/platform/rbac.test.ts`
- Modify: `firebase/firestore.rules`
- Modify: `src/app/platform/firestore-rules-policy.test.ts`
- Modify: `server/bff/firestore-rules.edit-leases.integration.test.ts`

- [ ] **Step 1: Write RBAC and rules RED tests**

Assert policy permissions:

```ts
expect(hasPermission('admin', 'person:professional_profile:read')).toBe(true);
expect(hasPermission('finance', 'person:professional_profile:write')).toBe(true);
expect(hasPermission('pm', 'person:professional_profile:read')).toBe(false);
expect(hasPermission('viewer', 'person:professional_profile:write')).toBe(false);
expect(rbacPolicy.roles).toEqual(['admin', 'finance', 'pm', 'viewer']);
```

In the rules emulator, add `persons` to protected targets and assert for `admin`, `finance`, `pm`, and `viewer`:

```js
await assertFails(getDoc(doc(clientDb, 'orgs/mysc/persons/person-a')));
await assertFails(getDocs(collection(clientDb, 'orgs/mysc/persons')));
await assertFails(setDoc(doc(clientDb, 'orgs/mysc/persons/new'), fixture));
await assertFails(updateDoc(doc(clientDb, 'orgs/mysc/persons/person-a'), { name: '변경' }));
await assertFails(deleteDoc(doc(clientDb, 'orgs/mysc/persons/person-a')));
```

Seed/read with Admin SDK to prove BFF access remains possible.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npx vitest run src/app/platform/rbac.test.ts src/app/platform/firestore-rules-policy.test.ts
npm run bff:test:integration -- --runInBand
```

Expected: permission checks fail and direct persons access is still allowed. If the integration script does not accept the extra argument, run `npm run bff:test:integration` unchanged.

- [ ] **Step 3: Update RBAC without widening role assignment**

Add role and permissions:

```json
"roles": ["admin", "finance", "pm", "viewer"],
"permissions": [
  "person:professional_profile:read",
  "person:professional_profile:write"
]
```

Grant both only to `admin` and `finance`. Keep the existing four roles and role-change rules unchanged:

```json
"roleChangeRules": {
  "admin": ["admin", "finance", "pm", "viewer"]
}
```

Add the two permissions to `PlatformPermission`/`KNOWN_PERMISSIONS`. Do not expand `UserRole`, `PlatformRole`, navigation policy, or role-change targets; that would reverse the repository's 8→4 role simplification. UI actions still use server capability, never a role comparison. Assert:

```ts
expect(hasPermission('admin', 'person:professional_profile:read')).toBe(true);
expect(hasPermission('finance', 'person:professional_profile:write')).toBe(true);
expect(hasPermission('pm', 'person:professional_profile:read')).toBe(false);
expect(hasPermission('viewer', 'person:professional_profile:write')).toBe(false);
```

- [ ] **Step 4: Make persons BFF-only**

Add `persons` to `isBffOnlyCollection` and an explicit collection/document deny match consistent with existing protected collections. The catchall must not grant access back to persons.

- [ ] **Step 5: Run sabotage and commit**

Run:

```bash
npx vitest run src/app/platform/rbac.test.ts src/app/platform/firestore-rules-policy.test.ts
npm run bff:test:integration
```

Expected: all pass. Temporarily remove `persons` only from the catchall exclusion while leaving the explicit match; emulator CRUD denial must fail. Restore.

Commit:

```bash
git add policies/rbac-policy.json src/app/platform/rbac.ts src/app/platform/rbac.test.ts firebase/firestore.rules src/app/platform/firestore-rules-policy.test.ts server/bff/firestore-rules.edit-leases.integration.test.ts
git diff --cached --check
git commit -m "security(people): make professional profiles BFF-only"
```

### Task 3: Add atomic People profile APIs and safe directory serialization

**Files:**
- Modify: `server/bff/schemas.mjs`
- Modify: `server/bff/routes/persons.mjs`
- Create: `server/bff/routes/person-professional-profiles.mjs`
- Modify: `server/bff/routes/persons.test.mjs`
- Create: `server/bff/routes/person-professional-profiles.test.mjs`
- Modify: `server/bff/app.mjs`

- [ ] **Step 1: Add RED tests for directory allowlisting and capabilities**

Seed a person containing `professionalProfile`, `email`, `note`, and `uid`. Assert:

```js
expect(response.body).toMatchObject({
  capabilities: { professionalProfileRead: true, professionalProfileWrite: true },
});
expect(response.body.items[0]).not.toHaveProperty('professionalProfile');
expect(JSON.stringify(response.body.items[0])).not.toContain('University of Sussex');
```

Add permission matrix cases: admin/finance have both capabilities; pm/viewer have false. Preserve existing base directory readability through `readCore`.

- [ ] **Step 2: Add RED tests for catalog/GET/PUT**

Build the route harness with injected `rbacPolicy`, `auditChainService.appendManyInTransaction`, transactional create support, and deterministic time. Test:

```text
GET catalog: read permission, catalogVersion, no person data, no-store
GET profile: missing stored profile => empty arrays/revision 0, no-store
PUT first change: expectedRevision 0 => revision 1/changed true
PUT identical: changed false and exact person/audit/head snapshots unchanged
PUT stale-but-same: changed false
PUT stale-different: 409 professional_profile_revision_conflict + currentRevision only
PUT invalid/unknown/over-limit: 400 and no write
GET/PUT missing person: 404 without cross-tenant value disclosure
admin/finance allowed; pm/viewer and legacy non-policy roles forbidden
```

Assert response body shape:

```js
expect(response.body).toEqual({
  profile: expect.objectContaining({ schemaVersion: 1, educationRecords: expect.any(Array) }),
  revision: 1,
  changed: true,
});
```

- [ ] **Step 3: Add Zod command schemas**

Create strict schemas for:

```js
professionalProfileInputSchema
personProfessionalProfilePutSchema // { expectedRevision, profile }
```

Unknown keys must fail. Let the pure domain validator enforce catalog-dependent result rules after structural Zod validation.

- [ ] **Step 4: Replace raw People spreading with an allowlist serializer**

In `persons.mjs`, introduce:

```js
function serializePersonDirectoryItem(person) {
  return {
    personId: person.personId,
    name: person.name || '',
    nickname: person.nickname || '',
    email: person.email || '',
    departmentTop: person.departmentTop || '',
    departmentMid: person.departmentMid || '',
    departmentSub: person.departmentSub || '',
    title: person.title || '',
    grade: person.grade || '',
    workLocation: person.workLocation || '',
    joinedAt: person.joinedAt || '',
    uid: person.uid || null,
    employments: Array.isArray(person.employments) ? person.employments : [],
  };
}
```

Do not include `professionalProfile`. Inject `rbacPolicy`; return capability booleans obtained from the same policy helper used by the routes.

- [ ] **Step 5: Implement the profile sub-resource routes**

Mount:

```js
GET /api/v1/person-professional-profile/catalog
GET /api/v1/persons/:personId/professional-profile
PUT /api/v1/persons/:personId/professional-profile
```

All profile routes use `assertActorPermissionAllowed(rbacPolicy, req, permission, action)`. GET responses and profile-aware People responses set:

```js
res.setHeader('Cache-Control', 'private, no-store');
```

Install the no-store header middleware before `createMutatingRoute` handles the PUT path. Idempotency replay returns before the inner handler, so a header set only inside the handler is incomplete. Test both fresh and replay responses.

The PUT transaction order must be:

```js
const result = await db.runTransaction(async (tx) => {
  const personSnap = await tx.get(personRef);
  // normalize/compare/revision decision
  if (noChange) return { changed: false, profile: currentProfile, revision: currentRevision };
  await auditChainService.appendManyInTransaction(tx, [redactedAuditEntry]);
  tx.set(personRef, { professionalProfile: nextProfile, updatedAt, updatedBy }, { merge: true });
  return { changed: true, profile: nextProfile, revision: nextRevision };
});
```

`appendManyInTransaction` reads the audit head, so call it before `tx.set`. Audit metadata contains only:

```js
{ source: 'bff', fields: ['educationRecords', 'englishEvidence', 'certifications'], previousRevision, nextRevision }
```

Never include institutions, scores, test names, dates, majors, or certificates in details/metadata.

- [ ] **Step 6: Make optional create-with-profile atomic**

Extend `personCreateSchema` with optional `professionalProfile`. If present, require both legacy `personWrite` and `person:professional_profile:write` before the transaction. Normalize it, set revision 1 only if content is non-empty, and append CREATE plus redacted PROFILE_UPDATE audit entries through `appendManyInTransaction` in the same person-create transaction. A permission or audit failure must leave no person document.

Do not retrofit existing employment/profile-only PATCH routes beyond what is necessary for serializer/dependency injection.

- [ ] **Step 7: Mount dependencies and prove route reachability**

In `app.mjs`, inject the already loaded `rbacPolicy` into `mountPersonRoutes`, `mountPersonProfessionalProfileRoutes`, and later the participation route. Add a route smoke test so a dead/unmounted module cannot pass only its pure tests.

- [ ] **Step 8: Run transaction sabotage and commit**

Run:

```bash
npx vitest run server/bff/professional-profile.test.mjs server/bff/routes/persons.test.mjs server/bff/routes/person-professional-profiles.test.mjs
```

Expected: PASS. Make `appendManyInTransaction` throw and assert person/profile/audit head/log snapshots are unchanged. Temporarily update `updatedAt` in the no-op branch and verify the no-op snapshot test fails; restore.

Commit:

```bash
git add server/bff/schemas.mjs server/bff/routes/persons.mjs server/bff/routes/person-professional-profiles.mjs server/bff/routes/persons.test.mjs server/bff/routes/person-professional-profiles.test.mjs server/bff/app.mjs
git diff --cached --check
git commit -m "feat(people): add atomic professional profile API"
```

### Task 4: Add permission-aware server-side profile filtering to participation

**Files:**
- Modify: `server/bff/participation-dashboard.mjs`
- Modify: `server/bff/routes/participation-dashboard.mjs`
- Modify: `server/bff/participation-dashboard.test.mjs`

- [ ] **Step 1: Add a RED fixture that separates base set, options, and filtered set**

Use a saved KOICA rule for 2026 and seed:

```js
people: [
  { personId: 'p1', name: '김정태', professionalProfile: masterGbToeicPmp },
  { personId: 'p2', name: '이예지', professionalProfile: bachelorKrToefl },
  { personId: 'p3', name: '김세은' },
  { personId: 'p4', name: '과거인력', professionalProfile: doctorKrToeic },
]
```

Give p1–p3 an owned 2026 month in matching projects, p4 only a 2025 month. Assert before profile filtering:

- base option counts include p1–p3 only;
- `MASTER_GRADUATED`, `TOEIC`, `TOEFL`, `OVERSEAS_EDUCATION`, `__MISSING__`, `pmp` counts are correct;
- standard education and English choices with 0 people still exist;
- p4 is absent from counts;
- option counts remain unchanged after choosing `education=MASTER_GRADUATED`;
- selected certificate remains present with count 0 after switching to a View where nobody has it.

Assert filtering:

```text
education exact on derived highest education
englishEvidence exact facet
certification repeat values OR
education × English × certificate dimensions AND
__MISSING__ exclusive within one dimension
```

Compare the surviving member's `months`, `projects`, `warnings`, and parent snapshot's `unlinkedEntryCount` byte-for-byte to the unfiltered member/snapshot.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs -t "전문 프로필|최종학력|영어 증빙|자격증"
```

Expected: FAIL because summary/options/query filters do not exist.

- [ ] **Step 3: Add profile facts without another Firestore read**

While `buildParticipationDashboardSnapshot` already joins entry `personId` to persons, attach normalized derived profile facts to the internal member row only. Do not serialize the raw `professionalProfile`.

Extend `selectParticipationDashboardYear` with a fourth options argument:

```js
selectParticipationDashboardYear(snapshot, year, ruleId, {
  professionalProfileAccess,
  education,
  englishEvidence,
  certifications,
})
```

Processing order is fixed:

```text
selected rule → selected-year owned-month members (base set)
→ profile filter options/counts from base set
→ requested profile filters
→ final member DTO with allowlisted display summary
```

No Firestore query or per-member read may be added.

- [ ] **Step 4: Validate query and permission at the route**

Inject `rbacPolicy`. Determine read permission once. If a caller without profile read permission sends any profile query, return:

```js
throw createHttpError(403, '전문 프로필 필터를 사용할 권한이 없습니다.', 'profile_filter_forbidden');
```

Reject unknown catalog codes, multiple education/English values, `__MISSING__` mixed with real values, more than 20 certification values, or oversized keys as 400 before reading Firestore where possible.

Unauthorized ordinary response:

```js
{ professionalProfileAccess: false, /* no profileFilterOptions, selectedProfileFilters, member.profileSummary */ }
```

Authorized response:

```js
{
  professionalProfileAccess: true,
  selectedProfileFilters: { education: null, englishEvidence: null, certifications: [] },
  profileFilterOptions: { education: [], englishEvidence: [], certifications: [] },
  members: [{ profileSummary: {
    highestEducationDisplayText: '석사 졸업 · University of Sussex',
    englishEvidenceDisplayText: 'TOEIC 920 · 해외 대학',
    certificationsDisplayText: 'PMP',
  }}],
}
```

Set `Cache-Control: private, no-store` for the dashboard response. `projects` top-level metadata remains as before.

- [ ] **Step 5: Add PII and fixed-read-count tests**

For unauthorized and authorized payloads, JSON-stringify and assert forbidden raw fields are absent: `email`, `uid`, `note`, full `educationRecords`, `testedAt`, and a fixture secret not present in display output. Instrument the DB harness to assert exactly the existing four collection reads and zero writes.

- [ ] **Step 6: Sabotage and commit**

Run:

```bash
npx vitest run server/bff/professional-profile.test.mjs server/bff/participation-dashboard.test.mjs
```

Expected: PASS. Temporarily compute option counts from the already filtered members and verify the stable-count test fails; restore. Temporarily use any education history record instead of highest education and verify the education test fails; restore.

Commit:

```bash
git add server/bff/participation-dashboard.mjs server/bff/routes/participation-dashboard.mjs server/bff/participation-dashboard.test.mjs server/bff/app.mjs
git diff --cached --check
git commit -m "feat(participation): filter professional profiles on server"
```

### Task 5: Prove persisted People-to-participation behavior in the emulator

**Files:**
- Modify: `server/bff/app.integration.test.ts`

- [ ] **Step 1: Add an end-to-end RED scenario**

Using the real BFF and Firestore emulator:

1. seed a linked person and participation entry;
2. `PUT /api/v1/persons/:personId/professional-profile` with revision 0;
3. read the raw person doc and assert canonical code facts/provenance revision 1;
4. `GET /api/v1/participation-dashboard?year=2026&ruleId=koica&education=MASTER_GRADUATED&englishEvidence=TOEIC&certification=pmp`;
5. assert the same person appears with the expected summary and unchanged January rate/project breakdown;
6. filter a nonmatching certificate and assert 0 members but the selected option remains with count 0;
7. repeat identical PUT and assert the entire person plus audit collections remain unchanged;
8. issue stale-different PUT and assert 409/currentRevision with no write;
9. run the dashboard GET with pm/viewer and assert profile query 403 and ordinary response PII-free.

- [ ] **Step 2: Snapshot the whole affected read/write boundary**

Before and after dashboard GETs, compare stable `{id,data}` snapshots for:

```text
projects, partEntries, persons, participation_rules, audit_logs, audit_chain
```

GET must change none. PUT may change only the selected person, one audit log, and audit head.

- [ ] **Step 3: Run RED then GREEN**

Run the focused app integration test first, then full:

```bash
npm run bff:test:integration
```

Expected: all emulator suites pass. A UI/mock-only green is not sufficient.

- [ ] **Step 4: Commit**

```bash
git add server/bff/app.integration.test.ts
git diff --cached --check
git commit -m "test(people): verify professional profile persistence"
```

### Task 6: Add typed clients without putting profile facts in the global People store

**Files:**
- Create: `src/app/lib/person-professional-profile-client.ts`
- Create: `src/app/lib/person-professional-profile-client.test.ts`
- Modify: `src/app/lib/platform-bff-client.ts`
- Modify: `src/app/lib/platform-bff-client.test.ts`
- Create: `src/app/data/persons-bff-boundary.contract.test.ts`

- [ ] **Step 1: Add client RED tests**

Assert exact calls:

```ts
GET /api/v1/person-professional-profile/catalog
GET /api/v1/persons/person-a/professional-profile
PUT /api/v1/persons/person-a/professional-profile
body: { expectedRevision: 1, profile: draft }
Idempotency-Key present
```

For participation, assert:

```ts
education=MASTER_GRADUATED
englishEvidence=TOEIC
certification=pmp&certification=oda%20전문가
AbortSignal forwarded to client.get
```

- [ ] **Step 2: Implement a feature client**

Keep profile DTOs and methods in `person-professional-profile-client.ts`. Use the existing `PlatformApiClientLike.request({ method: 'PUT' })` pattern rather than adding an unrelated global convenience method.

Add only these safe changes to `platform-bff-client.ts`:

- `fetchPersonsViaBff` response capability type;
- participation `professionalProfileAccess`, options, selected filters, and optional summary types;
- optional profile query values and `signal` forwarding.

Do **not** add `professionalProfile` to `PersonRecord`, `useAppStore`, or `use-person-roster`.

Add a contract test that scans the production People consumers (`store.tsx`, `use-person-roster.ts`, `PeopleDirectoryPage.tsx`) and fails if they import Firestore collection/document helpers for `persons`; they must call the BFF wrapper.

- [ ] **Step 3: Run and commit**

```bash
npx vitest run src/app/lib/person-professional-profile-client.test.ts src/app/lib/platform-bff-client.test.ts src/app/data/persons-bff-boundary.contract.test.ts
```

Expected: PASS.

```bash
git add src/app/lib/person-professional-profile-client.ts src/app/lib/person-professional-profile-client.test.ts src/app/lib/platform-bff-client.ts src/app/lib/platform-bff-client.test.ts src/app/data/persons-bff-boundary.contract.test.ts
git diff --cached --check
git commit -m "feat(people): add professional profile clients"
```

### Task 7: Add the People professional-profile editor

**Files:**
- Create: `src/app/components/people/ProfessionalProfileEditor.tsx`
- Create: `src/app/components/people/ProfessionalProfileEditor.shell.test.ts`
- Modify: `src/app/components/people/PeopleDirectoryPage.tsx`
- Modify: `src/app/components/people/PeopleDirectoryPage.shell.test.ts`
- Create: `tests/e2e/people-professional-profile.spec.ts`
- Modify: `playwright.participation.config.mjs`

- [ ] **Step 1: Add RED tests for capability and draft lifecycle**

Pin these states:

```text
capability read=false: profile section/action absent
read=true/write=false: visible read-only profile
dialog open: catalog + one-person GET, not global list hydration
dialog close/reopen: fresh GET, prior unsaved draft absent
legacy missing profile: empty rows and expectedRevision 0
save: exact PUT body/idempotency key, normalized server response replaces draft
409: dialog and draft remain; latest-reload action performs GET
400/500: input remains and retry is possible
max 10 education / 10 English / 20 certifications enforced in UI and server
```

- [ ] **Step 2: Implement a focused editor component**

`ProfessionalProfileEditor` owns only:

```ts
catalog, draft, expectedRevision, loading, saving, error
```

Unmounting it must discard them. Render:

- 복수 학력 행: 학력 상태, 학교, 국가(ISO2 select/input), 전공;
- 복수 영어 증빙 행: 시험, scale, 결과, 기타 시험명 조건부, 시험월;
- 자격증 tag input: comma/newline split, server normalized result displayed after save.

Use catalog labels/options directly. Do not duplicate the education/English code list in React.

Abort catalog/profile GET requests when the dialog scope closes or personId changes. Do not abort an in-flight PUT after it may have committed: disable closing while saving, keep its idempotency key stable, and suppress only stale/unmounted state publication.

- [ ] **Step 3: Compose from PeopleDirectoryPage**

Store the top-level `capabilities` from `fetchPersonsViaBff`. Pass selected `personId` and read/write booleans to the editor. Existing employment/profile base fields remain intact.

For create-with-profile, include profile only when the feature area is visible and the user actually entered profile facts. A user lacking profile write capability must not be offered those inputs.

- [ ] **Step 4: Add Playwright user flows**

Mock or harness the exact endpoints and prove catalog → GET → PUT → close → reopen. Include conflict/error flows and assert no professional data appears in the `/persons` list response or unrelated app store requests.

- [ ] **Step 5: Run UI quality gates and commit**

Run:

```bash
npx vitest run src/app/components/people/ProfessionalProfileEditor.shell.test.ts src/app/components/people/PeopleDirectoryPage.shell.test.ts
npm run test:e2e:participation
npm run typecheck
npm run build
```

Expected: all pass. Score the UI with `~/.gstack/eval-criteria.md`; each dimension must be at least 10 and total at least 70.

Commit:

```bash
git add src/app/components/people/ProfessionalProfileEditor.tsx src/app/components/people/ProfessionalProfileEditor.shell.test.ts src/app/components/people/PeopleDirectoryPage.tsx src/app/components/people/PeopleDirectoryPage.shell.test.ts tests/e2e/people-professional-profile.spec.ts playwright.participation.config.mjs
git diff --cached --check
git commit -m "feat(people): edit professional profiles"
```

### Task 8: Add server-backed profile filters and permission-aware columns

**Files:**
- Create: `src/app/components/participation/ParticipationProfileFilters.tsx`
- Create: `src/app/components/participation/ParticipationProfileFilters.shell.test.ts`
- Modify: `src/app/components/participation/ParticipationPage.tsx`
- Modify: `src/app/components/participation/ParticipationPage.shell.test.ts`
- Modify: `tests/e2e/participation-project-breakdown.spec.ts`

- [ ] **Step 1: Add RED tests for 14/17-column permission behavior**

Assert:

```text
professionalProfileAccess absent/false → profile filters absent, 14 headers/cells
access true → 사람|참여 사업|최종학력|영어 증빙|자격증|1월…12월, 17 cells
access true + missing member summary → 3 visible — cells with accessible 미입력 names
expanded project detail → the 3 profile cells are blank and month starts at index 5
```

The currently approved blank-column dirty diff must be adapted rather than overwritten.

- [ ] **Step 2: Add RED tests for server request ownership**

For View/year/profile changes, assert the component sends server option values unchanged. Rapidly resolve request B before request A and assert only B renders. On error, old rows disappear. Assert there is no profile-member `.filter(`, `.reduce(`, label catalog, or option count logic in `ParticipationPage.tsx`.

- [ ] **Step 3: Implement controlled profile filters**

`ParticipationProfileFilters` renders server-provided options and counts. It receives selected values/callbacks and performs no calculation. Use URL search params for:

```text
view, year, education, englishEvidence, certification (repeat)
```

Reset profile filters when switching base View/year only if the approved product behavior requires it; otherwise preserve only values still returned by the server. In either case, selected zero-count certificate values returned by the BFF remain visible and removable.

- [ ] **Step 4: Make dashboard fetch abortable and fail closed**

Use an `AbortController` per effect:

```ts
const controller = new AbortController();
setSnapshot(null);
void fetchParticipationDashboardViaBff({
  tenantId: orgId,
  actor: user,
  year: selectedYear,
  ruleId: selectedRuleId,
  education,
  englishEvidence,
  certifications,
  signal: controller.signal,
})
  .then((next) => { if (!controller.signal.aborted) setSnapshot(next); })
  .catch(() => { if (!controller.signal.aborted) setError(message); });
return () => controller.abort();
```

Only `snapshot.professionalProfileAccess === true` reveals profile controls/columns. Missing access field is false. Never infer access from the actor role.

- [ ] **Step 5: Extend browser acceptance**

Prove:

- all and saved Views both show authorized summaries;
- server options include and allow a 0-person choice;
- education × English × certificate result is whatever the mocked server returns, with no extra local mutation;
- clear filter restores server result;
- stale response cannot overwrite the latest filter;
- unauthorized/old response never shows hidden columns;
- project expand click/Enter/Space remains correct;
- desktop and 375px table preserve 14/17-cell header alignment and horizontal-scroll region;
- filter change performs one dashboard request, project expand performs zero.

- [ ] **Step 6: Run, sabotage, and commit**

Run:

```bash
npx vitest run src/app/components/participation/ParticipationProfileFilters.shell.test.ts src/app/components/participation/ParticipationPage.shell.test.ts src/app/lib/platform-bff-client.test.ts
npm run test:e2e:participation
npm run typecheck
npm run build
```

Expected: PASS. Temporarily remove the abort/stale guard and prove the out-of-order E2E fails; restore.

Commit only scoped files, including the pre-existing approved profile-column changes:

```bash
git add src/app/components/participation/ParticipationProfileFilters.tsx src/app/components/participation/ParticipationProfileFilters.shell.test.ts src/app/components/participation/ParticipationPage.tsx src/app/components/participation/ParticipationPage.shell.test.ts tests/e2e/participation-project-breakdown.spec.ts
git diff --cached --check
git commit -m "feat(participation): filter professional profiles"
```

### Task 9: Document the contract and run independent QA

**Files:**
- Create: `docs/architecture/contracts/2026-08-24-people-professional-profile-contract.md`
- Modify only if a real gap is found: scoped implementation/test files above

- [ ] **Step 1: Write the operational contract**

Document:

- People `personId` SSOT and BFF-only rules;
- permission/capability behavior;
- catalogVersion, profile revision, RAG fingerprint;
- whole-object replacement and no-op semantics;
- highest education/English overseas/missing/filter logic;
- response allowlists/no-store;
- no migration from careerProfiles;
- deploy order and rollback evidence.

- [ ] **Step 2: Run the complete verification matrix**

Run:

```bash
npm test
npm run bff:test:integration
npm run policy:verify
npm run typecheck
npm run build
npm run test:e2e:participation
git diff --check
```

Expected: all pass. If full `npm test` shows resource-contention flakes, rerun every failed file isolated and do not mark GO until final CI is green.

- [ ] **Step 3: Run independent `/qa`**

Use `/qa` with:

```text
~/.gstack/evaluator-persona.md
~/.gstack/eval-criteria.md
~/.gstack/qa-calibration.md
```

QA must independently inspect the real path:

```text
People browser draft → catalog/profile API → permission → transaction → persons doc + audit
→ participation 4-collection read → profile facts/options/filter → client DTO → table/filter UI
```

Required sabotage checks:

1. restore direct Firestore persons access;
2. move audit outside transaction;
3. mutate timestamp on no-op;
4. spread raw person doc into list/dashboard;
5. count options after filters;
6. calculate filters in React;
7. remove stale-response guard.

Each must make an existing test fail.

- [ ] **Step 4: Review commit hygiene**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git ls-files server/bff/participation-sheet-xlsx-roundtrip.test.mjs
```

Confirm every intended new file is tracked, `.superpowers/` and `.understand-anything/` are absent, and unrelated user changes are not reverted. Commit the contract and any QA-only tests with explicit paths.

### Task 10: Land rules first, then auto-deploy and monitor

**Files/Systems:**
- Firestore production rules
- GitHub PR/CI
- Automatic `Production Deploy`

- [ ] **Step 1: Prepare a recoverable rules release**

Before production mutation, capture the exact prior rules commit/SHA and keep the previous `firebase/firestore.rules` available as the rollback source. Provide the repository-required warning that production rules are hard to roll back and a copy/version should be kept.

- [ ] **Step 2: Deploy Firestore rules before application code**

Run only the repository script:

```bash
npm run firebase:deploy:firestore
```

Immediately canary that client-SDK get/list/create/update/delete on persons are denied for representative roles while the current BFF `/api/v1/persons` still succeeds. If this fails, restore the prior rules revision and stop.

- [ ] **Step 3: Create one squash merge**

Push the feature branch, open one PR with architecture, permissions, screenshots, test evidence, and rules-first ops note. Squash merge exactly once after CI green. Do not run local `vercel --prod` and do not manually dispatch Production Deploy.

- [ ] **Step 4: Monitor automatic deployment to completion**

Confirm main push CI succeeds, then the workflow-run-triggered `Production Deploy` checks out that exact SHA and finishes green. JVM deploy should skip because `server/jvm-weekly-api/**` is unchanged.

- [ ] **Step 5: Run production canary**

Verify with authorized test data and without exposing raw PII:

```text
GET catalog/GET profile/PUT profile: 200 + private,no-store
identical PUT: changed false/revision stable
stale different PUT: 409/currentRevision
People list: profile absent, capability present
participation authorized: summary/options/filter visible and correct
participation unauthorized: access false, profile body absent
People save then participation filter: same person visible without manual sync
project detail toggle: no extra request
```

Monitor production logs for `professional_profile_revision_conflict`, `profile_filter_forbidden`, 4xx/5xx rate, and unexpected Firestore permission errors. Deployment is complete only after workflow success and canary evidence.

## Final acceptance checklist

- [ ] Real People save persists canonical profile codes and redacted provenance.
- [ ] Real participation GET sees the saved data through `personId` without another sync job.
- [ ] All profile computation/filter/count work is BFF-owned.
- [ ] Browser state contains only one-person edit draft, URL filter codes, and latest response.
- [ ] Firestore client cannot bypass BFF for persons.
- [ ] Audit/profile transaction, no-op, conflict, tenant, PII, and read-only contracts are independently proven.
- [ ] Existing monthly totals, missing/zero semantics, project details, View rules, and unlinked counts are unchanged.
- [ ] Full tests, emulator, typecheck, build, E2E, QA, CI, rules-first rollout, auto deploy, and canary all pass.
