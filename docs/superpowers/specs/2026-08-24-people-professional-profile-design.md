# People 전문 프로필·참여율 필터 설계

## 배경

참여율 관리 표에는 사람별 `최종학력`, `영어 증빙`, `자격증` 열과 필터가 필요하다. 값은 People에서 입력하고, 참여율 대시보드는 같은 사실을 서버에서 조회·필터링해야 한다. 프런트엔드는 프로필 원장, 집계기 또는 필터 엔진이 되어서는 안 된다.

향후 RAG가 사람의 전문성을 검색할 수 있어야 하지만 운영 원장에 검색 문장이나 embedding을 섞지는 않는다. 이번 변경은 검색 가능한 구조화 사실, 출처, revision까지만 만든다.

## 목표

- `personId` 기반 People 문서를 전문 프로필의 단일 원장으로 사용한다.
- People 입력과 참여율 조회가 동일한 구조화 사실을 사용한다.
- `persons` Firestore 원장을 BFF-only로 잠그고 권한·스키마·감사를 우회하지 못하게 한다.
- 프로필 권한을 policy-as-code의 명시적 permission으로 관리한다.
- 프로필 표시 라벨, 필터링, 옵션 목록, 옵션별 인원 수를 BFF가 계산한다.
- 기존 People 문서는 migration 없이 `미입력`으로 읽는다.
- 향후 RAG 인덱서가 안정적인 코드·출처·revision을 읽을 수 있게 한다.

## 비목표

- `careerProfiles/{uid}`와 자동 동기화하거나 이름·이메일로 사람을 추론하지 않는다.
- 이번 변경에서 vector, embedding, 검색용 문장 또는 RAG 인덱스를 생성하지 않는다.
- 프로필 필터를 저장된 참여율 View 규칙에 포함하지 않는다.
- 공인영어 점수 구간 필터를 만들지 않는다. 첫 버전은 증빙 유형으로 필터링한다.
- 자격증 발급기관·유효기간을 참여율 API에 노출하지 않는다.

## 검토한 접근

### 선택: BFF-only People 원장과 전문 프로필 하위 리소스

`orgs/{tenantId}/persons/{personId}.professionalProfile`을 원장으로 사용한다. People 전문 프로필 API와 참여율 read-model은 이 필드를 각자의 allowlist DTO로 투영한다. 별도 동기화 작업과 별도 프로필 컬렉션이 필요 없고 기존 `personId` 조인 계약을 유지한다.

현재 저장소의 프런트엔드는 People을 모두 BFF로 읽고 쓰지만 Firestore catchall rules는 `persons` 직접 접근을 허용한다. `persons`를 BFF-only collection으로 등록하고 명시적으로 `allow read, write: if false`를 적용한다. 이 rules 변경이 없으면 아래의 BFF 권한과 응답 allowlist는 보안 경계로 인정하지 않는다.

### 제외: Career Profile 조인

기존 Career Profile은 `uid` 키이며 People에는 `uid`가 없는 외부·과거 인력이 존재한다. 영어 증빙 필드도 없으므로 참여율 조회에서 사용하면 누락과 오연결 가능성이 생긴다.

### 제외: 별도 전문 프로필 컬렉션

현재 프런트가 People 원장을 직접 읽지 않으므로 `persons` 전체를 BFF-only로 전환할 수 있다. 별도 컬렉션은 추가 조회, 사람 삭제 시 고아 문서, 생명주기와 transaction 복잡도만 늘어난다.

## 정책 카탈로그

코드, 한국어 라벨, 정렬 순서, 입력 제약의 단일 진실은 `policies/professional-profile-catalog.json`으로 둔다. 카탈로그에는 단조 증가하는 `catalogVersion`을 포함한다. BFF는 시작 시 카탈로그를 검증하고 다음에 공동 사용한다.

- People 입력용 catalog API
- 명령 payload 검증·정규화
- 참여율 표시 라벨과 filter facet
- 향후 RAG 문서의 code-to-text 변환

프런트엔드에 학력·시험 라벨 또는 점수 체계를 하드코딩하지 않는다.

첫 카탈로그의 학력 attainment code는 다음과 같다.

- `HIGH_SCHOOL_GRADUATED`
- `ASSOCIATE_GRADUATED`
- `BACHELOR_ENROLLED`, `BACHELOR_GRADUATED`
- `MASTER_ENROLLED`, `MASTER_COMPLETED`, `MASTER_GRADUATED`
- `DOCTOR_ENROLLED`, `DOCTOR_COMPLETED`, `DOCTOR_GRADUATED`
- `OTHER`

