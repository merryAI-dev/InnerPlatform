# Design System — MYSCube

## Product Context
- **What this is:** MYSC 사업관리통합플랫폼은 예산, 통장 내역, 사업비, 캐시플로, 프로젝트 등록/승인을 하나의 운영 흐름으로 묶는 내부 업무 플랫폼이다.
- **Who it's for:** MYSC PM, CIC 대표, 재무/운영 관리자, 권한 관리 담당자.
- **Space/industry:** 내부 운영, 프로젝트 관리, 정산/재무 검증, 경영관리.
- **Project type:** 데이터 밀도가 높은 web app / admin dashboard / PM portal.

## Aesthetic Direction
- **Direction:** Industrial / utilitarian, Jira-like professional workspace.
- **Decoration level:** Minimal. Decoration is limited to status, hierarchy, and brand anchoring.
- **Mood:** Serious, calm, traceable. The UI should feel like operational software people can trust for weekly finance and approval work.
- **Memorable thing:** 시트 업무를 Jira 수준의 추적 가능한 운영 시스템으로 바꾼다.

## Typography
- **Display/Hero:** Pretendard Variable. Korean legibility is more important than expressive display typography.
- **Body:** Pretendard Variable. Keep body copy quiet, readable, and compact.
- **UI/Labels:** Pretendard Variable with 500-700 weights for hierarchy.
- **Data/Tables:** Pretendard Variable with `font-variant-numeric: tabular-nums`; use Geist Mono or JetBrains Mono only for codes, IDs, and technical snippets.
- **Code:** Geist Mono or JetBrains Mono.
- **Loading:** Self-hosted/local CSS first. Avoid adding external font dependencies to the operating platform.
- **Scale:** 12px captions, 13px dense metadata, 14-15px body, 18-20px page titles, 24px max for major screen context. Do not use oversized marketing typography inside app screens.

## Color
- **Approach:** Restrained. One brand accent, cool neutrals, clear semantic states.
- **Primary:** `#0891b2` MYSCube cyan. Use for primary actions, active focus, links, and selected navigation.
- **Primary dark:** `#0e7490`. Use for hover/pressed states.
- **Secondary:** `#0f766e` operational teal. Use for success-adjacent finance and workflow progress.
- **Ink:** `#0f172a`. Use for sidebar, page headers, and high-emphasis text.
- **Neutrals:** `#f8fafc`, `#f1f5f9`, `#e2e8f0`, `#94a3b8`, `#475569`, `#0f172a`.
- **Semantic:** success `#059669`, warning `#d97706`, error `#e11d48`, info `#0891b2`.
- **Dark mode:** Deep navy surfaces with cyan/teal accents. Avoid violet, purple, and blue-purple gradients.
- **Do not use:** purple/violet/indigo as the default accent, decorative blue-purple gradients, gradient primary buttons, or purple FABs.

## Spacing
- **Base unit:** 4px.
- **Density:** Compact but readable. This is an operations tool, not a landing page.
- **Scale:** 2xs(2), xs(4), sm(8), md(16), lg(24), xl(32), 2xl(48).
- **Rule:** Related controls stay close. Distinct workflow sections use borders and headings before shadows or decorative cards.

## Layout
- **Approach:** Grid-disciplined app shell.
- **Grid:** Sidebar + content workspace on desktop; content-first drawer behavior on mobile.
- **Max content width:** 1600px for admin workspaces; forms should constrain inner fields for scanability.
- **Border radius:** sm 4px, md 6px, lg 8px, full 9999px. Avoid bubbly 12-20px radii except for contained empty states.
- **Cards:** Use cards for repeated records, modals, and framed tools. Do not make every section a floating card if a table or full-width band would scan better.

## Motion
- **Approach:** Minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80-120ms, short 150-220ms, medium 250-350ms.
- **Rule:** Motion should explain state changes. Avoid decorative animation.

## Components
- **Buttons:** Solid primary is cyan/teal, no gradient. Secondary is neutral outline. Destructive is red with confirmation.
- **Navigation:** Active state uses a cyan rail and subtle navy/cyan fill, not purple glow.
- **Forms:** Inputs need visible light-gray borders and white surface. Form fields should look like editable cells, not floating glass.
- **Tables and ledgers:** Prioritize row rhythm, sticky headers, tabular numbers, and quiet status badges.
- **Status badges:** Use semantic color only when it changes decision-making. Otherwise use slate.
- **FABs:** Avoid unless the action is global and urgent. If present, use brand cyan or dark navy, not purple.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Initial MYSCube design system created | Remove AI SaaS/purple styling and align the platform with a Jira-like professional operations workspace. |
