---
id: business-card-db-product-brief
status: planned
depends_on: []
unblocks:
  - business-card-db-data-model
  - business-card-db-api-contract
---

# 00 Product Brief

## Goal

InnerPlatform LAB에 명함 DB를 추가해 현장에서 받은 명함을 모바일로 촬영하고, Vertex AI Gemini가 추출한 연락처 정보를 사람이 확인한 뒤 전사 검색 가능한 DB에 저장한다.

## Primary Users

- PM: 현장에서 받은 파트너/기관 담당자 명함을 빠르게 저장한다.
- 관리자: 전사 관계자 DB를 검색하고 중복/품질 상태를 확인한다.
- 운영팀: 원본 이미지, 추출 결과, 수정 이력을 근거로 데이터 품질을 관리한다.

## Success Criteria

- 모바일에서 30초 안에 촬영/업로드를 완료할 수 있다.
- OCR/추출 결과가 draft로 뜨고, 사용자가 1분 안에 검토 저장할 수 있다.
- 저장된 연락처는 이름, 회사, 이메일, 전화번호 일부로 전사 검색된다.
- 원본 이미지는 public URL 없이 인증된 사용자만 볼 수 있다.
- Gemini 실패 시에도 사용자가 수동 입력으로 저장할 수 있다.

## Out Of Scope

- Hermes agent, 자동 follow-up 추천, 프로젝트 연결 추천
- 자동 중복 병합
- 외부 CRM 연동
- 네이티브 iOS/Android 앱 심사
- 연락처 대량 import/export

## Product Risk Review

### gstack CEO Review

명함 저장 자체는 commodity 기능이다. InnerPlatform에서 의미 있는 지점은 "전사 관계자 DB의 최소 입력점"이다. 따라서 v1은 CRM 전체가 아니라 명함 등록과 검색의 가장 짧은 루프만 만든다.

### gstack Design Review

모바일에서 긴 폼을 먼저 보여주면 사용자가 이탈한다. UX는 `촬영 -> 추출 -> 검토 저장` 3단계로 제한한다.

### gstack Eng Review

Gemini output은 추정값이다. canonical contact로 바로 저장하지 않고 반드시 `business_card_imports` draft를 거쳐야 한다.

## Acceptance

- LAB 기능 설명에 "전사 관계자 검색 DB"라는 목적이 드러난다.
- UI copy는 "자동 등록"이 아니라 "추출 후 검토"라고 표현한다.
- 저장 전 필수값 검증을 통과하지 못하면 contact가 만들어지지 않는다.
