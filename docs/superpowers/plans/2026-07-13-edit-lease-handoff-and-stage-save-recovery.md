# Edit Lease Handoff and Stage Save Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stage cashflow saves reachable, keep private drafts recoverable after a revision conflict, and make project/cashflow edit leases hand off and end safely without repeated conflict dialogs.

**Architecture:** Keep leases session-scoped (`userId + sessionId + leaseId + fence`) and add an atomic same-user takeover command. A reusable client controller remembers one read-only acknowledgement per mounted resource, while reusable exit helpers save private drafts before releasing a lease. Stage Vercel BFF uses a Stage-only Cloud Run invoker identity to send an audience-bound Google ID token in addition to the existing internal service token.

**Tech Stack:** React, React Router, Vitest, Express BFF, Firestore transactions, Vercel Stage environment secrets, Google Auth Library, Cloud Run IAM.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/bff/routes/jvm-weekly-api.mjs` | Safely proxy JVM responses and create a Cloud Run ID token from Stage server credentials. |
| `server/bff/routes/jvm-weekly-api.test.mjs` | Prove non-JSON 403 preservation and credential-based ID token forwarding. |
| `.github/workflows/stage-deploy.yml` | Pass Stage-only audience and BFF invoker credential to Vercel. |
| `scripts/deploy_jvm_weekly_api_cloud_run.sh` | Deploy the Stage JVM without relying on public invoker access. |
| `cloudbuild.jvm-weekly-api.yaml` | Keep the Cloud Build Stage JVM deployment path private as well. |
| `server/bff/edit-lease.mjs` | Add an atomic same-user `takeover` command. |
| `server/bff/routes/edit-leases.mjs` | Expose the `takeover` command through the BFF. |
| `src/app/lib/edit-lease-client.ts` | Call `takeover` and validate the returned ownership. |
| `src/app/components/editing/useEditLease.ts` | Suppress a held dialog after read-only acknowledgement and expose takeover state. |
| `src/app/components/editing/EditLeaseDialogs.tsx` | Show the holder name and the `이전 수정 이어서 하기` action only for the same user. |
| `src/app/components/editing/EditLeaseExitDialog.tsx` | Render the reusable `임시저장 후 나가기` confirmation. |
| `src/app/components/editing/useEditLeaseExitGuard.ts` | Coordinate save → release → blocked navigation. |
| `src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.ts` | Serialize private draft saves and safely rebase only the `sheetLab` payload after one 409. |
| `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx` | Use the recovery helper, takeover UI, and exit guard. |
| `src/app/components/portal/PortalProjectRegister.tsx` | Use takeover UI and safe exit with registration private draft save. |
| `src/app/components/portal/PortalProjectEdit.tsx` | Use takeover UI and safe exit with project-information private draft save. |
| `src/app/components/cashflow/CashflowProjectSheet.tsx` | Use the shared exit dialog instead of releasing only through ad-hoc navigation. |

### Task 1: Repair Stage JVM invocation without public Cloud Run access

**Files:**
- Modify: `server/bff/routes/jvm-weekly-api.mjs:1-180`
- Modify: `server/bff/routes/jvm-weekly-api.test.mjs:1-560`
- Modify: `.github/workflows/stage-deploy.yml:35-115`
- Modify: `scripts/deploy_jvm_weekly_api_cloud_run.sh:65-79`
- Modify: `cloudbuild.jvm-weekly-api.yaml:40-75`
- Test: `server/stage-edit-lease-runtime.test.mjs`

- [ ] **Step 1: Add a failing BFF test for Cloud Run plain-text 403 preservation**

```js
it('preserves a non-JSON Cloud Run 403 instead of turning it into a BFF 500', async () => {
  const app = createBffApp({
    env: stageJvmEnv(),
    fetchImpl: vi.fn(async () => new Response('The request was not authenticated.', { status: 403 })),
  });
  const response = await request(app)
    .post('/api/v1/cashflow/project-a/projection')
    .set({ ...actorHeaders, ...cashflowLeaseHeaders, 'idempotency-key': 'projection-auth-403' })
    .send({ lines: [] });

  expect(response.status).toBe(403);
  expect(response.body.error).toBe('jvm_weekly_api_error');
});
```

- [ ] **Step 2: Run the focused test and confirm the current 500 failure**

Run: `npx vitest run server/bff/routes/jvm-weekly-api.test.mjs`

Expected: the new assertion fails because `JSON.parse('The request was not authenticated.')` throws.

- [ ] **Step 3: Add safe response parsing and credential-backed ID token resolution**

```js
import { GoogleAuth } from 'google-auth-library';

function parseJavaResponseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

async function fetchGoogleIdentityToken(fetchImpl, audience, serviceAccountJson = '') {
  if (!audience) return '';
  if (serviceAccountJson) {
    let credentials;
    try { credentials = JSON.parse(serviceAccountJson); } catch {
      throw createHttpError(503, 'Stage JVM invoker credential is invalid.', 'jvm_weekly_api_identity_token_unavailable');
    }
    const client = await new GoogleAuth({ credentials }).getIdTokenClient(audience);
    const authorization = (await client.getRequestHeaders()).Authorization;
    return readOptionalText(authorization).replace(/^Bearer\s+/i, '');
  }
  // Preserve the existing metadata-server path for Cloud Run-hosted BFFs.
  // Vercel Stage must provide the service-account JSON secret.
}
```

Pass `JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON` into `buildTrustedHeaders`, use `parseJavaResponseBody(text)`, and add a test injection seam for the credential ID-token resolver. Never log the credential or token.

- [ ] **Step 4: Extend focused tests**

```js
it('adds an audience-bound ID token resolved from Stage BFF credentials', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ saved: true }), { status: 200 }));
  const resolveIdentityToken = vi.fn(async () => 'stage-id-token');
  // Mount route with the resolver seam and a Stage audience.
  // Assert the JVM request receives `authorization: Bearer stage-id-token`.
});
```

Run: `npx vitest run server/bff/routes/jvm-weekly-api.test.mjs server/stage-edit-lease-runtime.test.mjs`

Expected: PASS.

- [ ] **Step 5: Enforce Stage-only deployment configuration**

Add these Stage workflow values to the existing Git-only Stage workflow so its preview runtime receives them:

```yaml
JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: ${{ vars.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE_STAGE }}
JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: ${{ secrets.JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON_STAGE }}
```

Require both values in the Stage credential check. Update `assert-stage-edit-lease-runtime.mjs` tests so a Live project, missing Stage audience, or missing Stage invoker secret fails before deploy.

Remove `--allow-unauthenticated` from both the JVM deployment script and `cloudbuild.jvm-weekly-api.yaml`. Keep the Stage project, service name, Firebase project, and canonical Stage origin guards unchanged.

- [ ] **Step 6: Provision only the Stage invoker identity after code review**

Run these Stage-only commands after the code has passed review; do not reuse Live credentials:

```bash
gcloud iam service-accounts create myscube-stage-bff-invoker \
  --project=inner-platform-qa-20260310
gcloud run services add-iam-policy-binding innerplatform-jvm-weekly-api-lease-stage \
  --project=inner-platform-qa-20260310 \
  --region=asia-northeast3 \
  --member='serviceAccount:myscube-stage-bff-invoker@inner-platform-qa-20260310.iam.gserviceaccount.com' \
  --role='roles/run.invoker'
gcloud iam service-accounts keys create /tmp/myscube-stage-bff-invoker.json \
  --iam-account='myscube-stage-bff-invoker@inner-platform-qa-20260310.iam.gserviceaccount.com'
gh variable set JVM_WEEKLY_API_ID_TOKEN_AUDIENCE_STAGE -R merryAI-dev/MYSCube --env Stage \
  --body='https://innerplatform-jvm-weekly-api-lease-stage-c3pm5gv7ia-du.a.run.app'
