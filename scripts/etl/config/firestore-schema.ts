/**
 * Firestore 컬렉션 스키마 메타데이터 — LLM 프롬프트에 주입
 * types.ts에서 추출한 인터페이스의 핵심 필드 정보
 */

export interface FieldMeta {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'object' | 'array';
  required: boolean;
  description: string;
  enumValues?: string[];
}

export interface CollectionSchema {
  collection: string;
  docIdPattern: string;
  description: string;
  fields: FieldMeta[];
}

export const FIRESTORE_SCHEMAS: CollectionSchema[] = [
  {
    collection: 'projects',
    docIdPattern: '{projectId}',
    description: '사업(프로젝트) 정보. 사업확보 현황판, 확정사업 관리 시트에서 추출.',
    fields: [
      { name: 'id', type: 'string', required: true, description: '프로젝트 고유 ID' },
      { name: 'slug', type: 'string', required: true, description: 'URL-safe key' },
      { name: 'name', type: 'string', required: true, description: '사업명' },
      { name: 'status', type: 'enum', required: true, description: '사업진행상태', enumValues: ['CONTRACT_PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_PENDING_PAYMENT'] },
      { name: 'type', type: 'enum', required: true, description: '사업유형', enumValues: ['DEV_COOPERATION', 'CONSULTING', 'SPACE_BIZ', 'IMPACT_INVEST', 'OTHER'] },
      { name: 'phase', type: 'enum', required: true, description: '사업단계', enumValues: ['PROSPECT', 'CONFIRMED'] },
      { name: 'contractAmount', type: 'number', required: false, description: '총 사업비(매출부가세 포함)' },
      { name: 'contractStart', type: 'date', required: false, description: '계약 시작일' },
      { name: 'contractEnd', type: 'date', required: false, description: '계약 종료일' },
      { name: 'settlementType', type: 'enum', required: false, description: '정산유형', enumValues: ['TYPE1', 'TYPE2', 'TYPE4'] },
      { name: 'basis', type: 'enum', required: false, description: '정산기준', enumValues: ['SUPPLY_AMOUNT', 'SUPPLY_PRICE'] },
      { name: 'accountType', type: 'enum', required: false, description: '통장유형', enumValues: ['DEDICATED', 'OPERATING', 'NONE'] },
      { name: 'clientOrg', type: 'string', required: false, description: '발주기관(계약기관)' },
      { name: 'department', type: 'string', required: false, description: '담당조직(센터)' },
      { name: 'teamName', type: 'string', required: false, description: '사내기업팀' },
      { name: 'managerId', type: 'string', required: false, description: 'PM uid' },
      { name: 'managerName', type: 'string', required: false, description: '메인 담당자' },
      { name: 'budgetCurrentYear', type: 'number', required: false, description: '당해년도 총사업비' },
      { name: 'profitRate', type: 'number', required: false, description: '수익률 (0~1)' },
      { name: 'profitAmount', type: 'number', required: false, description: '수익금액' },
      { name: 'isSettled', type: 'boolean', required: false, description: '정산완료 여부' },
    ],
  },
  {
    collection: 'transactions',
    docIdPattern: '{transactionId}',
    description: '사용내역/지출대장 거래 레코드. 사용내역 시트, 그룹지출대장에서 추출.',
    fields: [
      { name: 'id', type: 'string', required: true, description: '거래 ID' },
      { name: 'projectId', type: 'string', required: true, description: '소속 프로젝트 ID' },
      { name: 'dateTime', type: 'date', required: true, description: '거래일시 (ISO)' },
      { name: 'weekCode', type: 'string', required: false, description: '해당 주차 코드 (2026-01-W1)' },
      { name: 'direction', type: 'enum', required: true, description: '입출금 방향', enumValues: ['IN', 'OUT'] },
      { name: 'method', type: 'enum', required: false, description: '결제수단', enumValues: ['BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER'] },
      { name: 'cashflowCategory', type: 'string', required: false, description: 'cashflow 항목' },
      { name: 'budgetCategory', type: 'string', required: false, description: '비목/세목' },
      { name: 'counterparty', type: 'string', required: false, description: '거래처/지급처' },
      { name: 'memo', type: 'string', required: false, description: '상세 적요' },
      { name: 'amounts.bankAmount', type: 'number', required: false, description: '통장 금액' },
      { name: 'amounts.depositAmount', type: 'number', required: false, description: '입금액' },
      { name: 'amounts.expenseAmount', type: 'number', required: false, description: '출금액' },
      { name: 'amounts.vatIn', type: 'number', required: false, description: '매입부가세' },
      { name: 'amounts.balanceAfter', type: 'number', required: false, description: '거래후 잔액' },
    ],
  },
  {
    collection: 'cashflowWeekSheets',
    docIdPattern: '{projectId}-{yearMonth}-w{weekNo}',
    description: '주간 캐시플로 시트. cashflow 탭에서 추출. 행=항목, 열=주차.',
    fields: [
      { name: 'id', type: 'string', required: true, description: '문서 ID' },
      { name: 'projectId', type: 'string', required: true, description: '프로젝트 ID' },
      { name: 'yearMonth', type: 'string', required: true, description: '년월 (2026-01)' },
      { name: 'weekNo', type: 'number', required: true, description: '주차 번호 (1~5)' },
      { name: 'weekStart', type: 'date', required: true, description: '주 시작일 (월요일)' },
      { name: 'weekEnd', type: 'date', required: true, description: '주 종료일 (일요일)' },
      { name: 'projection', type: 'object', required: false, description: '예상 금액 맵 (lineId → number)' },
      { name: 'actual', type: 'object', required: false, description: '실제 금액 맵 (lineId → number)' },
    ],
  },
  {
    collection: 'members',
    docIdPattern: '{uid}',
    description: '조직 구성원. 전체 재직자명단 시트에서 추출.',
    fields: [
      { name: 'uid', type: 'string', required: true, description: '사용자 ID' },
      { name: 'name', type: 'string', required: true, description: '성명' },
      { name: 'email', type: 'string', required: false, description: '이메일' },
      { name: 'role', type: 'enum', required: true, description: '역할', enumValues: ['admin', 'pm', 'finance', 'viewer', 'auditor'] },
      { name: 'department', type: 'string', required: false, description: '부서 (중분류)' },
      { name: 'title', type: 'string', required: false, description: '직급' },
    ],
  },
  {
    collection: 'participationEntries',
    docIdPattern: '{entryId}',
    description: '참여율 배정 항목. 참여율/인력투입률 시트에서 추출.',
    fields: [
      { name: 'id', type: 'string', required: true, description: '항목 ID' },
      { name: 'memberId', type: 'string', required: false, description: '구성원 ID' },
      { name: 'memberName', type: 'string', required: true, description: '구성원 이름' },
      { name: 'projectId', type: 'string', required: false, description: '프로젝트 ID' },
      { name: 'projectName', type: 'string', required: true, description: '사업명' },
      { name: 'rate', type: 'number', required: true, description: '참여율 (0~100)' },
      { name: 'periodStart', type: 'string', required: false, description: '참여 시작월 (YYYY-MM)' },
      { name: 'periodEnd', type: 'string', required: false, description: '참여 종료월 (YYYY-MM)' },
    ],
  },
];

/**
 * LLM 프롬프트용 스키마 요약 텍스트 생성
 */
export function schemaToPromptText(): string {
  return FIRESTORE_SCHEMAS.map(s => {
    const fields = s.fields.map(f => {
      let desc = `  - ${f.name}: ${f.type}${f.required ? ' (필수)' : ''} — ${f.description}`;
      if (f.enumValues) desc += ` [${f.enumValues.join(', ')}]`;
      return desc;
    }).join('\n');
    return `### ${s.collection}\n${s.description}\nDoc ID: ${s.docIdPattern}\n${fields}`;
  }).join('\n\n');
}
