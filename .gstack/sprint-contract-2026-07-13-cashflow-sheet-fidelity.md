# Sprint Contract: 캐시플로 시트 행 구조 충실화
**날짜:** 2026-07-13
**예상 소요:** 2일
**상태:** APPROVED

---

## 구현할 것

- `policies/cashflow-policy.json`, `src/app/data/types.ts`, `src/app/platform/cashflow-sheet.ts` — 누락된 MYSC 선입금 4개 line ID와 mode별 표시 문구 추가
- `server/bff/cashflow-sheet-template.mjs` — 동일 라벨을 입금/출금 문맥으로 구분하고 원본 Projection/ACTUAL 16개 행을 한 방향으로 읽기
- `server/jvm-weekly-api/.../CashflowLineCatalog.java` — 새 line ID 검증과 canonical 합계 지원
- `server/bff/cashflow-comparison.mjs`, `server/bff/routes/jvm-weekly-api.mjs` — JVM snapshot을 조회·조합해 `Projection - Actual` read model 계산
- `rust/spreadsheet-calculation-core/src/lib.rs` — 새 line ID가 settlement 계산 경로에서 누락되지 않도록 catalog 확장
- `src/app/lib/platform-bff-client.ts`, `src/app/components/cashflow/CashflowProjectSheet.tsx` — 서버 차이를 화면 최상단에 표시하고 Projection 전체 블록 다음 ACTUAL 전체 블록을 정확한 행 순서로 표시

## 성공 기준 (테스트 가능한 것만)

- [ ] 화면 순서가 `Projection - Actual 차이 → Projection → ACTUAL`이다.
- [ ] Projection과 ACTUAL은 품목별로 교차하거나 탭으로 합쳐지지 않는다.
- [ ] Projection 19행과 ACTUAL 19행의 문구·순서·강조가 승인 디자인과 일치한다.
- [ ] 기존 `MYSC_PREPAY_IN` 데이터는 직접사업비 선입금 입금으로 그대로 보인다.
- [ ] 새 선입금 4개 항목이 BFF, JVM, Rust, TypeScript allowlist와 입출금 합계에 포함된다.
- [ ] 시트 parser가 같은 `MYSC 선입금 - 직접사업비 등` 문구를 입금과 출금으로 서로 다른 line ID에 매핑한다.
- [ ] 차이는 서버에서 `Projection - Actual`로 계산되고 프론트에 역방향 계산식이 남지 않는다.
- [ ] Actual은 조회 전용이고 Projection 편집은 기존 project lease를 그대로 사용한다.
- [ ] 원본 XLSX SHA-256가 `e3ce2a8640cf45ffda7f68fe79f4529c87548c44618ebd1474956ea2a5363ac1`로 유지된다.
- [ ] 관련 Vitest, BFF test, Maven test, Cargo test와 production build가 통과한다.

## 실패 기준 (이것 중 하나라도 해당되면 FAIL)

- [ ] 행을 임의로 합치거나 순서를 변경한다.
- [ ] 같은 선입금 금액이 입금·출금 합계에 중복 반영된다.
- [ ] 기존 `MYSC_PREPAY_IN` 저장값이 유실되거나 다른 항목으로 이동한다.
- [ ] 차이가 `Actual - Projection`으로 남아 있다.
- [ ] 프론트가 권한이나 canonical 금융 값을 직접 확정한다.
- [ ] 시트에 쓰기, Live 데이터 변경 또는 Live 배포가 발생한다.
- [ ] Stage에서 두 세션 lease·임시저장 흐름이 회귀한다.

## 범위 밖 (이번 스프린트에서 하지 않을 것)

- 월 결산·재오픈 상태 머신
- 여러 입금 회차 자동 매칭
- 미지급 총액 산식 확정
- 전체 캐시플로 컴포넌트 분해 리팩토링
- Live 배포

## 평가 방법

- 단위 검증: line catalog, 합계, template parser, JVM read model, 고정 UI 순서 테스트
- 통합 검증: BFF snapshot proxy와 JVM cashflow endpoint 테스트
- 브라우저 검증: Stage 프로젝트 캐시플로에서 차이·Projection·ACTUAL 순서, 가로 스크롤, Projection 편집, Actual 조회 전용 확인
- 콘솔 오류와 4xx/5xx 요청이 없어야 함
- 성공 기준을 위에서부터 확인하고 실패 기준이 하나라도 재현되면 FAIL
