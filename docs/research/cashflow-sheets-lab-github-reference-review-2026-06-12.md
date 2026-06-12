# Cashflow Sheets Lab GitHub Reference Review

작성일: 2026-06-12
브랜치: `experiment/sheets-cashflow-projection-readonly`

## 목적

캐시플로우 시트 연동 랩을 직관만으로 구현하지 않기 위해 GitHub 레퍼런스를 확인했다.
이번 반영 기준은 다음 네 가지다.

1. Google Sheets API 호출량을 줄인다.
2. 같은 시트/같은 탭에 대한 중복 미리보기 요청을 줄인다.
3. Java read model 값 매칭 비용을 줄인다.
4. 내부 SaaS 보안 정책은 과차단하지 않고, 외부 사용자 차단과 작성자 기록 중심으로 둔다.

## 확인한 GitHub 레퍼런스

| # | 레퍼런스 | 확인한 로직/패턴 | 반영 여부 |
|---|---|---|---|
| 1 | https://github.com/googleapis/google-api-nodejs-client/blob/main/samples/sheets/quickstart.js | `spreadsheets.values.get`에서 명시 range를 지정하고 `spreadsheets.readonly` scope를 사용 | 반영: 랩 전용 read range `A1:ZZ220`, readonly 정책 노출 |
| 2 | https://github.com/googleworkspace/node-samples/tree/main/sheets/quickstart | Sheets API quickstart 흐름과 읽기 전용 API 경계 | 반영: OAuth 사용자 토큰을 넘기지 않고 시스템 계정 read-only로 고정 |
| 3 | https://github.com/theoephraim/node-google-spreadsheet | 문서/시트 단위 로딩 후 셀 접근을 캐시하는 방식 | 반영: Google sheet preview만 짧은 TTL 캐시 |
| 4 | https://github.com/SheetJS/sheetjs | A1 좌표와 범위 기반 worksheet 처리 관점 | 반영: `toA1`, `cashflowMappingKey`, 동적 좌표 매핑 유지 |
| 5 | https://github.com/benborgers/opensheet | 공개 시트 URL에서 ID를 추출해 서버가 JSON을 반환하는 얇은 read path | 반영: `/d/<id>`, `?id=<id>`, raw ID 추출을 BFF/프론트에 맞춤 |
| 6 | https://github.com/TanStack/query | 같은 query key에 대한 중복 요청 합류와 서버 상태 캐시 관점 | 반영: 동일 시트 preview in-flight dedupe |
| 7 | https://github.com/handsontable/handsontable | 큰 표 UI에서 전체 편집보다 필요한 viewport/preview 중심으로 표시 | 반영: UI는 값 미리보기 일부만 렌더링하고 쓰기 버튼 없음 |
| 8 | https://github.com/dream-num/univer | 브라우저 UI와 서버/headless 처리 분리 | 반영: 화면은 검토용, 계산/값 출처는 Java read model로 분리 |
| 9 | https://github.com/burnash/gspread | 서비스 계정 기반 시트 접근과 명시 worksheet/range 읽기 패턴 | 반영: 사용자별 Google 인증 요구를 늘리지 않고 시스템 계정 공유 방식 유지 |
| 10 | https://github.com/robin900/gspread-dataframe | 시트 데이터를 DataFrame처럼 구조화하기 전 raw matrix를 한 번 정규화 | 반영: `normalizeMatrix` 후 섹션/라인/주차를 한 번 분석 |
| 11 | https://github.com/jlord/sheetsee.js | 시트 데이터를 시각화 가능한 구조로 변환하되 필요한 모듈만 쓰는 관점 | 반영: export/write 기능 없이 preview 모듈만 추가 |
| 12 | https://github.com/ag-grid/ag-grid | 대용량 row UI에서 데이터 모델과 렌더링 책임 분리 | 부분 반영: 이번 단계는 전체 그리드 도입 없이 preview table만 유지 |

## 실제 코드에 반영한 부하 절감

### 1. Google Sheets 읽기 범위 상한

기존에는 선택된 시트 탭 전체를 읽었다.
랩은 캐시플로우 양식 검토가 목적이므로 `server/bff/routes/cashflow-sheet-lab.mjs`에서 `A1:ZZ220`만 읽도록 했다.

반영 파일:

- `server/bff/google-sheets.mjs`: `rangeA1` 인자를 받아 values range를 `'Sheet'!A1:ZZ220` 형태로 구성
- `server/bff/routes/cashflow-sheet-lab.mjs`: 랩 전용 `CASHFLOW_SHEET_LAB_READ_RANGE`
- `server/bff/google-sheets.test.ts`: range가 실제 URL에 들어가는지 테스트

### 2. Google 시트 preview 짧은 캐시

