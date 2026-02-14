# Operational Hardening Runbook

## 1) Firestore Composite Indexes

```bash
npm run firebase:deploy:indexes
```

Includes `transactions(projectId, ledgerId)` and outbox processing indexes.

## 2) Audit Hash Chain Verification

```bash
curl -H 'x-tenant-id: mysc' -H 'x-actor-id: u001' http://127.0.0.1:8787/api/v1/audit-logs/verify
```

- `200`: chain valid
- `409`: chain mismatch/tampering detected

## 3) Outbox Processing

```bash
# one-shot processing
npm run bff:outbox:worker

# continuous worker
BFF_OUTBOX_LOOP=true npm run bff:outbox:worker
```

## 4) Backup/Recovery Drill

```bash
# schedule backups
npm run firestore:backup:schedule

# restore latest backup to rehearsal DB
npm run firestore:backup:rehearsal
```

## 5) SLO Alerts

```bash
export MONITORING_NOTIFICATION_CHANNELS='projects/<project>/notificationChannels/<channel-id>'
npm run monitoring:setup:alerts
```

Creates/updates:
- 5xx rate > 1%
- p95 latency > 2s
- version_conflict rate > 5%

## 6) PII Encryption + Rotation

- `PII_MODE=local|kms|auto|off`
- Local mode:
  - `PII_LOCAL_KEYRING=v1:<base64-32b>,v2:<base64-32b>`
  - `PII_LOCAL_CURRENT_KEY_ID=v2`
- KMS mode:
  - `PII_KMS_KEYS=projects/.../cryptoKeys/keyA,projects/.../cryptoKeys/keyB`
  - `PII_KMS_CURRENT_KEY=projects/.../cryptoKeys/keyB`

```bash
npm run pii:rotate
```

### Vercel Only (No GCP/KMS)

```bash
# one-time
vercel login
vercel link

# generate local keyring + local env file
npm run pii:setup:vercel

# push directly to Vercel env (prod/preview/dev)
npm run pii:setup:vercel -- --push
```

Optional custom args:
- `--key-id v2`
- `--environments production,preview`

## 7) Policy-as-Code

```bash
npm run policy:verify
```

Policy file: `policies/rbac-policy.json`  
Role change endpoint: `PATCH /api/v1/members/:memberId/role`
