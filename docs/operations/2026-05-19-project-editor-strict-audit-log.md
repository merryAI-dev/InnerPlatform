# 프로젝트 등록/수정/승인 Strict Audit Log

Date: 2026-05-19
Scope: 프로젝트 등록, 포털 프로젝트 수정, Admin 프로젝트 수정, Admin 승인/반려, BFF Slack 알림

## 표준 용어

| 의미 | 표준 표기 |
| --- | --- |
| 등록 단위 | 프로젝트 |
| 승인 판단 | 검토 |
| 고객/계약 상대 | 계약 대상 |
| 담당 조직 | 담당조직(CIC) |
| 메인 담당자 | PM |
| 계약명 | 공식 계약명 |
| 계약 총액 | 계약금액 |
| 부가세 | 매출 부가세 |
| 계약/정산 입력 | 계약/재무 |
| 인력 입력 | 팀/인력 |
| 입금 설명 | 입금 계획 |
| 수령/정산 설명 | 입금/정산 안내 |
| 승인자 | CIC 대표 |

## 틀린 부분 로그

| ID | 발견 위치 | 틀린 부분 | 조치 상태 |
| --- | --- | --- | --- |
| A-001 | `ProjectEditorWizard.tsx` 입금/정산 step | `paymentPlan.contract/interim/final`은 금액인데 라벨이 `선금(%)`, `중도금(%)`, `잔금(%)`라서 값 의미가 틀림 | 수정: `선금/계약금 (원)`, `중도금 (원)`, `잔금 (원)`로 변경하고 리뷰 표시에서 금액+비율 계산 |
| A-002 | `project-migration-review-dossier.ts` | 승인 상세의 입금 분할이 금액 필드를 퍼센트로 표시함 | 수정: 계약금액 대비 `48,000,000원 (40%)` 형식으로 표시 |
| A-003 | `ProjectEditorWizard.tsx` 리뷰 step | 드롭다운 입력값 중 `정산 유형`, `정산 기준`, `통장 유형`, `자금 입력 방식`, Admin `프로젝트 진행 상태`, `프로젝트 구분`이 최종 검토 화면에 빠짐 | 수정: 리뷰 카드에 모두 표시 |
| A-004 | `ProjectEditorWizard.tsx` 팀원 select | `none` sentinel이 실제 팀원명처럼 저장될 수 있음 | 수정: `none` 선택 시 팀원명/닉네임을 빈 값으로 저장 |
| A-005 | `ProjectEditorWizard.tsx` PM 계정 select | 기존 프로젝트의 `managerId`가 멤버 목록에 없으면 Select value가 options에 없음 | 수정: 현재 PM 계정을 synthetic option으로 추가 |
| A-006 | `types.ts`, `project-editor.ts`, `portal-store.tsx`, BFF | legacy enum/value가 그대로 저장되면 등록/수정/승인 화면의 드롭다운 값이 options와 불일치 | 수정: 프로젝트 유형, 상태, 구분, 정산 유형, 정산 기준, 통장 유형, 자금 입력 방식, 계약서 유형 normalizer 적용 |
| A-007 | `types.ts` 프로젝트 유형 dropdown | 등록 기준이어야 하는데 `I2`, `I3` 옵션이 빠짐 | 수정: 등록용 옵션에 `I2`, `I3` 포함 |
| A-008 | `server/bff/routes/projects.mjs` 등록 Slack | 요청 접수 알림인데 제목/텍스트가 `신규 프로젝트 등록 완료`였고 `발주기관`, `메인 담당자`, `사업목적` 등 legacy 표기를 사용 | 수정: `프로젝트 등록 요청 접수`, `계약 대상`, `PM`, `프로젝트 목적`으로 변경 |
| A-009 | `server/bff/routes/projects.mjs` 승인 Slack | `프로젝트 임원 심사 결과`, `발주기관`, `담당조직`으로 표시 | 수정: `CIC 대표 검토 결과`, `계약 대상`, `담당조직(CIC)`로 변경 |
| A-010 | `ProjectMigrationAuditPage.tsx`, `MigrationAuditDetailPanel.tsx`, `project-migration-console.ts` | 승인 화면 설명에 `원문·예산·등록 인력`, `예산·인력`, section `예산`, `정식 계약명` 등 등록 위자드와 다른 표기 사용 | 수정: `원문·계약/재무·팀/인력`, section `계약/재무`, `공식 계약명`으로 변경 |
| A-011 | `project-proposal.ts` | Board post 본문이 `사업비 수령 방식 및 정산 기준`으로 표기 | 수정: `입금/정산 안내`로 변경 |
| A-012 | `AdminApprovalPage.tsx` | 승인 카드 메타가 `사업:`으로 표시 | 수정: `프로젝트:`로 변경 |
| A-013 | `ProjectDetailPage.tsx`, `project-completeness.ts` | 상세/완성도 표면에 `발주기관`, `메인 담당자`, `총 사업비`, `통장 구분`이 남음 | 수정: `계약 대상`, `PM`, `계약금액`, `통장 유형`으로 변경 |
| A-014 | `ProjectEditorWizard.tsx` helper | 등록/수정 위자드 안에서 직접 입력 설명이 `주간 사업비 시트`로 치우침 | 수정: 위자드 범위에서는 `정산 시트`로 통일 |
| A-015 | `PortalProjectSelectPage.tsx` | 등록 화면 진입 전 세션 선택 화면에 `오늘 작업할 사업 선택`, `담당 사업`, `이 사업으로 시작`, `사업명, 클라이언트`가 남음 | 수정: `오늘 작업할 프로젝트 선택`, `담당 프로젝트`, `이 프로젝트로 시작`, `프로젝트명, 계약 대상`으로 변경 |
| A-016 | `PortalLayout.tsx`, `portal-shell-actions.ts` | 포털 shell에 `내 사업 현황`, `사업 배정 수정`, `사업 전환`, `담당 사업 검색 또는 전환`, `기존 사업 선택`, `새 사업 등록`이 남아 등록/수정 흐름과 충돌 | 수정: `내 프로젝트 현황`, `프로젝트 배정 수정`, `프로젝트 전환`, `담당 프로젝트 검색 또는 전환`, `기존 프로젝트 선택`, `새 프로젝트 등록`으로 변경 |
| A-017 | `ProjectWizard.tsx` | Admin 신규 등록에서 Review에 보인 `프로젝트 구분`을 저장 버튼(`예정 프로젝트 저장`/`확정 등록`)이 제출 직전에 덮어쓸 수 있음 | 수정: 신규 등록도 단일 `프로젝트 저장` action으로 바꾸고, 저장값은 Review에서 확인한 draft 값을 그대로 사용 |
| A-018 | `PortalProjectEdit.tsx` | BFF 저장 후 별도 resubmit 호출이 실패하면 project는 최신/PENDING인데 request payload/status가 stale로 남을 수 있음 | 수정: 중복 resubmit 호출 제거, 최신 request를 정렬해 읽고 project 저장 시 request payload/status를 같은 draft에서 직접 동기화 |
| A-019 | `PortalProjectRegister.tsx` | BFF enabled 환경에서 Slack 접수 알림이 빠지고 disabled 환경에서 BFF 알림 호출을 시도하는 조건 역전 | 수정: `isPlatformApiEnabled()`일 때만 BFF Slack 알림 endpoint 호출 |
| A-020 | `server/bff/routes/projects.mjs` | Slack `프로젝트 유형`이 `D1` raw enum으로 나감 | 수정: BFF Slack에도 프로젝트 유형 label formatter 적용 |
| A-021 | `server/bff/routes/projects.mjs` | CIC 대표 승인 완료는 Slack 검토 결과 알림이 누락됨 | 수정: 승인/반려/폐기 모두 `CIC 대표 검토 결과` Slack payload 생성 |
| A-022 | `ProjectEditorWizard.tsx` | 최종 검토 카드에서 `그룹웨어 등록명`, `최종 입금 메모`가 빠짐 | 수정: Review step에 두 필드 추가 |
| A-023 | `project-migration-console.ts` | 같은 프로젝트에 request가 여러 개 있으면 오래된 request가 승인 상세에 매핑될 수 있음 | 수정: `requestedAt` 기준 최신 request만 매핑하도록 변경 |
| A-024 | `DashboardPage.tsx` | Admin landing KPI에 `승인 큐`, `사업 통합 대시보드`, `전사 사업관리`, `위험 사업`이 남음 | 수정: `CIC 검토`, `프로젝트 통합 대시보드`, `전사 프로젝트 관리`, `위험 프로젝트`로 변경 |
| A-025 | `ParticipationPage.tsx` | 인력/참여율 화면에 `사업명`, `발주기관`, `MYSC 사업 정산유형 분류`, `민간사업`, `사업별 현황`, `사업수`가 남음 | 수정: `프로젝트명`, `계약 대상`, `MYSC 프로젝트 정산유형 분류`, `민간형`, `프로젝트별 현황`, `프로젝트 수`로 변경 |
| A-026 | `PortalOnboarding.tsx`, `PortalProjectSettings.tsx` | 담당 프로젝트 선택/배정 화면에 `내 사업`, `주사업`, `사업 배정`, `사업명, 클라이언트`가 남음 | 수정: `내 프로젝트`, `주 프로젝트`, `프로젝트 배정`, `프로젝트명, 계약 대상`으로 변경 |
| A-027 | `PortalProjectSettings.tsx`, `PortalProjectSettings.shell.test.ts` | `선택한 프로젝트 중 주 프로젝트만 저장하세요`는 실제 저장 동작과 다름. 저장 시 `projectIds`와 primary `projectId`가 함께 저장됨 | 수정: 안내를 `선택한 프로젝트와 주 프로젝트를 확인하세요`로 변경하고 test contract 갱신 |
| A-028 | `PortalProjectSelectPage.tsx`, `PortalOnboarding.tsx`, `PortalProjectSettings.tsx` | fallback 문구 `클라이언트 미지정`이 표준 `계약 대상` 용어와 불일치 | 수정: `계약 대상 미지정`으로 변경하고 terminology test 금지어에 `클라이언트 미지정` 추가 |
| A-029 | `firebase/firestore.indexes.json`, `PortalProjectEdit.tsx` | 포털 수정에서 최신 request를 `approvedProjectId == projectId` + `requestedAt desc`로 조회하지만 `project_requests` composite index가 없음 | 수정: `project_requests(approvedProjectId ASC, requestedAt DESC)` index 추가 |
| A-030 | `server/bff/routes/projects.mjs` | 등록 Slack 알림 endpoint가 canonical `project_requests` 대신 legacy `projectRequests`만 읽어 운영 데이터에서 404 가능 | 수정: `project_requests`를 먼저 읽고 legacy `projectRequests`를 fallback으로 읽는 helper 추가 |
| A-031 | `server/bff/routes/projects.mjs`, `firebase/firestore.indexes.json` | BFF 승인/재제출 fallback이 requestId 없이 projectId로 request를 찾을 때 최신 request 보장이 없음 | 수정: `requestedAt desc` 정렬 추가, legacy `projectRequests` index도 추가 |
| A-032 | `project-editor.ts`, `server/bff/routes/projects.mjs` | AI 추출 UI 제거를 데이터 제거로 해석해 기존 `contractAnalysis`가 수정/재제출 시 `null`로 덮일 수 있음 | 수정: UI에서는 숨기되 draft/payload/project patch/BFF resubmit payload에서 기존 `contractAnalysis` 보존 |
| A-033 | `server/bff/routes/projects.mjs` | BFF 승인/재제출이 project 상태를 먼저 바꾼 뒤 request를 찾으므로 request 조회/index 오류 시 project/request status가 불일치할 수 있음 | 수정: request 문서를 project 변경 전에 조회·검증하고, project/request status patch를 같은 Firestore transaction에서 쓰도록 변경 |
| A-034 | `server/bff/bff-utils.mjs`, `server/bff/routes/projects.mjs` | BFF 대표 검토 승인/반려 endpoint 권한 강화 제안이 있었으나 live PM/관리 루프에 영향 가능 | 결정: 권한/RBAC 강화는 적용하지 않고 기존 `writeCore` 유지. 이번 범위는 데이터 일관성 개선으로 제한 |
| A-035 | `server/bff/routes/projects.mjs` | 과거 request 문서에 `requestedAt`이 없으면 최신순 query에서 제외되어 승인/재제출 fallback이 request를 못 찾을 수 있음 | 수정: 정렬 query가 비면 `approvedProjectId` 단독 lookup으로 fallback |

