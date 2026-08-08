# Repository Guidelines

## Project Structure
- `src/`: Vite + React + TypeScript frontend.
  - `src/app/routes.tsx`: admin (`/`) and portal (`/portal`) routing.
  - `src/app/components/`: feature UIs (projects, payroll, board, cashflow, portal).
  - `src/app/data/`: client stores/providers and shared types (`src/app/data/types.ts`).
  - `src/app/platform/`: shared “policy/logic” helpers (RBAC, tenant, business-days, cashflow week buckets).
- `server/bff/`: Express BFF used by `/api/v1/*` (idempotency, outbox, queue workers, audit chain).
- `api/bff.js`: Vercel Serverless entrypoint for the BFF.
- `firebase/`: Firestore rules + composite indexes.
- `policies/`: policy-as-code JSON (RBAC, relation rules).
- `scripts/` + `guidelines/`: Firebase automation + operational runbooks.

## Build, Test, Run
- `npm run dev`: local frontend.
- `npm run build`: production build.
- `npm test`: unit tests (Vitest).
- `npm run bff:dev`: local BFF on `127.0.0.1:8787`.
- `npm run bff:test:integration`: Firestore emulator + BFF integration tests.

Recommended gate before PR:
```bash
npm test
npm run bff:test:integration
npm run build
```

## Coding Style & Naming
- TypeScript, React function components, 2-space indentation.
- Components/pages: `PascalCase.tsx` (example: `AdminPayrollPage.tsx`).
- Route segments/folders: lowercase/kebab (example: `expense-management`).
- Keep cross-cutting rules in `src/app/platform/`; keep feature UI in `src/app/components/<feature>/`.
- UI wording must use the same Korean business terms across admin and portal. Prefer domain labels already used in `src/app/data/types.ts` or shared label maps; avoid one-off labels like `X`, `N/A`, or developer-only shorthand in user-facing screens.
- User-facing helper text should explain the operational meaning, not the implementation. Example: say "구성원 원장에서 사업 담당자를 선택합니다" instead of "registeredById 값을 설정합니다".
- Code comments should be rare and explain why a rule exists or why a non-obvious dependency is necessary. Do not comment what the next line mechanically does.

