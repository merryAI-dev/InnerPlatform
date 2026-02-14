# Repository Guidelines

## Project Structure & Module Organization
The app is a Vite + React + TypeScript frontend.

- `src/main.tsx`: app entry point.
- `src/app/App.tsx`: top-level providers and router wiring.
- `src/app/routes.tsx`: route map for admin (`/`) and portal (`/portal`) flows.
- `src/app/components/`: feature UIs (`dashboard`, `projects`, `portal`, etc.) and shared `ui/` primitives.
- `src/app/data/`: mock datasets and client-side stores.
- `src/app/lib/`: Firebase initialization, Firestore CRUD, and seed utilities.
- `src/styles/`: global style imports (`fonts.css`, `tailwind.css`, `theme.css`).
- `guidelines/Guidelines.md`: optional local AI/design guidance.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start local Vite dev server.
- `npm run build`: create a production build.

Example:
```bash
npm install
npm run dev
```

## Coding Style & Naming Conventions
- Use TypeScript React function components.
- Follow existing formatting: 2-space indentation, semicolons, and file-local quote style.
- Use `PascalCase` for component/page files (for example, `ProjectDetailPage.tsx`).
- Keep route paths and folder names in kebab/lowercase style (for example, `expense-management`).
- Place shared UI in `src/app/components/ui/`; keep feature logic inside its feature folder.
- Use the `@` alias for `src` imports when helpful.

## Testing Guidelines
No automated test framework is configured yet (no `test` script or `*.test.*` files currently).

- For each PR, run `npm run build` and manually verify key routes in both admin and portal flows.
- If adding tests, prefer Vitest + React Testing Library and name files `*.test.ts` or `*.test.tsx` next to source files.
- Prioritize coverage for routing, state stores, and Firestore service logic.

## Commit & Pull Request Guidelines
This bundle does not include `.git` history, so no existing commit convention can be inferred. Use Conventional Commits:

- `feat(portal): add budget summary widget`
- `fix(firebase): guard empty projectId`

PRs should include:
- Scope and reason for changes.
- Linked issue/task ID.
- Screenshots for UI updates (admin and portal where relevant).
- Manual verification notes (`npm run build`, routes checked, Firebase impact).

## Security & Configuration Tips
- Do not commit real Firebase credentials or production project IDs.
- Keep environment-specific Firebase config local (for example via the in-app setup flow/local storage).
- Treat files in `src/app/data/` as sample/mock content unless explicitly migrating to backend data.
