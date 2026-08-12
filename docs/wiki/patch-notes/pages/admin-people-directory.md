# Admin People Directory

- route: `/people`
- primary users: 재경팀, 인사 담당, 관리자
- status: active
- last updated: 2026-08-12

## Purpose

재직자·인턴·파트너를 한 곳에서 관리하는 인력 명부다. 참여율 판정과 정산 서류가 이 명부를 근거로 삼는다.

명부의 원본은 재직자 현황 시트이고, 그것을 읽은 `orgs/{org}/persons` 가 런타임 근거다.
이전에는 프론트 코드에 87명 배열이 박혀 있어 신규 입사자가 배포 전까지 목록에 없었고 퇴사자는 영원히 남았다.

## Current UX Summary

- 목록에서 근로형태·재직상태·소속·직급·입사일·근속을 본다. 근속은 입사일과 오늘 기준으로 매번 다시 계산한다.
- 정규직 / 인턴 / 파트너 / 미채용 / 계약 종료로 필터한다.
- 행을 열면 계약 이력 전체가 보이고, 거기서 계약을 변경하거나 추가한다.
- 사업에 배정됐지만 명부에 없는 인력을 상단 경고에 띄우고, 거기서 바로 등록할 수 있다.
- 시트에 없는 파트너·외부 인력과 아직 채용되지 않은 자리를 직접 등록한다.

## Data Model

저장되는 진실은 `employments` 배열 하나다. 근로형태·재직상태·퇴사일·근속은 전부 읽을 때 파생시킨다.
파생값을 문서에 같이 저장하면 둘이 조용히 갈라지고, 그때 어느 쪽이 맞는지 알 수 없다.

- 근로형태: `FULL_TIME` / `INTERN` / `PARTNER` / `PLACEHOLDER`
- 재직상태: `WORKING` / `ON_LEAVE` / `PARENTAL_LEAVE`
- 계약이 끝났는지는 `endDate` 가 말한다. 상태값에 "종료"를 두지 않는다.

근로형태와 재직상태는 다른 축이다. 파트너도 휴직하고, 정규직도 퇴사한다. 한 필드로 합치면 표현할 수 없는 조합이 생긴다.

## Current Feature Checklist

- [x] 재직자·인턴·파트너를 한 목록에서 확인 가능
- [x] 계약 변경(적용일 직전에 기존 계약을 닫고 잇기) 가능
- [x] 계약 추가(겹치지 않는 별도 구간 끼우기) 가능
- [x] 시트에 없는 인력(파트너·미채용 자리) 등록 가능
- [x] 사업에 배정됐지만 명부에 없는 인력 발견 및 등록 가능
- [x] 계약 이력을 지우지 않고 쌓음 — 지난 기간 참여율의 근거가 남는다
- [ ] 프로젝트 팀원 드롭다운은 아직 계정 원장(members)을 본다. 안정화 후 연결한다.
- [ ] 시트 재동기화(퇴사일 반영) 경로는 아직 수동이다.

## Known Notes

- 계약 변경은 기존 계약을 삭제하지 않는다. 삭제하면 그 기간의 참여율이 왜 그 기준이었는지 설명할 근거가 사라진다.
- 명부를 못 불러와도 화면은 뜬다. 빈 디렉터리면 이름 기반 대체 키로 떨어질 뿐 참여율 화면이 막히지 않는다.
- 쓰기 권한은 `personWrite`(admin·tenant_admin·finance)다. 계정 권한(`memberWrite`)과 민감도가 달라 따로 뒀다 — 실제로 기입하는 사람이 재경팀이다.
- 인턴은 계정(`members`)이 없어 `uid` 가 비어 있다. 조직장 지정 같은 계정 기반 기능에는 나오지 않는다.
- 생년월일·성별은 시트에 있어도 가져오지 않는다. 참여율 관리에 필요 없는 정보다.

## Recent Changes

- [2026-08-12] 인력 명부를 DB(`orgs/{org}/persons`)로 옮기고 계약 이력을 화면에서 관리하도록 했다. 프론트에 박혀 있던 직원 87명 배열을 제거했다. 프로덕션 데이터로 팀원 드롭다운 79개 옵션과 참여율 그룹핑 80명이 모두 변화 0건임을 확인한 뒤 교체했다.

## Related Files

- `src/app/components/people/PeopleDirectoryPage.tsx`
- `src/app/platform/person-employment.ts`
- `src/app/platform/person-directory.ts`
- `server/bff/routes/persons.mjs`

## Related Tests

- `src/app/platform/person-employment.test.ts`
- `server/bff/routes/persons.test.mjs`
- `src/app/data/project-team-member-options.test.ts`