gh secret set JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON_STAGE -R merryAI-dev/MYSCube --env Stage < /tmp/myscube-stage-bff-invoker.json
rm -f /tmp/myscube-stage-bff-invoker.json
```

The service account receives only `roles/run.invoker` on the Stage JVM service. Its key is a GitHub Stage environment secret, is never committed, and is not passed to the browser.

- [ ] **Step 7: Commit**

```bash
git add server/bff/routes/jvm-weekly-api.mjs server/bff/routes/jvm-weekly-api.test.mjs \
  server/stage-edit-lease-runtime.test.mjs .github/workflows/stage-deploy.yml \
  scripts/deploy_jvm_weekly_api_cloud_run.sh cloudbuild.jvm-weekly-api.yaml
git commit -m "fix(stage): authenticate BFF calls to private JVM service"
```

### Task 2: Recover owner private cashflow drafts from one revision conflict

**Files:**
- Create: `src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.ts`
- Create: `src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.test.ts`
- Modify: `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx:300-840`

- [ ] **Step 1: Write a failing pure recovery test**

```ts
it('rebases only sheetLab on the latest private payload after one draft revision conflict', () => {
  expect(rebaseSheetLabDraft({
    latest: { ledgerFilter: 'keep', sheetLab: { value: 'old' } },
    localSheetLab: { value: 'new', sheetName: 'Forecast' },
  })).toEqual({
    ledgerFilter: 'keep',
    sheetLab: { value: 'new', sheetName: 'Forecast' },
  });
});

