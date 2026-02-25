# ETL JSON Staging Guide

Firestore 인증 없이 ETL 결과를 먼저 JSON으로 운영/검증하는 절차입니다.

## 1) ETL dry-run 실행

```bash
npx tsx scripts/etl/cli.ts run --dashboard "./[2026] 사업관리 통합 대시보드-2.xlsx"
```

## 2) Staging JSON 생성

```bash
npm run etl:build:staging-json
```

생성 파일:

- `scripts/etl/output/firestore-staging-bundle.json` (Firestore 적재 대기 데이터)
- `public/data/etl-staging-ui.json` (앱 로컬 표시 데이터)

## 3) 앱에서 JSON 데이터 사용

`.env.local`:

```env
VITE_FIRESTORE_CORE_ENABLED=false
VITE_ETL_STAGING_LOCAL_ENABLED=true
```

그 후 앱 실행:

```bash
npm run dev
```

## 4) 나중에 Firestore 연동

인증 준비 후:

```bash
npm run etl:sync:staging -- --commit --org mysc
```

기본은 dry-run이며, `--commit`이 있어야 실제 쓰기합니다.

