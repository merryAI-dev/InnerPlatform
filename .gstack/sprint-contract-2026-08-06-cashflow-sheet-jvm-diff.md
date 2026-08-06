# Sprint Contract: Cashflow 3-Way Drift Detection

**SPP:** Specification–Policy–Proof
**날짜:** 2026-08-06
**상태:** APPROVED
**대체 대상:** Google Sheet–JVM 변동 감지 및 목요일 자동 동기화 계약

## S — Specification

Google Sheet(S), JVM(J), Firestore(F)의 canonical 현금흐름 값을 독립적으로 비교한다. 값이 다르다는 이유만으로 특정 저장소를 오류로 단정하거나 자동 반영하지 않는다.

비교 키는 `sourceYear + yearMonth + weekNo + mode + cashflowLine`이며 `Projection`, `Actual`, `EMPTY`, `ZERO`, `VALUE`, 실제 금액을 비교한다. 서식, 메모, 합계·잔액 행, effective value가 같은 수식 변경, 연결 범위 밖 셀은 제외한다.

### 상태 분류

| 관찰 결과 | classification |
|---|---|
| S=J=F | `ALL_SYNCED` |
| S=J≠F | `FIRESTORE_DIFFERS` |
| S=F≠J | `JVM_DIFFERS` |
| J=F≠S | `SHEET_DIFFERS` |
| S≠J≠F | `THREE_WAY_DIFFERENT` |
| 일부 조회 실패 | `PARTIAL` |

분류는 원인을 추측하지 않고 관찰된 차이만 설명한다. API는 `sheetToJvm`, `sheetToFirestore`, `jvmToFirestore` 각각의 availability와 전체/Projection/Actual 변경 건수를 반환한다. 한 저장소를 읽지 못하면 그 저장소가 포함된 비교만 `UNAVAILABLE`로 표시한다.

### UI

- `시트 이동`은 프로젝트에 등록된 Google Sheet URL을 새 탭으로 연다.
- `시트 ↔ JVM`, `시트 ↔ 저장값`, `JVM ↔ 저장값`별 변경 건수를 표시한다.
- 조회 실패를 `0건`으로 표시하지 않는다.
- 사용자 화면을 강제로 새로고침하지 않는다.

## P — Policy

- 변동 확인은 read-only다.
- JVM과 Firestore가 달라도 조회를 차단하지 않는다.
- 어떤 값이 정답인지 시스템이 자동 결정하지 않는다.
- 목요일 18시 worker는 비교와 감사 기록만 수행하며 canonical 값을 쓰지 않는다.
- 기존 명시적 `반영` 버튼만 쓰기 경로로 유지한다.
- 수동 반영은 `고정 Sheet snapshot → 잠금·승인·revision 검증 → JVM 반영 → JVM read-back` 순서를 지킨다.
- 이번 스프린트에서 Firestore 불일치를 자동 복구하지 않는다.
- Google Sheet 자체를 읽지 못했을 때만 `시트 변경 확인 불가`를 표시한다.

## P — Proof

### Unit

- `S=J=F`, `S=J≠F`, `S=F≠J`, `J=F≠S`, `S≠J≠F`를 모두 검증한다.
- `EMPTY ↔ ZERO ↔ VALUE` 전이를 각각 1건으로 계산한다.
- JVM 또는 Firestore 한쪽 실패 시 가능한 다른 비교를 유지한다.
- 중복 key와 알 수 없는 line을 0건으로 숨기지 않는다.
- 확인 endpoint와 목요일 worker에서 apply/canonical write 호출이 0회다.

### Integration

- AXR fixture의 `Projection 249,199,960원 / 218,236,560원` 차이를 숨기지 않는다.
- JVM과 Firestore가 달라도 Sheet 비교 API가 성공한다.
- 반복 확인 요청이 canonical 데이터를 바꾸지 않는다.
- 수동 반영은 JVM read-back이 일치해야만 성공한다.

### Browser

- 실제 등록 Sheet가 새 탭으로 열리고 Sheet Lab으로 이동하지 않는다.
- 로딩 중 오류 문구를 표시하지 않는다.
- 부분 실패 시 확인 가능한 비교는 계속 표시한다.
- 자동 또는 강제 refresh가 발생하지 않는다.

### Regression commands

```bash
npx vitest run src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/lib/sheets-cashflow-readonly-client.test.ts
npx vitest run server/bff/cashflow-sheet-snapshot.test.mjs server/bff/routes/cashflow-sheet-lab.test.mjs server/bff/worker-endpoints.test.ts server/bff/scheduler-config.test.ts
npm test
npm run bff:test:integration
npm run build
```

## 실패 판정

- JVM/Firestore 불일치가 Sheet 비교를 차단한다.
- 조회 실패를 변동 0건으로 표시한다.
- cron이 apply 또는 canonical write를 호출한다.
- 프론트가 자체 금액 diff를 계산한다.
- `시트 이동`이 Sheet Lab을 연다.
- 실제 AXR 데이터 경로 없이 mock 테스트만 통과한다.

## 범위 밖

- 자동 동기화 및 자동 복구
- 정답 저장소 자동 선정
- 결산 상태 모델 변경
- Google Sheet 직접 수정
- 실시간 polling
- 새로운 비교 프레임워크나 의존성 추가
