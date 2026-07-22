# MYSCube Phase Gate Policy

**적용 범위:** 기존·현재·향후 모든 구현 Phase

**통과 기준:** 100/100

**다음 단계 차단:** 점수가 100점 미만이거나 검증 증거가 없으면 다음 Phase와 Stage 배포를 시작하지 않는다.

## 공통 절차

1. 계약 문서에서 범위, 성공 기준, 실패 기준, 범위 밖을 고정한다.
2. 구현 전에 main 호출 경로와 서버의 최종 쓰기 경계를 확인한다.
3. 구현 후 테스트, 실제 입력 기반 회귀, production build를 실행한다.
4. 코드를 수정하지 않는 독립 감시자가 계약과 증거를 대조해 100점 만점으로 채점한다.
5. 100점 미만이면 누락을 현재 Phase에서 보완하고 재감사한다.
6. 100점일 때만 다음 Phase 또는 Stage 배포를 진행한다. Live 배포는 별도 명시 승인 없이는 금지한다.

## 이전 Phase 소급 감사

- 이전 Phase도 `완료 추정`으로 두지 않고 계약·main 호출 경로·실제 검증 증거를 복원한다.
- 원래 계약이 로컬 ignored 파일에만 있으면 `docs/architecture/contracts/` 아래 tracked 계약으로 승격한다.
- 현재 배포 묶음이 건드리는 이전 Phase는 Stage 배포 전에 우선 소급 감사해 100/100으로 닫는다.
- 관련 없는 이전 Phase는 등록부의 `RETROSPECTIVE_PENDING` 상태로 순차 감사하되, 그 Phase를 다시 수정하거나 배포할 때까지 미룰 수 없다.
- 소급 감사에서 누락이 발견되면 과거의 완료 표기를 취소하고 별도 보완 Phase로 되돌린다.

## 향후 Phase 시작 조건

- 코드를 수정하기 전에 tracked 계약, 성공·실패 기준, 범위 밖, 검증 명령, 독립 감시자를 등록한다.
- 이전 Phase의 100점 증거와 커밋 경계가 없으면 다음 Phase를 시작하지 않는다.
- 각 Phase의 기획·구현·평가 수치와 감시자 판정은 저장소 문서에 커밋한다.

## 채점 원칙

- 코드가 있어도 main 경로에서 호출되지 않으면 0점이다.
- 빌드 성공만으로 기능 완료 점수를 주지 않는다.
- 테스트하지 않은 계약 항목은 통과로 추정하지 않는다.
- 서버 경계에서 우회 가능한 프론트/BFF 검사는 완료로 인정하지 않는다.
- 실제 입력, 멱등성, 원자성, 권한, 레거시 호환, 감사 기록, 장애 시 동작을 포함한다.
- 독립 감시자는 코드를 수정하지 않고 근거 파일·라인·실행 결과만 평가한다.

## Phase 등록부

| Phase | 기준 문서 | 상태 | 최종 점수 |
|---|---|---:|---:|
| Cashflow sheet fidelity | `docs/architecture/contracts/2026-07-13-cashflow-sheet-fidelity.md` | COMPLETE | 100/100 |
| Main home / project selection | `.gstack/sprint-contract-2026-07-20-main-home-project-selection.md` | RETROSPECTIVE_PENDING | - |
| Cashflow sheet tutorial | `.gstack/sprint-contract-2026-07-20-cashflow-sheet-tutorial.md` | RETROSPECTIVE_PENDING | - |
| Cashflow multi-month apply | `docs/architecture/contracts/2026-07-21-cashflow-multi-month-apply.md` | COMPLETE | 100/100 |
| Cashflow weekly lock | `docs/architecture/contracts/2026-07-22-cashflow-weekly-lock.md` | COMPLETE | 100/100 |
| Cashflow multi-year visibility hotfix | `docs/architecture/contracts/2026-07-22-cashflow-multi-year-visibility-hotfix.md` | COMPLETE | 100/100 |
| Cashflow ERP settlement UX | `docs/architecture/contracts/2026-07-22-cashflow-erp-settlement-ux.md` | COMPLETE | 100/100 |

이전 Phase는 현재 Phase를 100점으로 마감한 뒤 같은 기준으로 역검증한다. 점수가 부족하면 완료 상태를 취소하고 보완 작업으로 되돌린다. 향후 Phase는 구현을 시작하기 전에 이 등록부에 계약과 감시자를 먼저 등록하고, 100점 증거가 없으면 다음 Phase 또는 Stage로 넘어가지 않는다.

## Cashflow weekly lock Phase 계약 요약

- 기존 Firestore 명령 트랜잭션과 월 결산 계약을 재사용한다.
- 주간 정산 완료는 해당 주차 원장 기준본, source/target revision, SHA-256, 처리자·처리시각을 포함하는 서버 잠금이다.
- 프로젝트 접근 권한이 있는 활성 사용자는 월 결산 전에 사유와 현재 revision으로 재오픈할 수 있다.
- 월 결산 후 주차 단독 재오픈은 금지하고 기존 Finance/Admin 월 재오픈 계약을 따른다.
- 시트, Projection, Actual 변경은 JVM의 정확한 주차 쓰기 경계에서 차단한다.
- BFF는 잠금 조회·완료·재오픈을 명시적 연월/주차 계약으로 중계한다.
- UI·색상 개편, Redis, 외부 큐, Live 배포는 이 Phase 범위 밖이다.

세부 구현 가설·실행·검증 수치는 `src/app/features/cashflow-sheet-compare/README.md`에 계속 기록한다.

### 2026-07-22 독립 재감사

- 계약·main 호출 경로: 20/20
- 원자성·동시성: 15/15
- 스냅샷·해시·버전: 15/15
- 권한·재오픈·월 우선순위: 15/15
- 멱등성·감사·legacy: 10/10
- BFF·TypeScript·오류 계약: 10/10
- 회귀·실제 입력: 10/10
- 문서·빌드·게이트: 5/5

최종 점수는 100/100이다. 이 판정은 Cashflow weekly lock Phase만 마감하며, UI/디자인 Phase와 Stage 배포는 별도 계약 및 과거 관련 Phase 소급 감사 전까지 시작하지 않는다.
