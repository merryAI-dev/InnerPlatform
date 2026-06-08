# 데이터 백업 및 사업별 스프레드시트 적재 정책

작성일: 2026-06-01

목표: frontend channelization, BFF write migration, Firestore rules 축소, Rust/domain engine 분리 작업 전에 운영 데이터를 복구 가능한 형태로 보존한다. 기본 백업은 Firestore native export와 JSON/JSONL 원본 백업이고, 사람이 검토/대조할 수 있는 운영 백업으로 스프레드시트 기반 snapshot을 병행한다. 운영 조직이 스프레드시트 기반으로 일하므로 snapshot은 사업별 1개 스프레드시트를 기본 단위로 한다.

## 원칙

- 백업 없는 write-path 변경은 배포하지 않는다.
- Firestore native export와 JSON/JSONL 원본 백업이 canonical backup이다.
- 스프레드시트 백업은 사람이 읽고 검토하기 위한 운영 검수본이다.
- 스프레드시트 백업은 원본 DB를 대체하지 않는다.
- 스프레드시트는 사람이 수정하거나 수식/서식/필터 때문에 부정확해질 수 있으므로 Firestore 복구 원본으로 쓰지 않는다.
- Firestore 부분 복구는 JSON/JSONL 원본 백업과 native export를 기준으로 한다.
- 민감정보는 최소화, 마스킹, 암호화, 접근통제로 보호한다.
- 백업 산출물은 tenant, timestamp, source commit, exporter version을 포함해야 한다.
- 정기 자동화 범위에는 복구 리허설을 포함하지 않는다.
- 백업 완료 기준은 artifact 생성, 업로드, manifest 기록, checksum/hash 대조, redaction 검사 통과로 둔다.

## 백업 계층

### Tier 1. Firestore Native Export 및 JSON 원본 백업

목적: 전체 복구와 부분 복구용 canonical backup.

대상:

- `orgs/{tenantId}/**`
- top-level `tenants`
- action/idempotency/outbox/work queue 관련 컬렉션
- audit chain 관련 컬렉션

정책:

- BFF write migration, Firestore rules 변경, bulk migration 전 반드시 생성한다.
- export 위치는 versioned bucket/path로 분리한다.
- export manifest에 Firebase project id, tenant id, createdAt, git commit, operator, reason을 기록한다.
- 사업별 JSON/JSONL 원본 백업을 같이 생성한다.
- JSON/JSONL은 Firestore 부분 복구, hash 대조, sheet 오염 검증의 기준 데이터다.
- 최소 30일 보관, major migration 전 백업은 180일 보관한다.

### Tier 2. 사업별 스프레드시트 Snapshot Export

목적: 사람이 검토 가능한 사업별 운영 원장 snapshot. rollback 판단, diff, PM/운영자 검수, 데이터 현황 공유에 사용한다.

형태:

- 사업별 스프레드시트 1개를 기본 단위로 한다.
- GCS canonical artifact 파일명은 복구 추적을 위해 `inner-platform-project-backup-{tenantId}-{projectId}-{yyyyMMdd-HHmmss}-{shortSha}.xlsx` 형식을 유지한다.
- Drive 검수본은 사업별 폴더에 쌓고, 파일명은 `[MYSCube]{사업이름}-{yyyy-MM-dd}` 형식으로 둔다.
- 첫 탭은 반드시 `백업_표지`로 둔다.
- 이후 사업 데이터 도메인별 탭을 둔다.
- 각 row는 원본 document 1개에 대응한다.
- 각 탭에는 사람이 다시 입력할 수 있도록 `입력액션`, `검수상태`, `입력메모` 컬럼을 앞에 둔다.
- 각 탭에는 추적용으로 `문서경로`, `문서ID`, `생성일`, `수정일`, `버전`, `삭제일`, `JSON해시`, `JSON참조` 컬럼을 포함하되 Drive 검수본에서는 숨김 처리한다.
- domain별 주요 필드는 한글 업무 명칭 컬럼으로 펼친다.
- Firestore 복구용 원본 JSON은 companion JSON/JSONL artifact와 `JSON_복구원본_목록` 탭에 보존한다.
- 조직/global 원장은 별도 관리자 원장 스프레드시트로 둔다.

사업별 기본 탭:

