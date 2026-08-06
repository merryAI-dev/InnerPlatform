# Sprint Contract: Google Sheet–JVM 변동 감지 및 목요일 자동 동기화
**날짜:** 2026-08-06
**예상 소요:** 4~6시간 + CI/배포 검증
**상태:** APPROVED

## Objective
연결된 Google Sheet의 canonical 현금흐름 셀과 JVM `cashflow_weeks`를 동일한 기준으로 비교한다. 미반영 변경은 프로젝트 화면에 건수로 표시하고, 매주 목요일 09:30 Asia/Seoul에 연결된 프로젝트를 자동 동기화한다. 반영 성공은 JVM post-write read가 고정 snapshot과 일치할 때만 확정한다.

## 불변조건
- `SYNCED`는 Sheet snapshot과 JVM canonical cells가 동일할 때만 반환한다.
- `EMPTY`, `ZERO`, `VALUE`는 서로 다른 상태다.
- 확인 요청은 JVM을 변경하지 않는다.
- 자동/수동 apply 모두 `snapshot -> apply -> JVM read-back` 순서를 지킨다.
- 한 프로젝트의 실패는 다른 프로젝트 동기화를 중단하지 않는다.
- 결산 잠금, 승인 확인, stale revision 충돌을 자동으로 우회하지 않는다.

## 상태 계약
- `CHECKING`: 외부 시트 또는 JVM 비교 진행 중
- `SYNCED`: canonical diff 0건
- `CHANGED`: canonical diff 1건 이상
- `UNAVAILABLE`: Sheet/JVM 조회 또는 비교 실패. 0건으로 대체하지 않는다.

## 변경 건수
키는 `sourceYear + yearMonth + weekNo + mode + cashflowLine`이다. `cellState` 또는 `amount`가 다르면 1건이다. 서식, 메모, 동일 effective value의 수식 변경, 합계/잔액 행, 연결 범위 밖 셀은 제외한다.

## 목요일 자동 동기화
- Vercel cron: `30 0 * * 4` (목요일 09:30 Asia/Seoul)
- 대상: 시트 연결 설정이 있는 프로젝트
- 프로젝트별: snapshot 보존 -> diff -> 변경이 있을 때만 기존 apply -> JVM read-back
- no-op 프로젝트는 쓰지 않는다.
- idempotency key는 해당 KST 실행 회차와 projectId로 고정한다.
- 중복 실행은 같은 결과를 재사용하며 동시 실행으로 두 번 적용하지 않는다.
- 잠긴 범위 또는 확인이 필요한 변경은 실패/보류로 기록하고 강제 반영하지 않는다.

## 서버 응답 계약
```json
{
  "status": "CHANGED",
  "pendingChangeCount": 31,
  "projectionChangeCount": 18,
  "actualChangeCount": 13,
  "sourceRevision": "sha256:...",
  "targetRevision": "sha256:...",
  "checkedAt": "2026-08-06T02:30:00.000Z"
}
```

## Unit test 성공 기준
- 동일 cell 집합은 0건이다.
- `EMPTY <-> ZERO`, `ZERO <-> VALUE`, `EMPTY <-> VALUE`, 금액 변경은 각각 1건이다.
- 수식만 바뀌고 effective value가 같으면 0건이다.
- Projection/Actual 건수의 합은 총 건수와 같다.
- 중복 canonical key와 알 수 없는 line은 성공으로 숨기지 않는다.
- Sheet API/JVM 실패는 `UNAVAILABLE`이다.
- legacy 12개 line의 누락 4개를 0으로 만들지 않는다.
- Projection을 Actual로 fallback하지 않는다.
- apply 후 셀 1개라도 다르면 성공하지 않는다.
- stale source revision, 부분 저장, read-back 실패는 실패한다.
- 같은 idempotency key는 중복 쓰기 없이 replay된다.
- cron은 목요일 09:30 KST에만 실행 대상을 만든다.
- 연결 없는 프로젝트, no-op 프로젝트는 apply하지 않는다.
- 프로젝트 A 실패 후 프로젝트 B는 계속 처리한다.
- cron 인증 실패는 401/403이며 어떤 프로젝트도 변경하지 않는다.
- 프론트는 `CHANGED/N`을 `이전 대비 변동 사항 N건 · 새로 반영이 필요합니다`로 표시한다.
- 작은 `시트 이동` 버튼은 기존 시트 설정 화면으로 이동한다.
- 상태 확인만으로 apply가 호출되지 않는다.

## 통합 성공 기준
- QA fixture `Sheet Projection 249,199,960 / JVM 218,236,560`은 `CHANGED`이고 차액을 숨기지 않는다.
- 정상 apply 후 JVM Projection은 249,199,960이고 diff는 0건이다.
- 31건 중 30건만 저장되면 apply는 실패한다.
- 자동 동기화 run은 프로젝트별 결과와 revision을 감사 기록에 남긴다.

## 실패 기준
- 마지막 refresh 성공만으로 `SYNCED/FRESH`를 표시한다.
- 프론트가 자체 diff를 계산한다.
- API/JVM 실패를 0건으로 표시한다.
- apply 후 read-back 없이 성공 처리한다.
- 자동 동기화가 잠금/승인 정책을 우회한다.
- 사용자 화면을 강제 refresh한다.
- 테스트를 skip하거나 실제 크기보다 축소된 예제로만 검증한다.

## 범위 밖
- 실시간 polling
- Google Sheet 편집
- 계산 공식 변경
- 결산 상태 모델 재설계
- AXR–CMK QA 연결 교체

## 검증 명령
```bash
npx vitest run src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/lib/sheets-cashflow-readonly-client.test.ts
node --test server/bff/cashflow-sheet-snapshot.test.mjs server/bff/routes/cashflow-sheet-lab.test.mjs server/bff/worker-endpoints.test.ts server/bff/scheduler-config.test.ts
npm test
npm run bff:test:integration
npm run build
```
