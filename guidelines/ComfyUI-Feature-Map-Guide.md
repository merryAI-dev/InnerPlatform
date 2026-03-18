# ComfyUI 도식화 가이드 (기능 중심 버전)

## 생성 파일
- 워크플로우: `guidelines/ComfyUI-Feature-Map-Workflow.json`
- 기능 맵 원본(검수 기준): `guidelines/Feature-Map-Mermaid.md`

## 사용 방법
1. ComfyUI 실행
2. `Load`로 `guidelines/ComfyUI-Feature-Map-Workflow.json` 로드
3. `CheckpointLoaderSimple.ckpt_name`을 로컬 모델명으로 변경
4. Queue 실행
5. 결과 이미지 확인 후 필요 시 `CLIPTextEncode` 프롬프트 문구만 수정해 재생성

## 권장 튜닝(비개발자 공유용)
- 해상도: `1792x1024` (기본) → A4 출력/발표용은 `2048x1280`
- Steps: `30~45`
- CFG: `6.5~8.0`
- 텍스트 가독성 우선이면 프롬프트에 `clean Korean labels, large font, no tiny text` 유지

## 참고
- ComfyUI 결과는 이미지 생성 특성상 텍스트가 깨질 수 있으므로,
  구조 정확성은 `Feature-Map-Mermaid.md`를 기준으로 검수하세요.
- 이번 버전은 기술 컴포넌트(BFF/DB/워커)보다 업무 흐름(기획→집행→정산→감사)을 우선해 표현합니다.
