# 2026-04-15 PM Portal Safe Fetch Stabilization

## Problem
PM portal still emits repeated Firestore Listen 400 errors in production. The issue is no longer isolated to one provider; PM path still mounts too many realtime listeners.

## Strategy
- Preserve live listeners for admin/readAll roles.
- Switch PM path to safe fetch mode for the most important shared stores.
- Use one-time `getDocs` / `getDoc` for PM portal boot and page data instead of `onSnapshot` where live updates are not critical.

## Initial scope
- PortalStore PM path
- CashflowWeekProvider PM path
- PayrollProvider PM path

## Acceptance
- PM portal loads core data without repeated Listen 400 loops.
- Existing admin live workflows remain unchanged.
- Tests and patch notes updated.
