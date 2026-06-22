# Privacy-by-Design Control Model

Status: `approved`

This project applies Privacy by Design to MYSCube security monitoring by adapting the osquery deployment model to SaaS control-plane telemetry.

## Sources Read

- osquery repository: `https://github.com/osquery/osquery`
- osquery configuration docs: `https://osquery.readthedocs.io/en/stable/deployment/configuration/`
- osquery logging docs: `https://osquery.readthedocs.io/en/stable/deployment/logging/`
- Local source review path used during implementation: `/tmp/osquery-src`

Relevant osquery patterns:

- osquery exposes system state as queryable tables.
- `osqueryd` schedules named queries at intervals.
- query packs group related queries and can use discovery queries.
- scheduled query results are differential by default; snapshot logging is explicit and heavier.
- result logs are JSON and can be shipped to downstream aggregation.

## MYSCube Adaptation

MYSCube does not run osquery against GitHub, Firestore, or Google Drive. Instead, it uses the same operational shape:

- `policies/security-observability-packs.json` defines GitHub, Drive, and Firestore monitoring packs.
- every query has a purpose, interval, collection mode, PII handling mode, retention, and minimized output fields.
- differential collection is the default.
- snapshot collection requires a written justification.
- raw PII is blocked in observability pack outputs.
- policy verification runs through `npm run policy:verify`.

## PbD Defaults

- Do not collect document content, raw Drive file names, raw external email addresses, raw phone numbers, tokens, secrets, or private keys.
- Store hashes or redacted forms for principals where correlation is needed.
- Keep retention at or below 365 days unless explicitly approved.
- Do not return encrypted actor email material from audit-log APIs; return only `userEmailProtected` and `userEmailKeyRef`.

## Verification

Run:

```bash
npm run policy:verify
npm test -- --run server/privacy-by-design-policy.test.ts
```