- `백업_표지`
- `사업_기본정보`
- `원장_목록`
- `거래_내역`
- `캐시플로_주차별`
- `주간제출_상태`
- `사업비_세트`
- `변경요청_내역`
- `사업비_입력시트`
- `사업비_입력시트_행`
- `사업비_인테이크`
- `증빙_원본`
- `증빙_매핑`
- `시트_원본`
- `시트_원본_미리보기행`
- `은행거래_대조`
- `은행거래_원본행`
- `예산_요약`
- `예산_요약_행`
- `예산_코드북`
- `예산_코드북_상세`
- `인건비_지급`
- `월마감_내역`
- `참여인력_스냅샷`
- `감사로그_색인`
- `JSON_복구원본_목록`

관리자/global 원장 스프레드시트:

- 파일명: `inner-platform-admin-ledger-backup-{tenantId}-{yyyyMMdd-HHmmss}-{shortSha}.xlsx`
- 포함 탭:
  - `백업_표지`
  - `조직_원장`
  - `멤버_원장`
  - `사업_색인`
  - `조직_설정`
  - `감사로그_색인`
  - `JSON_복구원본_목록`

JSON 동봉 정책:

- 각 사업 스프레드시트에는 `JSON_복구원본_목록` 탭을 둔다.
- `JSON_복구원본_목록` 탭은 collection별 JSONL companion artifact의 index 역할을 한다.
- JSON/JSONL의 목적은 시트가 부정확하거나 사람이 수정했을 때 Firestore 복구 기준을 확보하는 것이다.
- 시트 탭의 값은 검수/대조용이고, 복구 실행 시에는 JSON/JSONL record의 `jsonHash`와 원본 payload를 기준으로 한다.
- 새 JSONL record는 사람이 읽는 `data`와 Firestore 타입 보존용 `firestoreData`를 함께 가진다. 복구 CLI는 `firestoreData`가 있으면 이를 우선 사용해 Timestamp, DocumentReference, GeoPoint, bytes 타입을 복원한다.
- 큰 JSON은 spreadsheet cell limit과 검수 편의성을 고려해 별도 `.jsonl` 파일로 함께 저장한다.
- companion 파일명:
  - `inner-platform-project-backup-{tenantId}-{projectId}-{backupRunId}.jsonl`
  - `inner-platform-project-backup-{tenantId}-{projectId}-{backupRunId}.manifest.json`
- `JSON_복구원본_목록` 탭 필수 컬럼:
  - `컬렉션`
  - `문서경로`
  - `문서ID`
  - `JSON해시`
  - `JSON참조`
  - `마스킹모드`
  - `바이트크기`
  - `백업일시`
- 각 domain 탭의 `JSON참조`는 `JSON_복구원본_목록`의 row 또는 companion JSONL record를 가리킨다.
- 복구에 필요한 raw JSON은 native export 또는 암호화된 raw JSONL artifact를 기준으로 한다.

민감정보 정책:

- 스프레드시트 백업에는 원칙적으로 raw PII를 넣지 않는다.
- 재무성 데이터에는 `원장_목록`, `거래_내역`, `캐시플로_주차별`, `사업비_세트`, `사업비_입력시트`, `사업비_인테이크`, `증빙_원본`, `은행거래_대조`, `예산_요약`, `예산_코드북`, `인건비_지급`, `월마감_내역`을 포함한다.
- 재무성 데이터 원본 JSONL은 GCS canonical artifact에만 보관하고 Drive에는 검수용 XLSX만 둔다.
- 이메일, 전화번호, 계좌번호, 주민번호성 식별자, access token, refresh token, private URL은 마스킹한다.
- 시트에는 `JSON_마스킹본`과 `JSON해시`를 기본으로 두고, raw JSON은 암호화된 JSONL/native export에 둔다.
- `감사로그_색인`에는 action, actor role, entity, requestId, timestamp, hash만 남긴다. actor email 원문은 넣지 않는다.

사업별 탭 공통 검수 컬럼:

- `입력액션`
- `검수상태`
- `입력메모`
- `백업ID`
- `조직ID`
- `사업ID`
- `사업명`
- `컬렉션`
- `문서경로`
- `문서ID`
- `스키마버전`
- `버전`
- `생성일`
- `수정일`
- `삭제일`
- `해시`
- `JSON_마스킹본`
- `JSON해시`
- `JSON참조`

주요 탭별 권장 컬럼:

