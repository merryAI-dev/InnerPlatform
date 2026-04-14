# Portal Guide Chat

- route: `/portal/guide-chat`
- primary users: 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 가이드형 질문/답변 인터페이스를 통해 도움을 받는 화면이다.

## Current UX Summary

- PageHeader 아래에서 가이드 대화 흐름을 제공한다.
- 버튼 중심의 대화 시작/재시도/보조 액션이 있다.

## Current Feature Checklist

- [x] BFF 비활성 gate 처리 가능
- [x] 가이드 미등록/캘리브레이션 중 gate 처리 가능
- [x] 현재 가이드 제목 노출 가능
- [x] 질문 전송과 Enter 제출 가능
- [x] Q&A history 로드 가능
- [x] 응답 생성 중/오류 메시지 처리 가능
- [x] 포털 self-serve 지원 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 일반 운영 입력 화면보다 보조 안내 성격이 강하다.

## Related Files

- `src/app/components/guide-chat/GuideChatPage.tsx`

## Related Tests

- 현재 guide chat 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사용자가 어디서 막히는지 파악할 때 보조적으로 참고할 수 있다.

## Next Watch Points

- 안내 문구와 실제 포털 흐름이 계속 어긋나지 않는지
