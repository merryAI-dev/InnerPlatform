# Cloudflare WAF Observability Design

Status: `draft`

Cloudflare WAF를 적용하기 전, 차단/챌린지/허용 이벤트가 어디에 저장되고 누가 보는지 확정해야 한다. WAF rule만 켜는 것은 엔터프라이즈 관제가 아니다.

## Required Event Sources

- Cloudflare Security Events
- WAF managed rule matches
- Custom WAF rule matches
- Rate limit actions
- Managed challenge issued / solved / failed
- DNS record and zone setting changes
- Cloudflare Access events, if Access is enabled later

## Required Destinations

1. Short-term searchable log store
   - Cloudflare Logpush -> GCS/S3/R2/BigQuery 중 하나
   - Retention: at least 90 days

2. MYSCube security console
   - Normalized collection: `orgs/{orgId}/securityEvents`
   - Aggregated finding collection: `orgs/{orgId}/securityFindings`
   - Dashboards:
     - blocked requests by hostname/rule
     - challenge solve/fail ratio
     - top source ASNs/countries/IP hashes
     - false-positive queue
     - direct-origin bypass candidates

3. Alert routing
   - Critical: Slack security channel + named owner
   - High: daily triage queue
   - Medium/Low: weekly review

## Minimum Event Schema

```json
{
  "eventId": "string",
  "source": "cloudflare",
  "hostname": "string",
  "action": "block|managed_challenge|js_challenge|log|skip|allow",
  "ruleId": "string",
  "ruleRef": "string",
  "riskLevel": "critical|high|medium|low|info",
  "clientIpHash": "string",
  "userAgentHash": "string",
  "pathTemplate": "string",
  "method": "string",
  "rayId": "string",
  "occurredAt": "timestamp",
  "ingestedAt": "timestamp"
}
```

Do not store raw IP addresses or full user agents in MYSCube unless a specific incident requires elevated evidence handling.

## Pre-Production Gates

- [ ] Log destination provisioned
- [ ] Event parser implemented and tested
- [ ] Security events visible in MYSCube
- [ ] Slack alert route tested
- [ ] False-positive review owner assigned
- [ ] WAF rules run in observe/log mode before enforcement where supported
- [ ] Rollback criteria documented

## Operational Owners

Required before production:

- Cloudflare zone owner
- WAF rule owner
- Log pipeline owner
- Security triage owner
- Business rollback approver
