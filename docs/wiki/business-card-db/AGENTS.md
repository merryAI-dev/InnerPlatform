# Business Card DB Wiki Agent Guide

## Mission

이 디렉터리는 InnerPlatform LAB 명함 DB 기능의 제품/기술/운영 위키다. raw truth는 코드, 테스트, 배포 설정, Firebase/Vertex AI 운영 설정이고 이 위키는 다음 구현자와 운영자가 같은 결정을 공유하기 위한 중간 계층이다.

## Directory Contract

- `index.md`: 전체 탐색 진입점
- `00-product-brief.md`: 제품 목적, 성공 기준, 제외 범위
- `01-data-model.md`: Firestore/Storage 모델과 검색 토큰 정책
- `02-api-contract.md`: BFF endpoint 계약
- `03-vertex-gemini-extraction.md`: Vertex AI Gemini 추출 스펙
- `04-pwa-mobile-capture.md`: PWA/모바일 촬영 스펙
- `05-security-privacy-rbac.md`: 전사 검색, 원본 보관, 권한, 감사 정책
- `06-search-dedupe-quality.md`: 검색/중복/품질 산식
- `07-test-qa-release.md`: 테스트, QA, 배포 기준
- `log.md`: append-only 변경 기록

## Authoring Rules

1. 문서 변경은 구현 결정의 결과를 반영한다. 코드와 다른 내용을 상상해서 쓰지 않는다.
2. 새 endpoint, Firestore field, Storage path, env var가 생기면 관련 스펙 문서와 `index.md`를 같이 갱신한다.
3. 개인정보/권한 정책이 바뀌면 `05-security-privacy-rbac.md`와 `07-test-qa-release.md`를 같이 갱신한다.
4. Gemini prompt나 JSON schema가 바뀌면 `03-vertex-gemini-extraction.md`에 변경 이유와 fallback 동작을 남긴다.
5. 수식은 구현자가 바로 테스트로 옮길 수 있게 변수 정의와 threshold를 같이 적는다.
6. `log.md`는 시간순 append-only로 쓴다. 오래된 기록을 조용히 고치지 않는다.
7. Obsidian-style link는 `[[문서명]]` 형태로 유지하고, repo markdown 링크는 필요한 경우 병기한다.
8. 원본 명함 이미지의 public URL 발급 금지 원칙은 문서에서 삭제하지 않는다.

## Review Rules

- 제품 검토: `gstack-plan-ceo-review`
- 기술 검토: `gstack-plan-eng-review`
- UX 검토: `gstack-plan-design-review`
- 구현 계획: `superpowers-writing-plans`
- 실행: `superpowers-executing-plans` 또는 `superpowers-subagent-driven-development`

## Done Criteria

- `index.md`에서 모든 세부 문서로 이동할 수 있다.
- 각 하위 문서는 dependency, owner, status, acceptance 기준을 포함한다.
- 구현 계획 문서의 dependency graph와 위키 문서 트리가 서로 충돌하지 않는다.