- `사업_기본정보`: `사업ID`, `사업명`, `상태`, `단계`, `회계유형`, `담당자UID`, `등록자UID`, `계약금액`, `시작일`, `종료일`
- `원장_목록`: `원장ID`, `사업ID`, `원장명`, `유형`, `상태`, `버전`
- `거래_내역`: `거래ID`, `원장ID`, `사업ID`, `처리상태`, `금액`, `거래일시`, `거래처`, `예산코드`, `캐시플로항목`, `증빙상태`
- `캐시플로_주차별`: `사업ID`, `년월`, `주차`, `구분`, `항목ID`, `금액`, `예상합계`, `실제합계`
- `주간제출_상태`: `사업ID`, `년월`, `주차`, `제출상태`, `제출일시`, `승인일시`
- `사업비_세트`: `세트ID`, `사업ID`, `상태`, `총액`, `제출자`, `제출일시`
- `변경요청_내역`: `요청ID`, `사업ID`, `유형`, `상태`, `요청자`, `승인자`, `생성일`
- `사업비_입력시트`: `시트ID`, `사업ID`, `시트명`, `행수`, `열수`, `활성여부`, `수정자`, `수정일`
- `사업비_입력시트_행`: `상위문서ID`, `행번호`, `행임시ID`, `원천거래ID`, `입력종류`, `셀_01...셀_N`
- `사업비_인테이크`: `인테이크ID`, `사업ID`, `은행지문`, `처리상태`, `대상시트ID`, `원천거래ID`, `거래일`, `거래처`, `금액`, `캐시플로항목`, `증빙상태`, `수정일`
- `증빙_원본`: `증빙ID`, `사업ID`, `거래ID`, `파일명`, `분류`, `상태`, `업로드자`, `업로드일`, `Drive파일ID`
- `증빙_매핑`: `사업ID`, `예산키`, `증빙분류`, `필수여부`, `완료여부`
- `시트_원본`: `사업ID`, `원본유형`, `시트명`, `적용대상`, `원본해시`, `업로드일시`
- `시트_원본_미리보기행`: `상위문서ID`, `행번호`, `셀_01...셀_N`
- `은행거래_대조`: `사업ID`, `기간`, `은행명`, `행수`, `매칭건수`, `미매칭건수`
- `은행거래_원본행`: `상위문서ID`, `행번호`, `행임시ID`, `셀_01...셀_N`
- `예산_요약`: `요약ID`, `사업ID`, `총예산`, `집행액`, `잔액`, `년월`, `수정일`
- `예산_요약_행`: `상위문서ID`, `행번호`, `예산코드`, `하위코드`, `최초예산`, `수정예산`
- `예산_코드북`: `코드ID`, `사업ID`, `예산코드`, `비목`, `세목`, `세세목`, `캐시플로항목`, `수정일`
- `예산_코드북_상세`: `상위문서ID`, `행번호`, `하위행번호`, `예산코드`, `하위코드`
- `인건비_지급`: `지급ID`, `사업ID`, `년월`, `상태`, `예정지급일`, `총액`
- `월마감_내역`: `마감ID`, `년월`, `상태`, `마감자`, `마감일시`
- `참여인력_스냅샷`: `UID`, `이름`, `이메일마스킹`, `역할`, `사업내역할`, `참여율`
- `감사로그_색인`: `액션`, `대상유형`, `대상ID`, `행위자역할`, `요청ID`, `일시`, `해시`

### Tier 3. Diff Snapshot

목적: 변경 전후 비교.

정책:

- migration 전 스프레드시트 snapshot과 migration 후 스프레드시트 snapshot을 비교한다.
- row count, hash, 중요 금액 합계, 상태별 count를 비교한다.
- 변경 의도에 포함되지 않은 컬렉션 변경은 배포 차단 사유로 본다.

## 백업 트리거

필수 백업:

- BFF write migration 시작 전
- Firestore rules에서 direct write를 축소하기 전
- tenant/member/project/payroll/transaction/cashflow 관련 migration 전
- Rust/domain engine 결과를 canonical write에 사용하기 전
- bulk delete, trash/restore, project migration commit 전
- production deploy 전 수동 승인 gate가 필요한 변경

권장 백업:

- 주 1회 정기 native export
- 일 1회 핵심 사업별 스프레드시트 snapshot
- active 사업은 변경 발생 시 사업별 스프레드시트 snapshot
- 주요 릴리스 브랜치 merge 전

## 백업 실행 순서

