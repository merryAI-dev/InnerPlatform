# Admin Evidence Queue

- route: `/evidence`
- primary users: admin, 증빙 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

증빙 큐를 보고 대기 상태, 연결 상태, 처리 우선순위를 운영하는 관리자 화면이다.

## Current UX Summary

- 탭 기반으로 증빙 큐를 나눠 본다.
- 증빙 검토와 후속 조치를 위한 운영 화면으로 사용한다.

## Current Feature Checklist

- [x] 증빙 미완료/승인대기/반려 탭 전환 가능
- [x] 프로젝트 필터 가능
- [x] 거래처/프로젝트 검색 가능
- [x] 누락 증빙 항목 확인 가능
- [x] Drive 링크 열기 가능
- [x] row에서 원장 상세 이동 가능
- [x] 증빙 대기/검토 흐름 운영 가능
- [x] 정산/사업비 입력 후속 처리와 연결 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 증빙 큐는 portal 주간 입력과 강하게 연결된다.

## Related Files

- `src/app/components/evidence/EvidenceQueuePage.tsx`

## Related Tests

- 현재 증빙 큐 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 증빙/드라이브 관련 QA 이슈와 함께 보아야 한다.

## Next Watch Points

- 큐 상태 용어가 portal 쪽 표현과 어긋나지 않는지