## 드롭다운 값 계약

| 필드 | source of truth | 확인 기준 |
| --- | --- | --- |
| 프로젝트 유형 | `PROJECT_TYPE_LABELS`, `getProjectTypeSelectableOptions` | `I2`, `I3` 포함, legacy/unknown은 `D1`로 normalize |
| 프로젝트 진행 상태 | `PROJECT_STATUS_LABELS`, `normalizeProjectStatus` | 저장값은 `CONTRACT_PENDING`, `IN_PROGRESS`, `COMPLETED`, `COMPLETED_PENDING_PAYMENT` 중 하나 |
| 프로젝트 구분 | `PROJECT_PHASE_LABELS`, `normalizeProjectPhase` | 저장값은 `PROSPECT`, `CONFIRMED` 중 하나 |
| 계약서 유형 | `PROJECT_CONTRACT_TYPE_OPTIONS`, `normalizeProjectContractType` | legacy `발주기관 전자시스템`은 `전자계약 시스템`으로 표시 |
| 정산 유형 | `SETTLEMENT_TYPE_LABELS`, `normalizeSettlementType` | legacy/unknown은 `NONE` |
| 정산 기준 | `BASIS_LABELS`, `normalizeBasis` | legacy `SUPPLY_AMOUNT`는 `공급가액` |
| 통장 유형 | `ACCOUNT_TYPE_LABELS`, `normalizeAccountType` | legacy/unknown은 `NONE` |
| 자금 입력 방식 | `PROJECT_FUND_INPUT_MODE_LABELS`, `normalizeProjectFundInputMode` | legacy/unknown은 `BANK_UPLOAD` |