카탈로그는 각 code의 `label`과 최고학력 선정을 위한 `rank`를 가진다. 독립적인 level/status 조합은 저장하지 않으므로 유효하지 않은 조합이 생기지 않는다.

영어 시험은 시험명과 점수 체계를 분리한다. 예를 들어 `TOEFL`은 `TOEFL_IBT_120`, `TOEFL_IBT_6`, `TOEFL_PBT_677` 같은 scale code를 가질 수 있다. 카탈로그의 각 scale은 결과 형식, 범위, 단위 또는 허용 등급을 정의한다. 첫 facet code는 다음과 같다.

- `TOEIC`
- `TOEFL`
- `OPIC`
- `IELTS`
- `TEPS`
- `OVERSEAS_EDUCATION`
- `OTHER`
- `__MISSING__`

`__MISSING__`은 API filter token이며 DB에는 저장하지 않는다.

## 데이터 모델

```ts
type ProfessionalProfile = {
  schemaVersion: 1;
  educationRecords: Array<{
    attainmentCode: string;       // catalog code
    institutionName: string | null;
    countryCode: string | null;   // ISO 3166-1 alpha-2
    major: string | null;
  }>;
  englishEvidence: Array<{
    testCode: string;             // TOEIC, TOEFL, OPIC, IELTS, TEPS, OTHER
    scaleCode: string;            // catalog가 정의한 점수·등급 체계
    resultValue: string;          // catalog가 수치·등급·텍스트 규칙으로 검증
    otherTestName: string | null; // OTHER일 때 필수, 표준 시험은 null
    testedAt: string | null;      // YYYY-MM
  }>;
  certifications: Array<{
    key: string;                  // BFF가 label을 정규화해 만든 비교 키
    label: string;                // 사용자가 확인한 원문 표기
  }>;
  provenance: {
    source: 'PEOPLE_MANUAL';
    revision: number;
    updatedAt: string;
    updatedBy: string;
  };
};
```

입력 DTO의 공백 문자열은 저장 전에 `null`로 정규화한다. 기존 문서에서 `professionalProfile`이 없으면 읽기 시 빈 세 배열과 revision `0`으로 정규화한다. 하위 객체는 전체 교체하며 배열 merge를 하지 않는다. 자격증은 대소문자를 무시해 중복 제거하되 최초 입력 표기를 보존한다.

BFF는 카탈로그 rank가 가장 높은 학력 레코드 하나를 `최종학력`으로 파생한다. rank가 같으면 졸업·수료·재학 순서가 이미 attainment rank에 반영되어 있으며, 같은 attainment가 여러 개면 입력 순서가 빠른 레코드를 사용한다.

참여율의 `최종학력` 표시, education filter, education option count는 모두 이 파생된 최고학력 한 건의 attainment code만 사용한다. 전체 학력 이력 검색은 향후 별도 filter로 정의한다.

영어 facet은 시험 증빙과 학력 이력에서 함께 파생한다. `educationRecords` 중 `countryCode`가 존재하고 `KR`이 아닌 레코드가 하나라도 있으면 `OVERSEAS_EDUCATION`을 포함한다. 시험과 해외 학력 facet이 모두 없을 때만 `__MISSING__`이다.

## 데이터 라벨

| 영역 | 화면 라벨 | 서버 표시 예시 |
|---|---|---|
| 열·입력 | 최종학력 | `석사 · University of Sussex` |
| 열·입력 | 영어 증빙 | `TOEIC 920 · 해외 대학` |
| 열·입력 | 자격증 | `PMP · ODA 전문가` |
| 공통 상태 | 미입력 | `—` 및 접근성 이름 `미입력` |

최종학력 필터는 attainment catalog label을 사용한다. 영어 필터는 `미입력`, `TOEIC`, `TOEFL`, `해외 대학`, `OPIc`, `IELTS`, `TEPS`, `기타`를 사용한다. 자격증 필터는 저장된 정규화 tag를 사용한다.

## 권한과 Firestore 경계

`policies/rbac-policy.json`에 다음 permission을 추가한다.

- `person:professional_profile:read`
- `person:professional_profile:write`

첫 배포에서는 현재 4-role 정책을 유지해 `admin`, `finance`에 두 permission을 부여한다. 과거 `tenant_admin`은 저장소의 역할 간소화 정책에서 `admin`으로 흡수되는 legacy role이므로 이번 기능 때문에 정식 role로 되살리지 않는다. 새로운 hard-coded role 배열을 만들지 않는다. 프로필 route와 참여율 route는 주입된 RBAC policy와 `assertActorPermissionAllowed`을 사용한다.