캐시플로우 실제 값은 Java read model에서 오므로 캐시하면 안 된다.
반대로 시트의 레이아웃/메타는 같은 사용자가 같은 링크를 반복 검토할 때 거의 변하지 않는다.

반영:

- `createSheetPreviewLoader`
- 기본 TTL: 15초
- 동일 key 요청이 이미 진행 중이면 새 Google API 요청을 만들지 않고 기존 Promise에 합류
- 응답에 `sheetPreviewCache: hit | miss | in_flight_join` 노출

보안 판단:

- 캐시는 Google sheet layout만 대상으로 한다.
- Java 값은 요청마다 다시 읽는다.
- 권한 정책을 캐시하지 않는다.

### 3. Java snapshot 값 인덱싱

기존 구조는 매핑 좌표마다 `readModel.months`, flat rows, legacy weeks를 `find`로 다시 훑을 수 있었다.
이는 좌표 수가 많아질수록 `mappingCount * snapshotRows` 비용으로 커진다.

반영:

- `buildSnapshotAmountIndex(snapshot)`
- key: `mode|yearMonth|weekNo|lineId`
- `readModel.months`, flat rows, legacy weeks 세 shape를 한 번에 Map으로 인덱싱
- `previewValues` 생성 시 Map 조회로 금액을 찾음

테스트:

- `server/bff/routes/cashflow-sheet-lab.test.mjs`
- 같은 시트 두 번 검토 시 Google 호출은 1회, Java 호출은 2회 유지
- Java 값이 매 요청마다 바뀌면 preview 값도 바뀌는지 확인

### 4. 매핑 키 유틸 분리

A1 좌표와 Java 값 매칭 key는 이후 phase에서 디버깅 포인트가 된다.
그래서 `cashflowMappingKey`를 템플릿 분석 모듈에 분리했다.

반영:

- `server/bff/cashflow-sheet-template.mjs`: `cashflowMappingKey`
- `server/bff/routes/cashflow-sheet-lab.mjs`: snapshot amount index key로 사용

## 반영하지 않은 것

| 항목 | 미반영 이유 |
|---|---|
| 사용자별 Google OAuth 토큰 필수화 | 내부 SaaS 편의성과 충돌. 서비스 계정으로 공유된 시트만 읽는 원칙 유지 |
| Google Sheet writeback/export | 이번 브랜치 목표가 cashflow/projection 확인용 read-only lab임 |
| 프론트에서 수식/캐시플로우 계산 | 계산 권위가 Java에 있어야 기존 audit ledger 원칙과 맞음 |
| BFF에 cashflow 계산 복제 | Java read model 우선 원칙과 충돌 |
| 긴 TTL 캐시 | 실제 값/양식 변경 디버깅이 어려워짐. 15초만 둠 |

## 보안/권한 정책

Java API 권한은 과도하게 역할별 차단하지 않는다.
이 브랜치의 read-only lab 경계는 다음 정도면 충분하다.

- Google 로그인된 `@mysc.co.kr` 사용자는 기록 role과 무관하게 `workspace_user`로 Java read path에 전달
- 외부 이메일은 `pm`, `admin` 같은 role 값이 있어도 차단
- Google Sheets는 서비스 계정이 읽을 수 있는 시트만 허용
- 시트 탭은 `cashflow(사용내역 연동)` 계열만 허용
- 시트 읽기 범위는 `A1:ZZ220`으로 고정
- actor role은 필터 조건보다 기록/로그 성격으로 유지
- 화면에는 `service_account`, `spreadsheets.readonly`, `sheetReadRange`, `sheetPreviewCache`를 노출해 운영자가 원인을 볼 수 있게 함
- 브라우저 응답에는 Java raw snapshot을 내려주지 않고, 좌표별 `previewValues`만 내려준다
- Java 값은 Sheet 구조 미리보기 이후 별도 요청으로 붙인다
- hover에는 원본 Sheet 셀 텍스트와 Java 매핑 값을 보여준다

## 검증 기준

다음 테스트가 통과해야 한다.

```bash
npm test -- --run server/bff/google-sheets.test.ts server/bff/cashflow-sheet-template.test.mjs server/bff/routes/cashflow-sheet-lab.test.mjs src/app/integrations/google-sheets/link.test.ts src/app/lib/sheets-cashflow-readonly-client.test.ts src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts
```

현재 결과:

- Test Files: 6 passed
- Tests: 26 passed

CSO 사이드카 리뷰 후 추가 반영:

- raw `cashflowSnapshot` 응답 제거
- role-only 허용 경로 제거
- `pm@example.com`, `admin@example.com` 차단 테스트 추가
- `cashflow(사용내역 연동)` 계열 탭만 허용
- `includeValues:false`로 구조 미리보기와 Java 값 조회를 분리
