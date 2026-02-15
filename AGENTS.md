# Repository Guidelines

## Project Structure
- `src/`: Vite + React + TypeScript frontend.
  - `src/app/routes.tsx`: admin (`/`) and portal (`/portal`) routing.
  - `src/app/components/`: feature UIs (projects, payroll, board, cashflow, portal).
  - `src/app/data/`: client stores/providers and shared types (`src/app/data/types.ts`).
  - `src/app/platform/`: shared “policy/logic” helpers (RBAC, tenant, business-days, cashflow week buckets).
- `server/bff/`: Express BFF used by `/api/v1/*` (idempotency, outbox, queue workers, audit chain).
- `api/bff.js`: Vercel Serverless entrypoint for the BFF.
- `firebase/`: Firestore rules + composite indexes.
- `policies/`: policy-as-code JSON (RBAC, relation rules).
- `scripts/` + `guidelines/`: Firebase automation + operational runbooks.

## Build, Test, Run
- `npm run dev`: local frontend.
- `npm run build`: production build.
- `npm test`: unit tests (Vitest).
- `npm run bff:dev`: local BFF on `127.0.0.1:8787`.
- `npm run bff:test:integration`: Firestore emulator + BFF integration tests.

Recommended gate before PR:
```bash
npm test
npm run bff:test:integration
npm run build
```

## Coding Style & Naming
- TypeScript, React function components, 2-space indentation.
- Components/pages: `PascalCase.tsx` (example: `AdminPayrollPage.tsx`).
- Route segments/folders: lowercase/kebab (example: `expense-management`).
- Keep cross-cutting rules in `src/app/platform/`; keep feature UI in `src/app/components/<feature>/`.

## Commit & PR Guidelines
- Prefer Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`.
- PRs should include:
  - What/why, screenshots for UI changes (admin + portal), and test results.
  - Ops notes when Firestore rules/indexes or Vercel envs change.

## Firebase/Vercel Ops (Common)
- Deploy Firestore rules/indexes: `npm run firebase:deploy:firestore`.
- One-shot Firebase setup (writes `.env`, `.firebaserc`, deploys): `npm run firebase:autosetup`.
- Vercel deploy: `vercel deploy` (preview) or `vercel --prod` (production).