Firestore rules의 BFF-only collection 목록에 `persons`를 추가하고 직접 client read/write를 모든 역할에서 거부한다. 현재 저장소의 People 소비 경로가 `/api/v1/persons`만 사용하는지 contract test로 고정한다. BFF Admin SDK와 운영 스크립트는 rules의 영향을 받지 않는다.

참여율 API에는 최종학력 표시, 영어 증빙 표시, 자격증 명칭만 포함한다. 이메일, 전화번호, 생년월일, note, uid, 전체 학력 이력, 시험일, 자격증 발급기관은 포함하지 않는다. 권한이 없으면 profile summary와 profile filter option 자체를 응답에서 제외한다.

## API 경계

모든 프로필 응답에는 `Cache-Control: private, no-store`를 적용한다. Firestore 문서를 spread해서 반환하지 않고 명시적인 serializer만 사용한다.

### 카탈로그

`GET /api/v1/person-professional-profile/catalog`

- `person:professional_profile:read` permission을 요구한다.
- People 입력에 필요한 code, label, result field 정의만 반환한다.
- 사람 데이터와 option count는 포함하지 않는다.

### People 기본 목록

`GET /api/v1/persons`

- 기존 기본정보 DTO만 반환한다.
- 전문 프로필을 포함하지 않으며 앱 전역 People store가 학교·점수·자격증을 보관하지 않게 한다.
- 응답 최상위에 `capabilities.professionalProfileRead`와 `capabilities.professionalProfileWrite`를 포함한다. 프런트는 역할명을 해석하지 않고 이 capability만 사용해 프로필 영역과 편집 가능 상태를 결정한다.

### 전문 프로필 조회

`GET /api/v1/persons/:personId/professional-profile`

- `person:professional_profile:read` permission과 tenant 경계를 확인한다.
- People 상세 편집 시 한 사람의 구조화된 프로필과 revision만 반환한다.

### 전문 프로필 저장

`PUT /api/v1/persons/:personId/professional-profile`

```ts
{
  expectedRevision: number;
  profile: {
    educationRecords: Array<...>;
    englishEvidence: Array<...>;
    certifications: Array<{ label: string }>;
  };
}
```

- `person:professional_profile:write` permission과 `Idempotency-Key`를 요구한다.
- 서버가 schemaVersion, certification key, provenance를 만든다.
- 저장된 revision과 `expectedRevision`이 다르고 정규화 내용도 다르면 `409 professional_profile_revision_conflict`를 반환한다.
- 정규화 내용이 이미 같으면 stale revision이어도 no-op 성공한다.
- 기존 프로필 없음은 revision `0`, 최초 변경은 `1`이다.
- 동일 내용 저장은 revision, updatedAt, updatedBy, audit을 변경하지 않는다.
- 실제 변경은 People 문서 갱신과 `PROFILE_UPDATE` audit을 하나의 Firestore transaction으로 commit한다.
- audit에는 변경된 섹션명, previousRevision, nextRevision만 기록한다. 학교·점수·등급·자격증 원문은 기록하지 않는다.
- People 신규 등록 폼이 프로필을 함께 보내면 기존 `personWrite`와 `person:professional_profile:write` permission을 모두 요구한다. 하나라도 없으면 person 생성 전 전체 요청을 `403`으로 거부한다. 저장 시 동일한 schema·normalizer와 transaction audit을 사용한다.
- 성공 응답은 항상 서버 정규화 결과를 담은 `profile`, 현재 `revision`, `changed`를 반환한다. 실제 변경은 `changed: true`, 동일 내용과 stale-but-same no-op은 `changed: false`이다. `409`는 `currentRevision`만 반환하고 최신 프로필은 별도 GET으로 다시 읽는다.

### 참여율 조회

`GET /api/v1/participation-dashboard`

기존 `year`, `ruleId`에 다음 query를 추가한다.

- `education`: attainment code 하나 또는 `__MISSING__`
- `englishEvidence`: facet code 하나 또는 `__MISSING__`
- `certification`: 반복 가능한 certification key 또는 단독 `__MISSING__`

학력·영어·자격증 차원 사이는 AND, 반복 자격증은 OR이다. `__MISSING__`과 같은 차원의 실제 값은 함께 보낼 수 없다. BFF가 내려준 option의 `value`를 프런트가 변환 없이 query에 다시 사용한다.

프로필 permission이 없는 호출자가 프로필 query를 보내면 `403 profile_filter_forbidden`을 반환한다. 권한 없는 정상 조회는 기존 참여율 값만 반환하며 `professionalProfileAccess: false`를 명시한다. 구버전 응답처럼 이 필드가 없을 때도 프런트는 fail-closed로 권한 없음으로 취급한다.