it('does not run a second retry after another draft_version_conflict', async () => {
  // Assert the caller receives `cashflow_private_draft_conflict` after one retry.
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `npx vitest run src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.test.ts`

Expected: FAIL because the recovery helper does not exist.

- [ ] **Step 3: Implement a queue and one safe rebase**

```ts
export async function saveSheetLabDraftWithRecovery(input) {
  try {
    return await input.client.save(input.ownership, {
      expectedDraftRevision: input.revisionRef.current,
      payload: input.payload,
    });
  } catch (error) {
    if (!isDraftVersionConflict(error)) throw error;
    const latest = await input.client.get();
    const payload = rebaseSheetLabDraft({
      latest: latest.draft.payload,
      localSheetLab: input.payload.sheetLab,
    });
    const saved = await input.client.save(input.ownership, {
      expectedDraftRevision: latest.draft.draftRevision,
      payload,
    });
    return { ...saved, recovered: true };
  }
}
```

In `CashflowSheetLabPage`, replace state-only revision reads with `privateDraftRevisionRef`. Update the ref immediately after open, save, and complete. Route every sheetLab draft mutation through a single `mutationQueueRef` so two UI events cannot send the same revision concurrently. On the second conflict, retain the local form values and display `다른 화면에서 임시저장이 갱신되었습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.`

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.test.ts src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts src/app/lib/cashflow-private-draft-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.ts \
  src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.test.ts \
  src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx
git commit -m "fix(cashflow): recover private draft revision conflicts"
```

### Task 3: Add one-time read-only acknowledgement and same-user takeover

**Files:**
- Modify: `server/bff/edit-lease.mjs:480-700`
- Modify: `server/bff/routes/edit-leases.mjs:1-125`
- Modify: `src/app/lib/edit-lease-client.ts:40-280`
- Modify: `src/app/components/editing/useEditLease.ts:20-365`
- Modify: `src/app/components/editing/EditLeaseDialogs.tsx:10-100`
- Test: `server/bff/edit-lease.test.mjs`
- Test: `server/bff/routes/edit-leases.test.mjs`
- Test: `src/app/lib/edit-lease-client.test.ts`
- Test: `src/app/components/editing/useEditLease.test.ts`
- Test: `src/app/components/editing/EditLeaseDialogs.shell.test.ts`

- [ ] **Step 1: Write failing controller and BFF tests**

```ts
it('does not reopen a held dialog after the user chooses read-only and focus returns', async () => {
  const controller = createEditLeaseController({ client, windowTarget, documentTarget });
  await controller.acquire();
  controller.continueReadOnly();
  windowTarget.dispatch('focus');
  await flushPromises();
  expect(controller.getState().conflictOpen).toBe(false);
});

it('takes over an active lease only when the same actor owns it', async () => {
  const result = await service.takeover({ ...sameActorNewSession, idempotencyKey: 'takeover-a' });
  expect(result.body).toMatchObject({ canEdit: true, fence: 2 });
  await expect(service.takeover({ ...differentActor, idempotencyKey: 'takeover-b' }))
    .rejects.toMatchObject({ statusCode: 423 });
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run server/bff/edit-lease.test.mjs server/bff/routes/edit-leases.test.mjs src/app/lib/edit-lease-client.test.ts src/app/components/editing/useEditLease.test.ts src/app/components/editing/EditLeaseDialogs.shell.test.ts`

Expected: FAIL because `takeover` and acknowledgement state do not exist.

- [ ] **Step 3: Implement the atomic `takeover` command**

In `createEditLeaseService.runCommand`, accept `takeover` only when the existing lease is ACTIVE and `existing.holderUid === current.actorId`. Create a fresh lease ID, increment fence, replace session ID, preserve resource fields and expiry, append `edit_lease_taken_over` audit metadata, and complete idempotency in the same Firestore transaction. Return ownership for the new session. Never permit a different actor to take over.

Mount `POST /api/v1/edit-leases/:resourceType/:resourceId/takeover`; add `takeover()` to `EditLeaseClient`; expose it from `useEditLease`.

- [ ] **Step 4: Implement one-time acknowledgement and copy**

Add internal `heldAcknowledged` state to `createEditLeaseController`. `continueReadOnly()` sets it to true. `applyStatus()` must keep `mode: 'held'` but set `conflictOpen: false` while it is acknowledged. Reset acknowledgement only after acquire, takeover, release, expiry, or controller disposal.

Change the holder copy to:

```tsx
<AlertDialogTitle>{`${holder?.holderDisplayName || '다른 사용자'}님이 수정 중입니다.`}</AlertDialogTitle>
<AlertDialogDescription>지금은 수정할 수 없지만 읽기/조회는 가능해요!</AlertDialogDescription>
```

Render `이전 수정 이어서 하기` only when `holder?.sameActor === true`; preserve `읽기/조회로 보기` for every holder.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run server/bff/edit-lease.test.mjs server/bff/routes/edit-leases.test.mjs src/app/lib/edit-lease-client.test.ts src/app/components/editing/useEditLease.test.ts src/app/components/editing/EditLeaseDialogs.shell.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/bff/edit-lease.mjs server/bff/routes/edit-leases.mjs \
  src/app/lib/edit-lease-client.ts src/app/components/editing/useEditLease.ts \
  src/app/components/editing/EditLeaseDialogs.tsx \
  server/bff/edit-lease.test.mjs server/bff/routes/edit-leases.test.mjs \
  src/app/lib/edit-lease-client.test.ts src/app/components/editing/useEditLease.test.ts \
  src/app/components/editing/EditLeaseDialogs.shell.test.ts
git commit -m "feat(editing): hand off same-user edit leases"
```

### Task 4: Save private drafts before leaving an in-app edit route

**Files:**
- Create: `src/app/components/editing/EditLeaseExitDialog.tsx`
- Create: `src/app/components/editing/edit-lease-exit.ts`
- Create: `src/app/components/editing/edit-lease-exit.test.ts`
- Modify: `src/app/components/portal/PortalProjectRegister.tsx`
- Modify: `src/app/components/portal/PortalProjectEdit.tsx`
- Modify: `src/app/components/cashflow/CashflowProjectSheet.tsx`
- Modify: `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`

- [ ] **Step 1: Write the failing save-then-release unit test**

```ts
it('navigates only after private save and lease release both succeed', async () => {
  const calls: string[] = [];
  await saveThenRelease({
    save: async () => { calls.push('save'); },
    release: async () => { calls.push('release'); },
    proceed: () => { calls.push('proceed'); },
  });
  expect(calls).toEqual(['save', 'release', 'proceed']);
});

it('does not release or navigate when private save fails', async () => {
  await expect(saveThenRelease({ save: async () => { throw new Error('save failed'); }, release, proceed }))
    .rejects.toThrow('save failed');
  expect(release).not.toHaveBeenCalled();
  expect(proceed).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/app/components/editing/edit-lease-exit.test.ts`

Expected: FAIL because `saveThenRelease` does not exist.

- [ ] **Step 3: Implement the shared exit helper and dialog**

```ts
export async function saveThenRelease({ save, release, proceed }) {
  await save();
  await release();
  proceed();
}
```

`EditLeaseExitDialog` must use the exact copy `수정 중인 내용이 있습니다` and `임시저장하고 수정 세션을 종료할까요?`, with `계속 작성` and `임시저장 후 나가기` actions.

Use existing React Router `useBlocker` in each listed edit page. When navigation is blocked and the page holds a lease, open the dialog. `임시저장 후 나가기` calls that page's existing private draft save callback, then `lease.release()`, then `blocker.proceed()`. On an error, call `blocker.reset()`, retain the current page, and show the error. A refresh/tab-close gets the native `beforeunload` warning only; it must never auto-finalize.

- [ ] **Step 4: Add page-level shell assertions**

Add tests that each lease-holding page imports the shared dialog and uses `useBlocker`, and that the old direct route navigation path is not used while a save is pending.

Run: `npx vitest run src/app/components/editing/edit-lease-exit.test.ts src/app/components/projects/ProjectEditorWizard.shell.test.ts src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/editing/EditLeaseExitDialog.tsx src/app/components/editing/edit-lease-exit.ts \
  src/app/components/editing/edit-lease-exit.test.ts src/app/components/portal/PortalProjectRegister.tsx \
  src/app/components/portal/PortalProjectEdit.tsx src/app/components/cashflow/CashflowProjectSheet.tsx \
  src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx
git commit -m "feat(editing): save private drafts before leaving"
```

### Task 5: Make final save explicit and capability-gated

**Files:**
- Modify: `server/bff/bff-utils.mjs:190-230`
- Modify: `server/bff/routes/project-registration-drafts.mjs:1050-1130`
- Modify: `server/bff/routes/project-info-drafts.mjs:850-920`
- Modify: `server/bff/routes/jvm-weekly-api.mjs:220-520`
- Modify: `src/app/components/portal/PortalProjectRegister.tsx`
- Modify: `src/app/components/portal/PortalProjectEdit.tsx`
- Modify: `src/app/components/cashflow/CashflowProjectSheet.tsx`
- Test: `server/bff/routes/project-registration-drafts.test.mjs`
- Test: `server/bff/routes/project-info-drafts.test.mjs`
- Test: `server/bff/routes/jvm-weekly-api.test.mjs`

- [ ] **Step 1: Add failing capability tests**

```js
it('rejects a project registration final submit from a viewer even with a valid edit lease', async () => {
  await expect(service.submit({ ...viewerInput, finalize: true })).rejects.toMatchObject({ statusCode: 403 });
});

it('requires x-edit-finalize=true for a canonical cashflow publish', async () => {
  const response = await request(app).post('/api/v1/cashflow/project-a/projection')
    .set({ ...leaseHeaders, 'idempotency-key': 'projection-without-finalize' })
    .send({ lines });
  expect(response.status).toBe(409);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npx vitest run server/bff/routes/project-registration-drafts.test.mjs server/bff/routes/project-info-drafts.test.mjs server/bff/routes/jvm-weekly-api.test.mjs`

Expected: FAIL because final-save capability is still mixed with ordinary write roles.

- [ ] **Step 3: Centralize final capabilities**

Add an exported BFF helper that maps the approved capabilities exactly:

```js
const FINALIZE_ROLES = {
  'project-registration.finalize': new Set(['pm', 'admin', 'tenant_admin']),
  'project-info.finalize': new Set(['pm', 'admin', 'tenant_admin']),
  'cashflow.submit.finalize': new Set(['pm', 'finance', 'admin']),
  'cashflow.close.finalize': new Set(['finance', 'admin']),
};
```

Call it only from explicit final submit/publish handlers. Do not call it from draft `open`, `save`, attachment, route exit, takeover, or autosave paths. Keep existing resource membership and lease/fence/version/idempotency checks in place.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run server/bff/routes/project-registration-drafts.test.mjs server/bff/routes/project-info-drafts.test.mjs server/bff/routes/jvm-weekly-api.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/bff/bff-utils.mjs server/bff/routes/project-registration-drafts.mjs \
  server/bff/routes/project-info-drafts.mjs server/bff/routes/jvm-weekly-api.mjs \
  src/app/components/portal/PortalProjectRegister.tsx src/app/components/portal/PortalProjectEdit.tsx \
  src/app/components/cashflow/CashflowProjectSheet.tsx
git commit -m "feat(permissions): require explicit final-save capability"
```

### Task 6: Full verification and Stage-only deployment

**Files:**
- Modify: `docs/patch-notes/2026-07-13-edit-lease-handoff.md`

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
npx vitest run \
  server/bff/routes/jvm-weekly-api.test.mjs \
  server/bff/edit-lease.test.mjs \
  server/bff/routes/edit-leases.test.mjs \
  src/app/lib/edit-lease-client.test.ts \
  src/app/components/editing/useEditLease.test.ts \
  src/app/components/editing/EditLeaseDialogs.shell.test.ts \
  src/app/components/editing/edit-lease-exit.test.ts \
  src/app/features/cashflow-sheet-compare/cashflow-private-draft-recovery.test.ts \
  server/bff/routes/cashflow-edit-drafts.test.mjs
npm run build
npm run policy:verify
```

Expected: all commands exit 0.

- [ ] **Step 2: Add an operational patch note**

Record the user-visible behavior, the explicit final-save permissions, Stage Cloud Run invoker setup, and the fact that Live remains untouched.

- [ ] **Step 3: Commit and open a PR**

```bash
git add docs/patch-notes/2026-07-13-edit-lease-handoff.md
git commit -m "docs: record edit lease handoff rollout"
git push origin codex/edit-lease-handoff
gh pr create --base main --head codex/edit-lease-handoff \
  --title "Stage: recover private drafts and hand off edit leases"
```

- [ ] **Step 4: Deploy only after green CI**

Merge the PR only after required checks pass. Deploy the Stage JVM, set only Stage GitHub environment values, run `stage-deploy.yml` for `main`, and verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://inner-platform-internal-stage-merryai-devs-projects.vercel.app
gcloud run services describe innerplatform-jvm-weekly-api-lease-stage \
  --project=inner-platform-qa-20260310 --region=asia-northeast3 \
  --format='value(status.latestReadyRevisionName)'
```

- [ ] **Step 5: Stage browser QA**

Use two Stage sessions and a disposable project. Verify one-time conflict acknowledgement, same-user takeover, stale-tab 423, save-then-leave, refresh recovery, private-draft 409 rebase, explicit final-save capability, and a successful fenced projection final save. Do not access or deploy Live.

## Plan Self-Review

- Spec coverage: Tasks 3 and 4 cover conflict acknowledgement, handoff, and safe exit. Task 5 covers explicit final save. Tasks 1 and 2 address the observed Stage 500 and 409 paths.
- Placeholder scan: no unassigned TODO or deferred implementation steps remain; Stage identity provisioning is intentionally explicit and must happen only after code review.
- Type consistency: `takeover`, `heldAcknowledged`, `saveThenRelease`, `rebaseSheetLabDraft`, and the four final capability names are used consistently across tasks.