1. 배포 대상 commit과 Firebase project id를 확정한다.
2. Firestore native export를 생성한다.
3. active 사업별 스프레드시트 snapshot을 생성한다.
4. JSON/JSONL 원본 백업을 생성한다.
5. 백업 표지와 row count summary를 검증한다.
6. 스프레드시트 snapshot의 redaction 검사를 수행한다.
7. backup artifact 위치와 hash를 기록한다.
8. JSON/JSONL 원본과 스프레드시트 row의 hash를 대조한다.
9. 변경 작업을 시작한다.

## 구현 명령

사업별 스프레드시트와 Firestore 복구용 JSONL을 생성한다.

```bash
npm run firestore:backup:project-sheets -- --tenant mysc --reason "pre-channelization backup"
```

특정 사업만 백업할 때:

```bash
npm run firestore:backup:project-sheets -- --tenant mysc --project p-example-001
```

출력 구조:

- `output/backups/project-sheets/{백업ID}/inner-platform-project-backup-...xlsx`
- `output/backups/project-sheets/{백업ID}/inner-platform-project-backup-...jsonl`
- `output/backups/project-sheets/{백업ID}/inner-platform-project-backup-...manifest.json`
- `output/backups/project-sheets/{백업ID}/{백업ID}.run-manifest.json`

주의:

- 스프레드시트는 검수본이며 Firestore 복구 원본이 아니다.
- Firestore 부분 복구는 JSONL과 native export를 기준으로 한다.
- production 실행 전 서비스 계정, output 저장 위치, 접근 권한을 별도로 확인한다.

무개입 정기 백업은 Cloud Run Job과 Cloud Scheduler로 실행한다.

```bash
BACKUP_GCS_BUCKET="innerplatform-backups" \
BACKUP_SERVICE_ACCOUNT="innerplatform-backup@PROJECT_ID.iam.gserviceaccount.com" \
npm run firestore:backup:deploy-project-sheets
```

정기 백업 환경 변수:

- `BACKUP_TENANT_ID`: 기본값 `mysc`
- `BACKUP_GCS_BUCKET`: canonical JSONL/manifest/XLSX 보관 bucket
- `BACKUP_GCS_PREFIX`: 기본값 `inner-platform/firestore-project-sheets`
- `BACKUP_OUT_DIR`: Cloud Run Job 내부 임시 출력 경로. 기본값 `/tmp/innerplatform-project-sheet-backups`
- `BACKUP_DRIVE_FOLDER_ID`: 선택값. 운영 검수본 XLSX만 올릴 Google Drive 또는 Shared Drive folder id
- `BACKUP_DRIVE_REQUIRED`: 기본값 `false`. `true`일 때만 Drive 검수본 업로드 실패가 전체 백업 실패가 된다.
- `BACKUP_SERVICE_ACCOUNT`: Cloud Run Job 실행 및 Scheduler OAuth 호출 서비스계정
- `BACKUP_SCHEDULE`: 기본값 `0 3 * * 1`, 매주 월요일 03:00
- `BACKUP_TIME_ZONE`: 기본값 `Asia/Seoul`
- `BACKUP_SLACK_SECRET_NAME`: Slack webhook을 Secret Manager에 저장한 경우 secret 이름

서비스계정 권한:

- Firestore read 권한
- 대상 GCS bucket write 권한
- Cloud Run Job 실행 권한
- Cloud Scheduler OAuth 호출 권한
- Drive 검수본을 켠 경우 Google Drive API 사용 권한
- Drive 검수본을 켠 경우 대상 Shared Drive 폴더의 Contributor 또는 Content manager 권한

운영 원칙:

- GCS가 canonical artifact 위치다.
- Drive/Sheets는 사람이 보는 검수본 위치이며 raw JSONL과 manifest를 올리지 않는다.
- 정기 백업은 Drive 권한 문제 때문에 실패하면 안 된다. Drive 업로드는 기본적으로 best-effort다.
- 개인 OAuth 또는 Codex 커넥터 권한에 의존하지 않는다.
- Cloud Run 서비스계정이 Shared Drive 폴더를 직접 볼 수 없으면 `File not found`가 발생한다. 이 경우 canonical GCS 백업을 유지하고, Workspace 관리자에게 서비스계정의 Shared Drive 멤버 추가 가능 여부를 확인한다.
- 조직 정책상 `gserviceaccount.com` 주체를 Shared Drive 멤버로 둘 수 없다면, 별도 Workspace 백업 사용자와 Domain-wide delegation 또는 사용자 승인형 검수본 업로드 플로우로 분리한다.
- JSON/JSONL은 복구 원본이고, 스프레드시트는 복구 원본이 아니다.