권한 있는 응답에는 다음을 추가한다.

```ts
{
  professionalProfileAccess: true,
  selectedProfileFilters: {
    education: string | null,
    englishEvidence: string | null,
    certifications: string[]
  },
  profileFilterOptions: {
    education: Array<{ value: string; label: string; memberCount: number }>,
    englishEvidence: Array<{ value: string; label: string; memberCount: number }>,
    certifications: Array<{ value: string; label: string; memberCount: number }>
  },
  members: Array<{
    // 기존 참여율 필드
    profileSummary: {
      highestEducationDisplayText: string;
      englishEvidenceDisplayText: string;
      certificationsDisplayText: string;
    }
  }>
}
```

base member set은 선택한 View에서 선택 연도에 소유한 달이 하나 이상인 사람이다. 옵션과 인원 수는 이 집합에 프로필 필터를 적용하기 전에 계산한다. 표준 학력·영어 option은 0명이어도 반환한다. 자격증 option은 관측값을 반환하되 현재 선택값이 View 전환 후 0명이 되면 선택값과 0명을 유지한다. 프로필 필터 적용 후에만 `members`를 줄이며 참여율 값과 프로젝트 breakdown은 재계산하지 않는다.

## 서버 책임과 프런트 책임

BFF는 프로필 정규화, 권한, 최종학력 선정, 해외 학력 facet, 표시 문자열, 필터링, option 목록, 인원 수를 소유한다. 참여율 집계와 프로필 필터를 같은 read-model 단계에서 적용하되 추가 Firestore read나 N+1 query를 만들지 않는다.

프런트엔드는 다음만 수행한다.

- People 입력 폼의 현재 draft와 expectedRevision 관리
- 선택된 View·연도·프로필 option value를 URL 및 요청에 전달
- BFF가 반환한 표시 문자열, option, 사람 목록을 그대로 렌더링
- 짧은 debounce, 이전 요청 취소, 최신 요청만 표시

프런트는 전문 프로필을 앱 전역 store에 넣지 않는다. People 상세 dialog를 닫으면 한 사람의 profile draft를 버린다. 참여율 화면에서 People 목록을 복제해 필터하거나 참여율·option count를 `filter`/`reduce`로 다시 계산하지 않는다.

## UI

People 등록·상세 화면에 `전문 프로필` 영역을 추가한다.

- 학력: 복수 행의 학력 구분, 학교, 국가, 전공
- 영어 증빙: 복수 행의 시험, 점수 체계, 결과, 시험월
- 자격증: 태그 입력

참여율 표는 `사람 | 참여 사업 | 최종학력 | 영어 증빙 | 자격증 | 1월…12월` 순서를 유지한다. `professionalProfileAccess === true`인데 특정 member summary가 없거나 빈 값이면 `—`와 접근성 이름 `미입력`을 표시한다. `professionalProfileAccess !== true`이면 세 열과 프로필 필터를 숨기며 `미입력`으로 위장하지 않는다. 프로젝트 상세행의 프로필 칸은 사람 정보를 반복하지 않도록 비운다.

상단에는 View·연도 다음에 최종학력·영어 증빙·자격증 필터를 둔다. 변경할 때마다 서버 조회를 실행하며 이전 결과를 새 조건의 결과처럼 남기지 않는다. 활성 조건, 서버가 반환한 결과 인원, 조건 초기화를 표시한다. 결과가 0명이면 명확한 빈 상태와 초기화 동작을 제공한다.

## RAG 준비 경계

운영 원장은 code 기반 사실과 provenance만 저장한다. 검색용 문장과 embedding은 향후 별도 파생 저장소에서 다음 식별자를 사용한다.

- `tenantId`
- `personId`
- `professionalProfile.schemaVersion`
- `professionalProfile.provenance.revision`
- `professional-profile-catalog.catalogVersion`

인덱서는 동일한 profile catalog로 code를 문장화하고 profile revision 또는 catalogVersion이 바뀌면 해당 사람의 파생 문서를 교체한다. 카탈로그 변경은 기본적으로 기존 code 의미를 바꾸지 않는 additive change로 한다. 기존 code의 라벨·rank·해석을 바꿔야 할 때는 catalogVersion을 증가시키고 전체 파생 문서를 재색인한다. 사람 삭제 또는 접근권한 변경 시 파생 문서도 제거할 수 있도록 personId를 stable key로 사용한다. 검색 파생 데이터는 People API에 역방향으로 기록하지 않는다.

## 오류·동시성 처리