## Commit & PR Guidelines
- Prefer Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`.
- PRs should include:
  - What/why, screenshots for UI changes (admin + portal), and test results.
  - Ops notes when Firestore rules/indexes or Vercel envs change.

## Firebase/Vercel Ops (Common)
- Deploy Firestore rules/indexes: `npm run firebase:deploy:firestore`.
- One-shot Firebase setup (writes `.env`, `.firebaserc`, deploys): `npm run firebase:autosetup`.
- Vercel preview deploy: `vercel deploy`.
- Production deploy: use the GitHub Actions `Production Deploy` workflow on `main` only.
- Local production deploy is forbidden. `vercel --prod` and `node deploy-prod-align.mjs` must not be used from a local worktree.
- Local production verification only: `npm run deploy:prod:verify -- <deployment-url-or-host>`.

## High-Priority Operating Policies
These policies override lower-priority workflow suggestions when they apply.

### 캐시플로 좌표 계약 (변경 불가)
사업비 관리 시트는 전사 단일 고정 양식이다. 읽기는 고정 좌표에서 값을 꺼내는 것이고, 그 이상은 하지 않는다.
계약의 단일 진실은 `server/bff/cashflow-coordinates.mjs` 이며 근거는
`docs/architecture/contracts/2026-07-28-cashflow-formula-validation-contract.md` 다.

- **주별 블록은 `E:BL` 60칸 하나뿐이다.** 그 연도는 프로젝트당 단일 상수다. "어느 연도들이 주별인가"는 집합 질문이 아니다. `weeklyYears` 배열·Set·연도 집합 유도를 새로 만들지 않는다.
- **연간 열은 `C:D`(이전 2개)와 `BM:BR`(이후 6개) 고정이다.** 연간 값은 이 좌표에서 읽는다. 주차 문서를 합산해 연간값을 만들지 않는다.
- **라인 정체성은 행 인덱스다** (`LINE_ROWS`). 라벨 문자열, alias, 동명이인 방어로 라인을 찾지 않는다.
- **좌표 밖의 데이터는 존재하지 않는다.** `weekOrdinal(...) === -1` 이면 읽기 경로에 진입시키지 않는다. 문서 존재 여부로 구조를 유추하지 않는다.
- **양식이 다르면 적응하지 않고 거부한다.** `CashflowTemplateMismatchError` 로 "양식이 다릅니다."를 낸다. 폴백 체인·보정·추론으로 메우지 않는다.
- `EMPTY` 와 `ZERO` 는 절대 뭉개지 않는다. 셀 상태는 저장된 값이며 금액에서 역산하지 않는다.

새 코드가 위 항목을 어기면 리뷰에서 반려한다. 기존 위반은 좌표 계약으로 대체하며, 대체 시 사보타주 검증(계약을 깨면 테스트가 실패하는지)을 함께 붙인다.

### 오케스트레이션 워커 수명주기 (Orca dispatch)

Orca orchestration 하에서 일할 때만 적용된다. 이 절은 QA Stage Gates 보다 우선한다.

**`worker_done` 은 dispatch 를 종료시킨다.** 종료된 dispatch 는 capability 가 회수되어
그 뒤의 어떤 보고도 `Rejected worker_done: capability is revoked` 로 거부되고,
코디네이터가 보내는 수정 지시도 받을 수 없다. 그래서 다음 두 규칙을 지킨다.

1. **`worker_done` 은 담당 워커가 단 한 번, 맨 마지막에만 보낸다.**
   - QA 서브에이전트·리뷰어·조사자는 **절대** `worker_done` 을 보내지 않는다. 그들의 결과는
     담당 워커에게 돌려주고, 담당 워커가 자기 `worker_done` **하나**에 접어 넣는다.
   - 진행 상황·중간 결과·QA 판정은 `--type status` 로 보낸다. 막히면 `escalation`, 물을 것은 `ask`.
   - 실제 사고: QA 서브에이전트가 `worker_done` 으로 "QA FAIL" 을 보내 dispatch 가 조기 종료되었고,
     그 뒤 담당 워커의 실제 구현 완료 보고가 두 번 거부되어 유실됐다.

2. **구현이 끝나면 `worker_done` 전에 `ask` 로 코디네이터 리뷰를 요청한다.**
   ```bash
   orca orchestration ask --question "구현 완료. 리뷰 요청합니다. 변경: <파일>. 테스트: <n/n>. 사보타주: <결과>." --timeout-ms 1800000 --json
   ```
   - 코디네이터가 diff 를 직접 읽고 통과 또는 보완 지시를 회신한다.
   - 보완 지시를 받으면 **같은 dispatch 안에서** 고치고 다시 `ask` 한다. 리뷰 라운드가 몇 번이든
     dispatch 는 살아 있다.
   - 코디네이터가 통과를 회신한 뒤에만 `worker_done` 을 보낸다.
   - 테스트 통과와 QA PASS 는 리뷰 통과가 아니다. 테스트는 fixture 를 검증하지 프로덕션 데이터를
     검증하지 않는다.

### QA Stage Gates
- For implementation work that can affect users, data, integrations, permissions, deployment, or cross-screen behavior, run the work with an independent QA lens based on `/Users/boram/gstack/.agents/skills/gstack-qa/SKILL.md`.
- Where subagents are available, assign a separate QA subagent to define stage pass criteria and challenge the implementation. If subagents are unavailable, perform a separate QA pass in the main thread using the same criteria. QA 서브에이전트는 결과를 담당 워커에게 돌려주며 `worker_done` 을 보내지 않는다 (위 수명주기 규칙 1).
- Before coding, QA must decide whether the proposed fix is superficial or proves real behavior. It must identify the actual data path being affected: UI state, API/BFF calls, Firestore/store writes, sync jobs, persisted reads, and cross-screen visibility.
- QA defines the pass criteria for each stage independently. Do not advance to the next stage until the current stage passes or a blocker is explicitly reported.
- Required stages:
  1. Intent/data-path gate: define what real data or integration should change and where it should be observable.
  2. Implementation gate: make the smallest scoped change that affects the real data path, not only labels, mock state, or cosmetic UI.
  3. Verification gate: prove the behavior with user-like browser flow when relevant, plus targeted tests/builds/API checks as appropriate.
  4. Regression gate: check adjacent states such as loading, disabled, empty, error, auth/permission, and repeated-save/sync cases.
- Evidence must be independent of implementer assertions: command output, tests, screenshots/snapshots, console checks, persisted records, API responses, logs, or deployment/workflow results.
- If QA concludes the work is only cosmetic while the task requires persistence, sync, or integration, stop and fix the real data path before proceeding.
- For docs-only or non-UI tasks, use lightweight QA criteria and state why browser QA is not required.
- If the worktree is dirty, do not revert unrelated user changes. Run full `/qa` only when the tree can be made safe; otherwise still apply the QA stage-gate policy to the scoped work.

### Understand-Anything Code Intelligence
- Use `/Users/boram/Understand-Anything/understand-anything-plugin/skills/understand/SKILL.md` for codebase understanding, impact analysis, and architecture orientation.
- Prefer the generated knowledge graph at `.understand-anything/knowledge-graph.json` when it exists. Refresh it with:

```bash
/understand /Users/boram/InnerPlatform --language ko
```

- Use Understand-Anything outputs to identify likely owners, affected flows, dependencies, and test scope before broad or risky edits.
- Do not use GitNexus commands, MCP resources, skill files, or `npx gitnexus` workflows for this repository.
