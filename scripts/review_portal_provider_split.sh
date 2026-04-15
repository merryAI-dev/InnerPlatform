#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Portal Provider Split Ops Review =="
echo
echo "[Scope]"
echo "- Focus: portal operation continuity, not ideal architecture purity"
echo "- Goal: admin keeps live ops surfaces, portal stays safe-fetch even for privileged users"
echo
echo "[Changed Files]"
git status --short \
  src/app/App.tsx \
  src/app/routes.tsx \
  src/app/data/admin-route-providers.tsx \
  src/app/data/portal-route-providers.tsx \
  src/app/data/firestore-realtime-mode.ts \
  src/app/data/board-store.tsx \
  src/app/data/cashflow-weeks-store.tsx \
  src/app/data/hr-announcements-store.tsx \
  src/app/data/payroll-store.tsx \
  src/app/data/portal-store.tsx \
  src/app/data/training-store.tsx \
  docs/wiki/patch-notes/index.md \
  docs/wiki/patch-notes/log.md \
  docs/wiki/patch-notes/pages/shared-portal-architecture.md \
  docs/architecture/portal-stabilization-hybrid-rfc-2026-04-15.md \
  docs/operations/2026-04-15-portal-hybrid-stabilization-plan.md || true

echo
echo "[Ops Gates]"
echo "1. App root no longer mounts broad operational providers"
echo "2. Admin route stays admin-live for privileged roles"
echo "3. Portal route stays portal-safe even for privileged roles"
echo "4. Patch note + RFC + ops plan stay in the same branch"
echo
echo "[Focused Tests]"
npx vitest run \
  src/app/data/firestore-realtime-mode.test.ts \
  src/app/data/firestore-realtime-providers.test.ts \
  src/app/data/firestore-access-policy.contract.test.ts \
  src/app/data/firestore-route-provider-behavior.test.ts \
  src/app/routes.provider-scope.test.ts
