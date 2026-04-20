# Shared Migration Retrospective

- route: `shared / retrospective`
- primary users: PM, 운영자, 개발자, 의사결정자
- status: active
- last updated: 2026-04-20

## Purpose

기존 스프레드시트를 강제로 앱으로 이관하던 이번 프로젝트를 되돌아보며, 무엇을 너무 일찍 제품화했는지와 어떤 접근이 더 AI-native했는지 기록하는 회고 문서다.

## Current UX Summary

- 실제 운영의 시작점은 새 앱이 아니라 기존 스프레드시트와 업로드 파일이었다.
- 사용자는 새 워크플로를 배우고 싶었던 것이 아니라, 기존 시트보다 덜 불편하고 덜 위험한 이관을 원했다.
- 따라서 초기에 필요한 것은 replace-first product UI보다, 기존 시트/문서를 해석하고 검토하고 반영하는 translation layer에 더 가까웠다.

## Current Feature Checklist

- [x] 이번 프로젝트를 `신규 제품 개발`보다 `기존 스프레드시트 운영체계의 강제 migration`으로 해석함
- [x] `LLM Wiki` 패턴이 왜 이 회고 관점의 배경이 되었는지 문서화함
- [x] 초기 wedge로 `markdown/spreadsheet intake + admin 검토면`이 더 AI-native했을 수 있다는 판단을 기록함
- [x] `표준화된 spreadsheet-first + crawler + md/json converter + admin/PM viewing harness`가 Firestore-first 앱보다 더 장기적인 방향일 수 있다는 판단을 기록함
- [x] `데이터를 반드시 플랫폼 안으로 모아야 한다`는 centralize-first 가정 자체가 AI-native하지 않았을 수 있다는 비판을 기록함
- [x] 통장내역/triage/evidence/cashflow/admin 연결 때문에 `admin-only`로 끝날 수는 없었다는 점을 분리해 정리함
- [x] PM 편집면은 필요했지만, 더 늦게 하나의 핵심 surface로 승격했어야 했다는 판단을 기록함
- [x] 회고 문답을 이후 의사결정의 기준 문장으로 남김
- [x] `Office Hours`와 `CEO Review` 렌즈로 같은 판단을 다시 점검함
- [x] `gstack` 관점에서는 `PM thick app`보다 `admin-first agent console + PM thin viewer`가 더 맞다는 판단을 추가함
- [x] 이 방향이 성립하는 치명적 전제로 `시트 구조 표준화와 publish governance`를 명시함
- [ ] 이 회고를 실제 roadmap cut rule이나 feature gate 기준으로 다시 환산함

## Recent Changes

- [2026-04-20] “처음부터 앱을 넓게 만들기보다, 기존 스프레드시트/문서를 intake로 받아 admin 중심 검토와 export를 먼저 붙였어야 했는가”라는 질문을 회고 문답으로 정리했다.
- [2026-04-20] 이 프로젝트의 성격을 `새 제품 개발`보다 `이미 돌아가던 스프레드시트 운영체계를 강제로 이관하는 migration`으로 재정의했다.
- [2026-04-20] 더 AI-native한 초기 전략은 replace-first가 아니라 `translate / augment first`였다는 판단을 남겼다.
- [2026-04-20] 다만 최종적으로는 PM/사업담당자의 수정 결과가 cashflow, 제출, admin 모니터링까지 이어져야 했으므로 PM editing surface 자체가 불필요했던 것은 아니라고 정리했다.
- [2026-04-20] `Office Hours`와 `CEO Review` 렌즈로 다시 봤을 때도, 시트 형식이 표준화돼 있다는 전제에서는 `spreadsheet-first + viewing harness`가 Firestore-first 앱보다 더 AI-native하고 더 장기적인 방향일 가능성이 높다는 판단을 추가했다.
- [2026-04-20] `gstack` 관점으로도, 중심 bet을 `PM thick app`에 두기보다 `표준 시트 + admin agent console + PM thin viewer`로 두는 편이 더 적합하다는 요약을 추가했다.
- [2026-04-20] `데이터를 꼭 플랫폼 안으로 모아야 한다`는 centralize-first 가정은 전통적인 SaaS 사고에 더 가깝고, 이 프로젝트에서는 `spreadsheet as canonical source + app as overlay/governance layer`가 더 AI-native했을 수 있다는 판단을 추가했다.
- [2026-04-20] 이 생각의 직접적인 계기가 된 `LLM Wiki` 패턴을 배경으로 정리하고, 현재까지의 마이그레이션 매몰비용을 살리면서 플랫폼을 어떻게 재정의할지 후속 방향까지 추가했다.

