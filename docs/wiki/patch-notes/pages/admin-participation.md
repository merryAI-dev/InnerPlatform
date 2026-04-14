# Admin Participation

- route: `/participation`
- primary users: 관리자, 인력 배정 운영자
- status: active
- last updated: 2026-04-14

## Purpose

KOICA 및 교차검증 대상 사업의 참여율 합산과 위험 신호를 관리하는 관리자 화면이다.

## Current UX Summary

- 규칙 검증 결과, KPI, 인원/프로젝트별 상세 표를 바로 본다.
- 프로토콜 가이드 패널 없이 위험 결과와 실제 데이터 표 중심으로 운영한다.
- JSON 다운로드와 상세 확인 다이얼로그는 유지한다.

## Current Feature Checklist

- [x] 참여율 위험 상태 확인 가능
- [x] 규칙 검증 결과와 JSON 다운로드 가능
- [x] 프로토콜 가이드 패널 없이 데이터 표 중심으로 운영 가능
- [ ] 규칙 설명의 최소 라벨링은 추가 정리 여지 있음

## Recent Changes

- [2026-04-14] `4단계 프로토콜 가이드` 패널을 제거했다.

## Known Notes

- 이 화면은 교육 자료보다 검증 결과와 조치 판단이 핵심이다.
- 규칙 설명이 필요하면 화면 밖 문서나 운영 위키로 빼는 편이 안전하다.

## Related Files

- `src/app/components/participation/ParticipationPage.tsx`
- `src/app/data/participation-data.ts`

## Related Tests

- `src/app/data/participation-risk-rules.test.ts`
- `src/app/platform/participation-risk-rules.test.ts`

## Related QA / Ops Context

- 참여율 화면도 대형 가이드 패널보다 위험 결과와 조치 대상 식별이 더 중요하다는 기준으로 정리했다.

## Next Watch Points

- 가이드 제거 후에도 위험 규칙 해석이 충분히 전달되는지
- 상세 다이얼로그와 표에서 필요한 최소 문맥이 남아 있는지