## Status Flow

1. PM이 프로젝트 등록 위자드에서 저장하면 프로젝트와 request payload가 같은 normalized 값을 갖는다.
2. 포털 프로젝트 수정은 같은 5단계 위자드를 load하고, 수정 저장 시 approved 프로젝트는 `PENDING`으로 재검토 상태를 되돌린다.
3. Admin 프로젝트 수정도 같은 5단계 위자드와 같은 draft builder를 사용한다.
4. Admin 승인 화면은 pending request/project 값을 같은 dossier builder로 읽는다.
5. CIC 대표의 승인, 수정 요청 후 반려, 중복·폐기 결과는 project `executiveReviewStatus`와 request review fields에 함께 반영된다.

## 검증 기록

| 검증 | 결과 |
| --- | --- |
| Targeted unit/shell tests | `npm test -- server/bff/routes/projects.test.ts src/app/platform/project-migration-console.test.ts src/app/platform/project-editor.test.ts src/app/platform/project-request-review.test.ts src/app/platform/project-migration-review-dossier.test.ts src/app/components/projects/ProjectEditorWizard.shell.test.ts src/app/platform/project-terminology.shell.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalLayout.shell.test.ts src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalMinimalSweep.layout.test.ts server/bff/slack-alerts.test.ts` 통과: 12 files, 58 tests |
| Full test suite | `npm test` 통과: 179 files passed, 4 skipped / 1205 tests passed, 52 skipped |
| Production build | `npm run build` 통과. 기존 chunk size warning만 출력 |
| Patch whitespace | `git diff --check` 통과 |
| TypeScript touched-file filter | `npx tsc --noEmit --pretty false` 결과를 이번 작업 파일로 필터링했을 때 오류 없음 |
| TypeScript full repo | `npx tsc --noEmit --pretty false`는 기존 repo-wide 오류로 실패. 대표 오류: `CashflowAnalyticsPage.tsx` icon `style` prop, `BankImportTriageWizard.tsx` missing `evidenceRequired`, `PortalBudget.tsx` missing `ProjectSheetSourceSnapshot`, integration/e2e test typing 오류 등. 이번 작업 파일에는 해당 없음 |
| gstack browser QA: register | `localhost:5175`에서 PM 샘플 로그인 → 프로젝트 선택 → 프로젝트 등록 → 5단계 Review까지 확인. Console error 없음. `그룹웨어 등록명`, `정산 유형`, `정산 기준`, `통장 유형`, `자금 입력 방식`, `최종 입금 메모` 표시 확인. `선금(%)`/`중도금(%)`/`잔금(%)` 미노출 확인 |
| gstack browser QA: portal edit | PM 샘플 로그인 → 포털 프로젝트 수정 확인. Console error 없음. 포털 shell `담당 프로젝트 검색 또는 전환`, `내 프로젝트 현황`, `프로젝트 배정 수정` 표시 확인. `담당 사업 검색`, `내 사업 현황`, `사업 배정 수정`, `발주기관` 미노출 확인 |
| gstack browser QA: admin edit | 관리자 샘플 로그인 → `/projects/p009/edit` 계약/재무 step 확인. Console error 없음. `프로젝트 진행 상태`, `프로젝트 구분`, `계약서 유형`, `정산 유형`, `통장 유형` 표시 확인 |
| gstack browser QA: approvals | 관리자 샘플 로그인 → `/approvals` 확인. Console error 없음. `프로젝트 등록` KPI, `CIC 대표 검토` 표시 확인. `임원 심사`, `승인 큐`, `사업:` 미노출 확인 |
| Subagent critical review | Noether/Mencius 재검토 findings 반영: Admin save button phase override, 최신 request 매핑, BFF Slack 조건/label/승인 알림, Review 누락 필드, portal shell 용어 정리, `주 프로젝트` 저장 안내와 `클라이언트 미지정` fallback 정리 |
| Strict terminology scan | `rg -n "사업\|발주기관\|승인 큐\|주사업\|클라이언트 미지정" src/app/components/dashboard/DashboardPage.tsx src/app/components/participation/ParticipationPage.tsx src/app/components/portal/PortalOnboarding.tsx src/app/components/portal/PortalProjectSettings.tsx src/app/components/portal/PortalProjectSelectPage.tsx` 결과 없음 |
| Expanded terminology shell tests | `npm test -- src/app/platform/project-terminology.shell.test.ts src/app/components/dashboard/DashboardPage.shell.test.ts src/app/components/portal/PortalProjectSettings.shell.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalMinimalSweep.layout.test.ts` 통과: 5 files, 17 tests |
| Data-path targeted tests | `npm test -- src/app/platform/project-editor.test.ts server/bff/routes/projects.test.ts server/bff/slack-alerts.test.ts src/app/platform/firestore-rules-policy.test.ts src/app/platform/project-request-review.test.ts src/app/platform/project-migration-review-dossier.test.ts src/app/platform/project-migration-console.test.ts` 통과: 7 files, 54 tests |
| Firestore index check | `project_requests`와 legacy `projectRequests` 모두 `approvedProjectId ASC + requestedAt DESC` index 존재 확인 |
| Superpowers/Gstack critical follow-up | `contractAnalysis` 보존, stale `requestId` 404, request/project mismatch 409, `requestedAt` 누락 fallback, 승인/재제출 project/request transaction 동기화를 반영. RBAC 강화 제안은 live 영향 우려로 미적용 |
| Final Gstack/Superpowers review | 추가 critical/high 신규 데이터 손상 이슈 없음. 잔여 리스크는 기존 구조인 포털 등록/수정의 client+BFF 분리 write로 분류 |

## 남은 의사결정

| 항목 | 현재 판단 |
| --- | --- |
| `contractType` 저장값 | 현재는 label 문자열을 canonical value로 사용한다. 다른 Select처럼 enum key를 둘지 여부는 데이터 migration이 필요한 product decision으로 남긴다. |
| `ProjectListPage` 유형 필터 short label | 목록 필터는 좁은 공간의 scan 용도라 short label을 유지했다. 등록/수정/승인 주요 흐름은 full label로 통일했다. |
| `사업비` 용어 | `사업비 입력`, `사업비 세트`, `사업비 사용액`은 프로젝트 자체의 대체어가 아니라 비용/정산 domain term이라 유지했다. |
