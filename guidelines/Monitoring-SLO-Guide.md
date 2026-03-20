# Monitoring & SLO Guide

상세 실행 플랜은 [Observability-Implementation-Plan.md](/Users/boram/InnerPlatform/guidelines/Observability-Implementation-Plan.md) 참고.

## SLO Targets

| Metric | Target | Source |
|--------|--------|--------|
| p95 Page Load | < 3s | Vercel Analytics |
| Firestore Error Rate | < 0.1% | Firebase Console |
| BFF Availability | > 99.5% | Cloud Run Metrics |
| Build Time | < 60s | GitHub Actions |

## Vercel Analytics

Production URL: `inner-platform.vercel.app`

확인 항목:
- Web Vitals (LCP, FID, CLS)
- Speed Insights → p95 page load
- Real Experience Score

## Firebase Performance

Project: `inner-platform-live-20260316`

확인 항목:
- Firestore read/write latency
- Auth success rate
- Storage upload latency

## Alert Channels

설정 위치:
- Vercel: Project Settings → Notifications
- Firebase: Cloud Monitoring → Alerting Policies
- GitHub: Actions → Notification settings

## 주간 점검 체크리스트

- [ ] Vercel Analytics p95 < 3s 확인
- [ ] Firebase Console → Firestore → Usage 탭 오류 확인
- [ ] Cloud Run → mysc-bff → Metrics 탭 5xx 비율 확인
- [ ] GitHub Actions → 최근 실패한 CI 확인