## Known Notes

- 이 회고의 핵심은 “PM 화면이 필요 없었다”가 아니다.
- 핵심은 `시작 순서`였다. 먼저 필요한 것은 예쁜 portal shell보다, 기존 시트와 업로드 파일을 읽고 보존하고 diff를 설명하는 intake/translation layer였다.
- 강제 migration 프로젝트에서는 성공 기준이 “새 UX가 멋지다”보다 `기존 시트보다 덜 위험하고 덜 불신받는다`에 더 가깝다.
- 이 판단은 `시트 형식이 표준화돼 있다`는 전제 위에서만 강하다. 구조 자유까지 허용되면 harness가 아니라 fragile ETL이 된다.
- 따라서 Firestore나 앱 DB의 더 적합한 역할은 `정본 저장소`보다 `derived metadata / audit / review / publish state`에 가까웠을 수 있다.
- 그렇다고 현재까지 만든 플랫폼을 버리는 것은 아니다. 이미 쌓인 auth, export contract, admin 운영면, ingestion 흐름, audit 성격의 자산은 `overlay/governance layer`로 재활용하는 편이 훨씬 현실적이다.

## Related Files

- `docs/architecture/bank-upload-triage-wizard-spec-2026-04-06.md`
- `docs/architecture/workbook-phase-1-starter-pack-2026-04-04.md`
- `docs/superpowers/specs/2026-04-15-embedded-workbook-engine-design.md`
- `docs/superpowers/plans/2026-04-20-spreadsheet-overlay-transition-roadmap.md`
- `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- `docs/wiki/patch-notes/pages/portal-cashflow.md`
- `docs/wiki/patch-notes/pages/admin-cashflow-export.md`

## Related Tests

- `src/app/platform/bank-import-triage.test.ts`
- `src/app/data/portal-store.integration.test.ts`
- `src/app/platform/portal-happy-path.test.ts`
- `src/app/platform/portal-project-selection.test.ts`
- `src/app/platform/cashflow-export-surface.test.ts`

## Related QA / Ops Context

- 통장내역 업로드와 주간 사업비 입력은 사람 입력 보존, overwrite/backspace, handoff 흐름 같은 기본 신뢰 이슈가 반복적으로 회귀했다.
- 포털 안정화 작업에서는 새로운 기능 추가보다도 bootstrap loop, realtime coupling, route/provider coupling을 줄이는 일이 더 자주 우선순위가 되었다.
- admin cashflow export는 실제 운영에서 “분석 대시보드”보다 “다운로드 중심 운영 surface”로 더 빠르게 수렴했다.

## Retrospective Q&A

### Q. 왜 이런 생각을 하게 됐나?

A. 직접적인 계기는 `LLM Wiki` 패턴이었다. 이 패턴은 원문을 매번 다시 검색하는 RAG보다, 원문 위에 LLM이 유지보수하는 persistent wiki를 두는 쪽을 제안한다. 이 관점을 InnerPlatform에 대입하면, 기존 스프레드시트는 raw source이고 앱은 정본을 대체하는 곳이 아니라 그 위에서 요약, 비교, 검토, publish를 담당하는 compiled knowledge/ops layer가 된다.

### Q. 그냥 markdown 파일이나 스프레드시트를 받고 admin 페이지로만 시작했으면 더 AI-native하지 않았나?

A. 부분적으로 그렇다. 특히 초기에 더 맞는 전략은 `replace-first app`보다 `file-first intake + admin review`였다. 이미 기존 시트가 운영의 source of truth 역할을 하고 있었기 때문에, AI는 새 입력 UX를 강요하기보다 기존 시트 구조를 해석하고 이상치를 잡고 반영 경로를 설명하는 쪽이 더 자연스러웠다.

### Q. 그럼 PM용 portal surface는 과했던 건가?

A. 초기에 넓게 만든 것은 과했다. 하지만 최종적으로 불필요했던 것은 아니다. 사람 입력 보정, 사업별 상태 확인, 저장 후 cashflow/제출/admin 출력까지 이어지는 흐름 때문에 PM editing surface는 필요했다. 다만 여러 화면을 동시에 제품화하기보다, `하나의 핵심 편집면`으로 더 늦게 승격했어야 했다.

### Q. 왜 이 프로젝트에서 이런 판단이 더 중요했나?

A. 이번 일은 신규 제품 개발이 아니라 `강제 migration`에 가까웠기 때문이다. 이런 프로젝트에서 사용자가 기대하는 것은 새 경험이 아니라, 기존보다 덜 깨지고 덜 불편하고 덜 위험한 이관이다. 그래서 AI-native 전략도 “새로운 UI를 설계한다”보다 “기존 문서와 시트를 번역하고 보조한다”가 먼저였다.

### Q. 다시 하면 어떻게 자르는 게 맞나?

A. 초기는 `기존 시트/문서 ingest -> admin 검토/반영 -> export/parity 확인`으로 자르고, PM surface는 하나의 핵심 입력면만 남기는 게 더 맞다. 이후 사람 입력과 공식 출력 매핑이 안정화된 뒤에야 workbook authority나 더 넓은 portal shell로 확장하는 순서가 안전하다.

### Q. `데이터를 꼭 플랫폼 안으로 모아야 한다`는 가정 자체가 잘못됐던 건가?

A. 그 가능성이 높다. 이 가정은 AI-native라기보다 전통적인 SaaS 사고에 가깝다. 이번 프로젝트처럼 이미 표준화된 스프레드시트 운영이 존재하는 환경에서는, 더 자연스러운 방향이 `centralize-first`가 아니라 `overlay-first`였을 수 있다. 즉 앱은 정본을 대체하는 곳이 아니라, 기존 시트를 읽고 구조화하고 diff를 설명하고 검토/승인을 돕는 governance layer였어야 한다.

### Q. 그럼 PM 페이지는 아예 필요 없었던 건가?

A. 아니다. 더 정확한 판단은 `PM thick app이 주 작업면이었던 것이 문제`였다는 쪽이다. PM에게는 여전히 viewer, inbox, exception handoff, 상태 확인 surface가 필요하다. 다만 사람들에게 새 입력 체계를 강하게 학습시키는 두꺼운 앱보다, 기존 시트를 유지한 채 얇은 surface로 연결하는 방식이 더 맞았을 가능성이 높다.

### Q. 그럼 지금까지 들어간 마이그레이션 비용은 낭비였나?

A. 전부 낭비는 아니다. 잘못된 부분은 `정본을 앱 안으로 끌어오는 방향`에 너무 일찍 베팅한 점이고, 남는 자산은 여전히 많다. 예를 들어 auth/rbac, admin cashflow/export, 통장내역 ingest/triage, label/policy 정리, patch-note/wiki, 운영 audit 관성은 모두 `overlay/governance layer`로 전환할 때 그대로 쓸 수 있다. 따라서 필요한 것은 full rollback이 아니라 `플랫폼 역할의 재정의`다.

## Office Hours Verdict

- 사용자가 정말 잃기 싫었던 것은 `앱 입력 경험`이 아니라 `익숙한 스프레드시트 운영 방식`이었다.
- 따라서 가장 좁은 wedge는 새 입력기를 강요하는 것이 아니라, 전사 폴더 안의 표준 시트를 읽고 변화와 이상치를 설명하는 `spreadsheet crawler + admin review/viewer`였다.
- 이 렌즈에서는 “사람들이 이미 좋아하던 write surface를 빼앗지 말고, 그 위에 AI를 얹어라”가 핵심 결론이다.

## CEO Review Verdict

- `Firestore-first app`은 더 관리 가능한 UI를 주지만, 더 큰 방향으로 보면 local maximum일 수 있다.
- 반대로 `standardized spreadsheet-first + crawler + md/json converter + admin/PM viewing harness`는 단순한 임시 마이그레이션 도구가 아니라, 장기적으로 `AI operating system for spreadsheets` 방향으로 확장될 수 있다.
- 이 렌즈에서 앱의 역할은 정본을 대체하는 것이 아니라:
  - 비교
  - 설명
  - 검토
  - publish
  - audit
  - export
  를 담당하는 harness로 재정의된다.

## Gstack Verdict

- `gstack` 관점에서 이 프로젝트의 핵심 문제는 “PM용 새 앱을 얼마나 잘 만드느냐”가 아니라 “기존 시트 운영을 AI가 읽고 설명하고 통제하게 만들 수 있느냐”에 더 가깝다.
- 따라서 중심 제품은 `PM thick app`보다 `spreadsheet crawler + normalized JSON/MD converter + admin agent console`이어야 한다.
- PM surface는 완전히 없애기보다:
  - viewer
  - inbox
  - exception handoff
  수준의 thin surface로 두는 편이 더 맞다.
- 이 판단 역시 시트 구조 표준화가 유지된다는 전제 아래에서만 강하다.

## Overlay-First Verdict

- 이번 회고의 더 날카로운 결론은 `플랫폼 안으로 데이터를 모아야 운영이 가능하다`는 가정 자체가 이 프로젝트에선 맞지 않았을 수 있다는 점이다.
- 이미 전사 표준 시트와 폴더가 운영의 정본 역할을 하고 있었다면, 앱의 기본 역할은 primary write system이 아니라:
  - crawl
  - normalize
  - explain
  - review
  - publish
  - audit
  를 담당하는 overlay/governance layer여야 했다.
- 이 관점에서는 Firestore-first 앱보다 `spreadsheet as canonical source + app as agent harness`가 더 AI-native하고 더 지속가능한 기본 방향에 가깝다.

## LLM Wiki Background

- 이 회고를 밀어준 직접적 배경은 `LLM Wiki` 패턴이다.
- 이 패턴의 핵심은 원문을 매번 다시 찾는 대신, LLM이 원문 위에 지속적으로 갱신되는 markdown wiki를 유지보수하게 만드는 것이다.
- InnerPlatform에 대응시키면:
  - raw sources: 전사 폴더의 사업비 시트, 통장내역, 증빙 파일
  - persistent wiki / derived layer: `md/json converter`, patch-notes wiki, diff 요약, 이상치 설명, 운영 메모
  - schema: `AGENTS.md`, export contract, 정책 셀 규칙, publish 규칙
- 이 관점은 `정본을 옮기자`보다 `정본 위에 LLM이 유지하는 구조화된 운영 지식 레이어를 얹자`는 쪽에 가깝다.
- 그래서 이 프로젝트에서 더 AI-native했을 수 있는 방향도 `플랫폼 DB centralization`보다 `spreadsheet-first + compiled wiki/ops layer`로 읽힌다.

## Platform Direction From Here

- 지금부터의 방향은 `지금 플랫폼을 버릴 것인가`가 아니라 `지금 플랫폼의 역할을 무엇으로 재정의할 것인가`여야 한다.
- 가장 현실적인 방향은 다음과 같다.
  - 스프레드시트는 계속 canonical source로 둔다.
  - 앱은 `crawler + md/json converter + admin agent console + thin PM viewer` 중심으로 이동한다.
  - Firestore 같은 저장소는 primary source가 아니라 metadata, audit, publish state, cache 용도로 축소한다.
- 매몰비용을 고려하면 우선순위는 아래와 같이 자르는 편이 맞다.
  - 유지/강화:
    - auth / RBAC
    - admin cashflow / export contract
    - 통장내역 ingest / triage
    - label policy / 운영 위키 / audit trail
    - safe viewer 성격의 portal surface
  - 축소/동결:
    - PM thick write surface 확대
    - broad portal shell productization
    - source-of-truth를 앱 DB로 옮기려는 추가 마이그레이션
  - 신규 투자:
    - shared folder spreadsheet crawler
    - normalized JSON + markdown converter
    - admin review / publish / anomaly console
    - PM inbox / viewer / handoff surface
- 즉 앞으로의 플랫폼은 `새 입력 제품`이 아니라 `기존 정본을 이해하고 운영하는 에이전트 레이어`로 발전하는 편이 더 자연스럽다.

## Execution Principles

- **원문 정본 우선:** 표준 스프레드시트와 공유 폴더를 canonical source로 유지하고, 앱은 그것을 대체하지 않는다.
- **대체보다 번역:** 새 입력 UI를 넓히기보다 `crawl -> normalize -> explain -> review` 파이프라인에 먼저 투자한다.
- **Admin-first, PM-thin:** 운영 제어는 admin agent console에 두고, PM surface는 viewer / inbox / handoff 위주로 얇게 유지한다.
- **앱 저장소는 metadata:** Firestore와 앱 DB는 primary truth가 아니라 audit, publish state, cache, alert, comment를 담당한다.
- **전환은 parity gate로:** 기존 시트 결과와 설명 가능성이 확보되기 전까지는 `replace-first cutover`를 하지 않는다.

## Issue / Roadmap Snapshot

- **Track 1. Spreadsheet Source Governance**
  - 목표: 전사 표준 시트 템플릿, named range, publish 규칙, 폴더 구조를 고정한다.
  - 끝났다고 볼 기준: crawler가 “어떤 파일이 공식 입력인가”를 사람 도움 없이 안정적으로 찾는다.
- **Track 2. Crawler + MD/JSON Converter**
  - 목표: 공유 폴더의 시트와 첨부 파일을 읽어 normalized JSON과 markdown 설명을 만든다.
  - 끝났다고 볼 기준: 신규 시트 1건 추가 시 admin이 raw sheet 없이도 핵심 변경점과 이상치를 읽을 수 있다.
- **Track 3. Admin Agent Console**
  - 목표: diff, anomaly, publish, export, audit를 한 곳에서 다루는 운영 console을 만든다.
  - 끝났다고 볼 기준: cashflow/export 승인과 예외 처리를 PM portal 없이 admin에서 끝낼 수 있다.
- **Track 4. PM Thin Surface**
  - 목표: PM에게는 입력기보다 viewer, inbox, 상태 확인, handoff 진입을 제공한다.
  - 끝났다고 볼 기준: PM이 새 입력 규칙을 배우지 않고도 자신의 사업 상태와 요청사항을 처리할 수 있다.
- **Track 5. Firestore Role Reduction**
  - 목표: Firestore의 역할을 source-of-truth에서 metadata / audit / cache로 축소한다.
  - 끝났다고 볼 기준: 앱 DB가 깨져도 원문 시트와 converter 산출물 기준으로 운영 상태를 복구할 수 있다.

상세 실행 문서는 `docs/superpowers/plans/2026-04-20-spreadsheet-overlay-transition-roadmap.md`에 별도로 정리한다.

## Fatal Assumption

- 이 방향이 맞으려면 `자유롭게 쓴다`는 말이 값 입력 자유를 뜻해야 한다.
- 시트 이름, 핵심 표 위치, named range, 정책 셀 위치, publish 규칙까지 자유롭게 흔들리면 이 접근은 AI-native harness가 아니라 brittle ETL로 무너진다.
- 따라서 장기 방향으로 채택하려면 최소한 아래 governance가 필요하다.
  - 템플릿 버전 고정
  - 핵심 시트/표 위치 고정
  - 정책 셀 또는 named range 고정
  - publish 규칙 존재
  - 앱은 정본이 아니라 derived metadata / review / audit layer 담당

## Next Watch Points

- 이후 새 surface를 만들 때도 `migration인지, 신규 제품인지`를 먼저 구분하고 있는지
- 기존 시트/파일 기반 운영을 대체할 때 `replace-first` 대신 `translate/augment-first`로 시작할 수 있는지
- PM surface 확대 전 `admin 검토`, `parity`, `사람 입력 보존`, `export contract`가 먼저 잠겼는지
