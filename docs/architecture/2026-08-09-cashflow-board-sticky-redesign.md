# 캐시플로 보드 sticky 재설계 (2026-08-09)

**대상:** `src/app/components/cashflow/CashflowProjectSheet.tsx` 의 Projection·ACTUAL 주차 보드
**상태:** 적용 완료

## 증상

1. 페이지를 세로로 내리면 **주차 헤더(`thead`)가 사라진다.** `sticky top-0 z-40` 이 선언되어
   있는데도 붙지 않는다. 21행짜리 표의 아래쪽 라인을 볼 때 어느 주차 열인지 알 수 없다.
2. Projection 표를 가로로 스크롤해도 **ACTUAL 표는 제자리다.** 두 표가 같은 주차 열을
   보여야 하는데 어긋난다. 화살표 버튼(`scrollBoard`)도 Projection ref 하나만 움직였다.

## 원인 — sticky 는 가장 가까운 스크롤 조상에만 붙는다

CSS 명세상 `position: sticky` 의 기준은 **가장 가까운 스크롤 컨테이너의 scrollport** 다.
`overflow` 가 `visible`/`clip` 이 아닌 조상이 생기는 순간, sticky 는 그 조상 기준으로만
동작하고 문서(뷰포트) 스크롤에는 반응하지 않는다.

기존 구조가 정확히 그 함정이었다:

```jsx
// before — 표마다 독립 가로 스크롤 래퍼
<div className="space-y-5 ...">
  <section className="overflow-x-auto ...">   {/* ← 스크롤 조상 #1 */}
    <table>
      <thead className="sticky top-0 ...">    {/* section 은 세로 스크롤이 없으므로 죽은 선언 */}
  </section>
  <section className="overflow-x-auto ...">   {/* ← 스크롤 조상 #2 — 가로 스크롤도 따로 논다 */}
    ...
  </section>
</div>
```

`overflow-x: auto` 인 section 은 세로 스크롤을 갖지 않으므로 `sticky top` 은 시각적으로
아무 일도 하지 않고, 페이지 세로 스크롤은 section 바깥이라 sticky 가 볼 수 없다.

이것은 구현 버그가 아니라 **명세의 알려진 한계**다. "가로 스크롤 컨테이너가 필요한 표에서
헤더는 뷰포트에 붙이고 열은 표에 붙이고 싶다"는 요구가 CSSWG 에 반복 제기되어 있고,
현 명세로는 불가능하다:

- [w3c/csswg-drafts#9140](https://github.com/w3c/csswg-drafts/issues/9140) — 이 시나리오 그대로 (sticky 축별 스크롤 조상 분리 제안, 미해결)
- [w3c/csswg-drafts#8286](https://github.com/w3c/csswg-drafts/issues/8286) — 스크롤 조상이 있으면 뷰포트 가장자리에 붙일 수 없다는 저자 불만 정리
- [w3c/csswg-drafts#865](https://github.com/w3c/csswg-drafts/issues/865) — overflow 조상 아래 sticky 동작의 원조 논의 (2016~)

## 대체 설계 — 스크롤 컨테이너를 하나로

명세를 우회하는 표준 패턴은 **세로·가로 스크롤을 한 컨테이너에 모으는 것**이다.
sticky 의 기준 조상이 하나가 되므로 `top` 과 `left` 가 같은 컨테이너 안에서 전부 동작하고,
두 표가 한 컨테이너에 살므로 가로 스크롤 동기화 문제 자체가 소멸한다.

```jsx
// after — 세로(max-height)·가로 스크롤을 모두 소유하는 컨테이너 하나
<section
  ref={cashflowBoardScrollRef}
  className="max-h-[calc(100vh-240px)] space-y-5 overflow-auto scroll-smooth rounded-md border border-slate-200 bg-white p-3"
  tabIndex={0}
  aria-label="Projection과 Actual 현금흐름 스크롤 표"
>
  <div className="w-max min-w-full" data-cashflow-block="projection" ...>
    <h3 className="sticky left-0 ...">Projection</h3>
    {renderModeTable('projection')}
  </div>
  <div className="w-max min-w-full" data-cashflow-block="actual" ...>
    <h3 className="sticky left-0 ...">ACTUAL</h3>
    {renderModeTable('actual')}
  </div>
</section>
```

동작 원리:

| 요소 | 선언 | 붙는 기준 |
|---|---|---|
| 주차 헤더 `thead` | `sticky top-0 z-40` | 컨테이너 세로 스크롤 — **이제 실제로 붙는다.** Projection 표를 지나면 ACTUAL 의 헤더가 자연스럽게 교대한다 |
| 항목 열 `td`/`th` | `sticky left-0` | 컨테이너 가로 스크롤 (기존 동작 유지) |
| 교차 셀(항목 헤더 `th`) | `sticky left-0 z-50` **inside** sticky `thead` | 중첩 sticky — top 은 thead 가, left 는 th 가 담당 |
| 블록 라벨 `h3` | `sticky left-0 z-30` | 컨테이너 가로 스크롤 |

세부 결정 두 가지:

- **내부 래퍼는 `w-max min-w-full`** — 래퍼가 컨테이너 clientWidth 로 잘리면 sticky 요소의
  containing block 이 좁아져 가로 스크롤 중간에 고정이 풀린다. `w-max` 로 콘텐츠 폭 전체를
  갖게 하고, 표가 좁을 때를 위해 `min-w-full` 을 함께 둔다.
- **`max-h-[calc(100vh-240px)]`** — 컨테이너가 세로 스크롤을 소유해야 `sticky top` 이 산다.
  240px 은 상단 네비게이션·카드 헤더·여백의 근사치다. 표가 그보다 작으면 스크롤은 생기지
  않는다(auto).

`scrollBoard` (화살표 스냅 스크롤)와 `getSnappedWeekScrollLeft` 는 **무변경** — ref 가 이제
두 표를 모두 담는 컨테이너를 가리키므로 버튼 하나로 두 표가 같이 움직인다. JS 스크롤
동기화(`onScroll` 리스너 + `scrollLeft` 복제) 대안은 리플로우·떨림·유지비 때문에 채택하지
않았고, shell 테스트가 `onScroll=` 부재를 계속 단언한다.

## 검증

- `CashflowProjectSheet.shell.test.ts` — 단일 컨테이너 계약 고정 (61/61)
  - 사보타주: ACTUAL 래퍼에 `overflow-x-auto` 를 되살리면 1건 실패 확인 후 원복
- `npm run build` OK, `tsc` 오류 수 main 과 동일(신규 0)

## 남긴 것 (범위 밖)

- `CashflowWeeklyPage` 의 sticky 헤더도 같은 구조적 제약 아래 있으나, 그 표는 페이지가
  유일한 세로 스크롤러라 현재 동작한다. 그 페이지에 가로 스크롤 래퍼를 추가하게 되면
  이 문서의 패턴을 그대로 적용할 것.
- 브라우저 실측(스크린샷 비교)은 라이브 반영 후 확인.