- 잘못된 catalog code, 결과 형식, 날짜, 개수·길이 초과는 `400`이며 Firestore를 변경하지 않는다.
- 권한 부족은 `403`이며 값 존재 여부도 노출하지 않는다.
- 없는 사람은 `404`이다.
- revision 충돌은 `409`이며 People dialog를 유지하고 최신 값 재조회 동작을 제공한다.
- audit transaction 실패 시 profile write도 rollback한다.
- People 저장 실패 시 입력을 유지하고 재시도 가능한 오류를 보여준다.
- 대시보드 조회 실패 시 이전 결과를 지우고 기존 오류 상태를 사용한다.
- `professionalProfileAccess === true`인데 특정 member의 `profileSummary`만 없으면 세 칸을 `—`로 렌더링한다. access 필드가 없거나 false이면 열과 필터를 숨긴다.

## 용량과 제한

- 학력 이력 최대 10개
- 영어 증빙 최대 10개
- 자격증 최대 20개
- 학교·전공·기타 시험명·자격증 이름은 각 최대 80자
- profile query의 반복 certification은 최대 20개, key는 최대 80자
- profile filter 변경은 짧게 debounce하고 진행 중인 이전 요청을 취소한다.

## 검증 계약

1. 카탈로그·도메인 단위 테스트
   - catalog 자체 정합성, label, rank, 시험 scale/result 검증
   - catalogVersion과 profile revision의 RAG fingerprint
   - 정규화, null 저장, 자격증 중복 제거
   - 최고학력 선정과 어느 학력이든 해외이면 해외 대학 facet
   - education filter는 전체 이력이 아니라 파생 최고학력만 사용
   - OTHER 시험명 필수와 표준 시험의 otherTestName 거부
   - 시험 facet과 해외학력 facet이 모두 없을 때만 영어 미입력
   - option count는 profile filter 이전 base member set 기준
2. People BFF 테스트
   - catalog 및 한 사람 profile GET
   - 신규 등록과 전문 프로필 PUT의 저장·재조회
   - idempotency replay와 동일 내용 PUT은 profile·revision·audit 모두 불변
   - 실제 내용 변경만 revision 1 증가
   - stale expectedRevision 충돌과 동일 내용 stale no-op
   - permission별 허용·차단과 tenant 격리
   - admin·finance 허용, pm·viewer 차단 및 legacy role을 재도입하지 않는 계약
   - profile을 포함한 person 생성은 기본 create·profile write permission을 모두 요구
   - People 목록 capability와 프로필 미포함 계약
   - 잘못된 입력과 audit 실패의 원자적 no-write
   - audit에 프로필 원문 값이 없음
3. Firestore rules 테스트
   - admin, finance, pm, viewer의 persons client direct read/write 모두 거부
   - repo frontend가 People을 BFF로만 접근
4. 참여율 단위·통합 테스트
   - 실제 persons 문서의 프로필을 partEntries와 personId로 join
   - 선택 연도에 소유한 달이 없는 사람 제외
   - View·연도·프로필 조건의 서버 필터 결과
   - 반복 자격증 OR, 차원 간 AND, `__MISSING__`, 0명 option
   - 권한 없는 응답 전체에 학교·점수·자격증 원문이 없음
   - professionalProfileAccess가 없거나 false인 응답은 열·필터를 숨기고 true+summary 없음만 미입력 처리
   - 연결 대기 수, 월별 합계, 프로젝트 breakdown 불변
   - GET 전후 Firestore 전체 snapshot 동일
   - collection read 수 고정 및 N+1 없음
5. 브라우저 테스트
   - People 생성·조회·수정·충돌·오류·재시도
   - 전체 View와 저장 View에서 서버 필터 및 0명 option
   - 프런트 profile 계산·전역 보관·추가 client DB 조회 없음
   - stale 요청 차단, 빈 상태, 키보드, 375px 수평 스크롤
   - 프로젝트 펼침 행 17개 셀과 프로필 빈 셀 정렬

## 배포

외부 API, 새 secret, Firestore index 또는 데이터 migration은 없다. `persons`를 BFF-only로 만드는 Firestore rules를 앱 코드보다 먼저 배포한다. 배포 전에 현재 repo의 People frontend 경로가 모두 BFF를 사용하는 contract와 emulator test가 초록이어야 한다.

그 다음 PR의 CI 성공으로 `main` 자동 Production Deploy를 사용하며 수동 production deploy는 하지 않는다. 배포 후 다음을 canary로 확인한다.

- Firestore client direct persons read/write 거부
- People profile catalog/GET/PUT과 no-store header
- People 수정 직후 참여율 server-side filter 반영
- 권한 있는 응답의 allowlist와 권한 없는 응답의 profile 미노출
- 동일 PUT replay와 revision conflict
