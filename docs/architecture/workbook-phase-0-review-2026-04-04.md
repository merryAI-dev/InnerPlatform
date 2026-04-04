# Workbook Phase 0 Review

작성일: 2026-04-04  
대상: 플랫폼 엔지니어링 / PM 운영 전환 태스크포스

## 결론

phase 0는 `go`입니다.  
다만 그대로 phase 1 구현에 들어가면 안 되는 경계 조건 3개가 확인됐고, 이를 phase 1 입력물에 명시적으로 반영해야 합니다.

## Findings

### 1. 기준선은 이제 tracked artifact로 고정해야 한다

초기 phase 0는 `output/spreadsheet` 안의 생성물에 기준선이 남아 있었습니다.  
이 상태는 로컬 파일 정리나 context 손실이 나면 다음 단계가 다른 workbook을 같은 기준선으로 착각할 수 있습니다.

따라서 canonical freeze artifact를 다음 파일로 고정합니다.

- [workbook-freeze-line-2026-04-04.json](/Users/boram/InnerPlatform/docs/architecture/workbook-freeze-line-2026-04-04.json)

핵심 수치:

- workbook SHA-256: `9ee7d582c898532ddb6f25fb8867ec4501dcb5074b96320fad2338f017f00868`
- sheet count: `17`
- formula count: `1879`
- source issue count: `73`

### 2. source bug ledger만으로는 semantic anomaly를 다 못 잡는다

`사용내역` 탭에서 `N4:N9`의 수식이 모두 `=$K$4/11*10`으로 고정되어 있습니다.  
이건 `#REF!`처럼 spreadsheet error로 떨어지지 않기 때문에 source bug ledger에는 안 잡히지만, 그대로 앱 규칙으로 옮기면 의도와 다른 계산을 공식화할 위험이 큽니다.

즉 phase 1에서 해야 할 일은:

- 수식을 “복사”하는 것이 아니라
- 수식이 말하려는 업무 규칙을 추정하고
- semantic anomaly는 명시적으로 `원본 수식 의심 패턴`으로 격리하는 것입니다.

### 3. `통장잔액` 연쇄는 J13에서 끊긴다

`사용내역`의 running balance chain은 아래에서 처음 깨집니다.

- `J13 = J12-N13-O13+L13+#REF!`

그 이후 `J14` 이후는 모두 전파 오류입니다.  
따라서 phase 1 golden fixture는 `J4:J12` 구간과 `J13 이후 오류 구간`을 분리해서 다뤄야 합니다.

## Gate Decision

phase 1로 넘어가도 되는 이유:

- workbook hash와 source issue counts가 고정되었다.
- QA preflight hook이 생겨 구현 전 회귀성 피드백을 먼저 훑을 수 있다.
- `사용내역`에서 무엇이 공식 규칙 후보이고 무엇이 source anomaly인지 초기 구분이 가능해졌다.

phase 1에서 반드시 지켜야 할 제약:

- `N4:N9` 절대참조 패턴을 앱 공식 규칙으로 채택하지 말 것
- `J13 이후`는 정상 기대값 fixture가 아니라 `원본 오류 전파 구간`으로 분류할 것
- direct-entry와 bank-upload를 같은 authoritative DTO로 수렴시키되, source workbook의 깨진 수식은 fidelity 대상이 아니라 triage 대상으로 다룰 것

## Recommended Phase 1 Entry

phase 1의 첫 산출물은 이 순서가 맞습니다.

1. `사용내역` rule catalog
2. tracked fixture seed
3. authoritative derivation test
4. replay compare