## JSONL 부분 복구 CLI

사업별 JSONL/manifest 백업을 기준으로 Firestore 문서를 부분 복구한다. 기본 실행은 항상 dry-run이며, 실제 쓰기는 명시적인 확인 플래그가 있어야 한다.

GCS 백업 run을 dry-run으로 검증:

```bash
npm run firestore:restore:project-sheets -- \
  --backup-gcs-uri "gs://inner-platform-live-20260316-innerplatform-backups/inner-platform/firestore-project-sheets/backup_mysc_20260601T105613Z_unknown" \
  --target-project "inner-platform-live-20260316" \
  --target-database "restore-rehearsal-20260601" \
  --tenant mysc
```

stage/QA 프로젝트에 live 백업을 리허설할 때는 원본 tenant 경로를 그대로 쓰지 않는다. `--target-tenant`를 지정해 `orgs/mysc/...`를 `orgs/mysc-restore-YYYYMMDD/...` 같은 별도 namespace로 복원한다.

```bash
npm run firestore:restore:project-sheets -- \
  --backup-gcs-uri "gs://inner-platform-live-20260316-innerplatform-backups/inner-platform/firestore-project-sheets/backup_mysc_20260601T115737Z_unknown" \
  --target-project "inner-platform-qa-20260310" \
  --target-database "(default)" \
  --tenant mysc \
  --target-tenant "mysc-restore-20260601" \
  --project p-example-001
```

특정 사업만 rehearsal database에 실제 복구:

```bash
npm run firestore:restore:project-sheets -- \
  --backup-gcs-uri "gs://inner-platform-live-20260316-innerplatform-backups/inner-platform/firestore-project-sheets/backup_mysc_20260601T105613Z_unknown" \
  --target-project "inner-platform-live-20260316" \
  --target-database "restore-rehearsal-20260601" \
  --tenant mysc \
  --project p-example-001 \
  --apply \
  --confirm-backup-run-id "backup_mysc_20260601T105613Z_unknown" \
  --confirm-target-project "inner-platform-live-20260316"
```

운영 `(default)` database에 쓰는 경우는 추가로 `--allow-production-database`가 필요하다. 운영 복구는 반드시 dry-run report, 승인자, 대상 문서 범위, 복구 후 hash 검증 결과를 남긴 뒤 실행한다.
stage/QA 프로젝트의 `(default)` database에 리허설 복원할 때는 `--allow-default-database`를 사용한다.

기본 복구 정책은 엄격 분리다. `--apply`는 기본적으로 target에 존재하지 않는 문서만 `create`한다. 대상 문서가 이미 존재하면 값이 같아도 중단한다. 이 정책은 기존 운영 데이터와 백업 데이터가 섞이거나 덮어써지는 사고를 막기 위한 것이다.

복구 CLI 안전장치:

- manifest의 `jsonlSha256`과 실제 JSONL hash가 다르면 중단한다.
- 각 record의 `JSON해시`와 `data`를 다시 계산해 다르면 중단한다.
- record에 `firestoreData`가 있으면 실제 write payload로 우선 사용한다. 없으면 구버전 백업 호환을 위해 `data`를 사용한다.
- `orgs/{tenantId}/...` 또는 `tenants/...` 외 문서 경로는 거부한다.
- `--target-tenant`가 있으면 복원 write 경로, tenant 필드, 내부 Firestore reference path를 target tenant 기준으로 재작성한다. 원본 JSONL 검증은 source tenant 기준으로 먼저 수행한다.
- `--apply`는 `--confirm-backup-run-id`, `--confirm-target-project`가 모두 일치해야 한다.
- 필터 없는 전체 복구는 `--restore-all`이 있어야 한다.
- `(default)` database 쓰기는 `--allow-default-database` 또는 `--allow-production-database`가 있어야 한다.
- 기본 `--apply`는 create-only다. `skip-identical` 또는 `overwrite` 계획이 하나라도 있으면 중단한다.
- 이미 같은 문서가 있는 rehearsal database를 이어서 검증해야 할 때만 `--allow-existing-target-data`를 사용한다. 이 플래그는 overwrite를 허용하지 않는다.
- 기존 문서를 덮어쓰는 `--allow-overwrite`는 incident 승인과 dry-run report 검토 없이는 사용하지 않는다.
- 복구 후에는 target document hash를 다시 계산해 report에 남긴다.

## 스프레드시트 백업 표지

`백업_표지` 탭 필수 필드:

- `백업ID`
- `백업일시`
- `백업실행자`
- `백업사유`
- `Firebase프로젝트ID`
- `조직ID`
- `사업ID`
- `사업명`
- `Git커밋`
- `브랜치`
- `Exporter버전`
- `NativeExport경로`
- `스프레드시트경로`
- `JSONL경로`
- `JSONManifest경로`
- `컬렉션수`
- `문서수`
- `마스킹모드`
- `복구검증상태`

컬렉션별 summary 필드:

- `컬렉션`
- `문서수`
- `활성문서수`
- `삭제문서수`
- `금액합계`
- `상태별건수`
- `최초수정일`
- `최종수정일`
- `해시집계`

## 복구 정책

Native restore:

- 전체 복구 또는 대량 복구는 Firestore native export를 기준으로 한다.
- production restore는 별도 승인과 restore dry-run이 필요하다.

JSON-assisted restore:

- JSON/JSONL 백업은 Firestore 부분 복구의 기준 데이터로 사용한다.
- 스프레드시트는 부분 복구 대상을 식별하고 사람이 검토하는 데 사용한다.
- 스프레드시트의 `JSON_마스킹본`만으로 복구하지 않는다.
- raw 값이 필요한 복구는 native export 또는 암호화된 raw JSONL artifact에서 가져온다.
- 수동 복구 시 반드시 복구계획 스프레드시트를 별도로 만든다.

복구계획 스프레드시트 필드:

- `대상문서경로`
- `복구액션`
- `원본백업ID`
- `원본해시`
- `현재해시`
- `복구후예상해시`
- `승인자`
- `실행일시`
- `결과`

## 접근 통제

- native export bucket은 운영 관리자와 제한된 서버 계정만 접근한다.
- 스프레드시트 snapshot은 운영 검수자에게만 공유한다.
- JSON/JSONL 원본 백업은 Firestore 복구 권한자와 제한된 서버 계정만 접근한다.
- 외부 공유는 금지한다.
- 스프레드시트 백업 링크는 public 또는 anyone-with-link로 설정하지 않는다.
- 백업 다운로드/공유 이력은 별도로 기록한다.

## 보관 기간

- daily 사업별 스프레드시트 snapshot: 14일
- weekly 사업별 스프레드시트 snapshot: 8주
- pre-migration 사업별 스프레드시트 snapshot: 180일
- daily JSON/JSONL 원본 백업: 30일
- pre-migration JSON/JSONL 원본 백업: 180일
- native export daily: 30일
- pre-migration native export: 180일
- incident backup: 사후 리뷰 종료 후 별도 결정

## 검증 체크리스트

- `백업_표지` 탭이 존재한다.
- 모든 탭에 `백업ID`, `조직ID`, `사업ID`, `문서경로`, `해시`가 있다.
- row count가 Firestore query count와 일치한다.
- PII redaction 검사를 통과한다.
- 사업별 스프레드시트에 `사업_기본정보`, `거래_내역`, `캐시플로_주차별`, `사업비_입력시트`, `사업비_인테이크`, `증빙_원본`, `은행거래_대조`, `예산_요약`, `예산_코드북`, `인건비_지급`, `JSON_복구원본_목록` 탭이 누락되지 않았다.
- 관리자/global 스프레드시트에 `조직_원장`, `멤버_원장`, `사업_색인`, `JSON_복구원본_목록` 탭이 누락되지 않았다.
- native export path가 백업 표지에 기록되어 있다.
- companion JSONL path와 manifest JSON path가 기록되어 있다.
- sample document 5개 이상이 native export, JSONL, 스프레드시트 snapshot에서 hash 대조된다.
- run manifest에 GCS/Drive 업로드 위치와 size가 기록되어 있다.

## Frontend Channelization 선행 Gate

아래 작업은 이 백업 정책의 최소 백업이 완료되기 전 production에 배포하지 않는다.

- 멤버/테넌트 원장 write BFF 이동
- Firestore direct write 축소
- Firestore rules catchall 축소
- irreversible action BFF 이동
- Rust/domain engine 결과를 canonical write에 사용

최소 백업 기준:

- production Firestore native export 완료
- active 사업별 스프레드시트 snapshot 완료
- 관리자/global 원장 스프레드시트 snapshot 완료
- 백업 표지 검증 완료
- companion JSONL 검증 완료
- redaction 검증 완료
- JSON/JSONL 기반 hash/diff 검증 완료
