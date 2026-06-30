/**
 * Step 2: Static Schema Mapping (LLM 없이 결정적 매핑)
 * 한국어 헤더 패턴 → Firestore 필드 직접 매핑
 */
import type { SheetManifest } from './01-discover.js';
import { synthesizeHeaders } from '../parsers/excel-reader.js';

export interface ColumnMapping {
  excelColumn: string;
  firestoreField: string;
  transform?: string;
  confidence: number;
  note?: string;
}

export interface SheetMapping {
  sheetName: string;
  targetCollection: string;
  columnMappings: ColumnMapping[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * 패턴 기반 헤더 매칭 규칙
 * key = 헤더에 포함된 한국어 패턴, value = 매핑 정보
 */
interface MappingRule {
  patterns: string[];        // 하나라도 매치되면 적용
  firestoreField: string;
  transform?: string;
  confidence?: number;
}

// ── Collection별 매핑 규칙 ──

const PROJECT_RULES: MappingRule[] = [
  { patterns: ['사업명'], firestoreField: 'name', transform: 'normalizeString', confidence: 0.95 },
  { patterns: ['발주기관', '계약기관'], firestoreField: 'clientOrg', transform: 'normalizeString' },
  { patterns: ['유형'], firestoreField: 'type', transform: 'normalizeProjectType' },
  { patterns: ['확보여부', '진행상태', '사업상태'], firestoreField: 'status', transform: 'normalizeProjectStatus' },
  { patterns: ['연속', '신규 구분'], firestoreField: 'phase', confidence: 0.8 },
  { patterns: ['계약금액', '총사업비', '공급가액', '공급대가', '사업비'], firestoreField: 'contractAmount', transform: 'normalizeAmount' },
  { patterns: ['계약시작', '시작일', '사업시작'], firestoreField: 'contractStart', transform: 'normalizeDate' },
  { patterns: ['계약종료', '종료일', '사업종료'], firestoreField: 'contractEnd', transform: 'normalizeDate' },
  { patterns: ['정산유형', '정산방식', 'Type'], firestoreField: 'settlementType', transform: 'normalizeSettlementType' },
  { patterns: ['통장유형', '전용계좌', '전용통장', '운영통장'], firestoreField: 'accountType', transform: 'normalizeAccountType' },
  { patterns: ['소속', '센터', '그룹', '부서', '담당조직'], firestoreField: 'department', transform: 'normalizeString' },
  { patterns: ['팀', '사내기업', 'CIC', '배정희망'], firestoreField: 'teamName', transform: 'normalizeString' },
  { patterns: ['담당자', '담당PM', 'PM', '핵심인력'], firestoreField: 'managerName', transform: 'normalizeString' },
  { patterns: ['수익률', '영업이익률'], firestoreField: 'profitRate', transform: 'normalizePercent' },
  { patterns: ['수익금', '영업이익', '순이익'], firestoreField: 'profitAmount', transform: 'normalizeAmount' },
  { patterns: ['당해년도', '26년', '매출'], firestoreField: 'budgetCurrentYear', transform: 'normalizeAmount' },
  { patterns: ['인건비'], firestoreField: 'laborCost', transform: 'normalizeAmount' },
  // 예산총괄 전용
  { patterns: ['비목'], firestoreField: 'budgetCategory', transform: 'normalizeString' },
  { patterns: ['세목'], firestoreField: 'budgetSubCategory', transform: 'normalizeString' },
  { patterns: ['세세목', '산정 내역'], firestoreField: 'budgetDetail', transform: 'normalizeString' },
  { patterns: ['최초 승인 예산', '최초승인'], firestoreField: 'initialBudget', transform: 'normalizeAmount' },
  { patterns: ['변경 승인 예산', '변경승인'], firestoreField: 'revisedBudget', transform: 'normalizeAmount' },
  { patterns: ['소진금액', '소진액'], firestoreField: 'spentAmount', transform: 'normalizeAmount' },
  { patterns: ['소진율'], firestoreField: 'spentRate', transform: 'normalizePercent' },
  { patterns: ['잔액'], firestoreField: 'remainingBudget', transform: 'normalizeAmount' },
  { patterns: ['매입부가세'], firestoreField: 'vatIn', transform: 'normalizeAmount' },
  { patterns: ['사업비 구분'], firestoreField: 'expenseCategory', transform: 'normalizeString' },
];

const TRANSACTION_RULES: MappingRule[] = [
  { patterns: ['No', '번호'], firestoreField: 'seqNo' },
  { patterns: ['거래일시', '거래일', '일시', '일자'], firestoreField: 'dateTime', transform: 'normalizeDate', confidence: 0.95 },
  { patterns: ['주차', '해당 주차'], firestoreField: 'weekCode', transform: 'normalizeWeekCode' },
  { patterns: ['지출구분', '결제수단', '카드'], firestoreField: 'method', transform: 'normalizePaymentMethod' },
  { patterns: ['비목'], firestoreField: 'budgetCategory', transform: 'normalizeString' },
  { patterns: ['세목'], firestoreField: 'budgetSubCategory', transform: 'normalizeString' },
  { patterns: ['세세목'], firestoreField: 'budgetDetail', transform: 'normalizeString' },
  { patterns: ['cashflow항목', 'cashflow'], firestoreField: 'cashflowCategory', transform: 'normalizeString' },
  { patterns: ['통장잔액', '잔액'], firestoreField: 'amounts.balanceAfter', transform: 'normalizeAmount' },
  { patterns: ['입금액', '입금합계', '입금금액'], firestoreField: 'amounts.depositAmount', transform: 'normalizeAmount' },
  { patterns: ['출금합계', '사업비 사용액', '출금금액', '사용액'], firestoreField: 'amounts.expenseAmount', transform: 'normalizeAmount' },
  { patterns: ['매입부가세 반환', '매입부가세'], firestoreField: 'amounts.vatIn', transform: 'normalizeAmount' },
  { patterns: ['통장에 찍힌', '입/출금액'], firestoreField: 'amounts.bankAmount', transform: 'normalizeAmount' },
  { patterns: ['지급처', '거래처', '의뢰인', '수취인'], firestoreField: 'counterparty', transform: 'normalizeString' },
  { patterns: ['적요', '상세 적요'], firestoreField: 'memo', transform: 'normalizeString' },
  { patterns: ['내통장표시'], firestoreField: 'bankMemo', transform: 'normalizeString' },
  { patterns: ['증빙자료 리스트', '필수증빙'], firestoreField: 'requiredDocs', transform: 'normalizeString' },
  { patterns: ['실제 구비', '구비 완료'], firestoreField: 'completedDocs', transform: 'normalizeString' },
  { patterns: ['준비필요', '준비가 되지않은'], firestoreField: 'pendingDocs', transform: 'normalizeString' },
  { patterns: ['작성자'], firestoreField: 'writer', transform: 'normalizeString' },
  { patterns: ['취급점'], firestoreField: 'branchName', transform: 'normalizeString' },
  { patterns: ['구분'], firestoreField: 'txType', transform: 'normalizeString' },
  // 통장번호 (bank)
  { patterns: ['통장번호'], firestoreField: 'bankAccountSeq' },
];

const MEMBER_RULES: MappingRule[] = [
  { patterns: ['성명', '이름'], firestoreField: 'name', transform: 'normalizeString', confidence: 0.95 },
  { patterns: ['별명', '닉네임'], firestoreField: 'nickname', transform: 'normalizeString' },
  { patterns: ['직급', '직위'], firestoreField: 'title', transform: 'normalizeString' },
  { patterns: ['직책'], firestoreField: 'position', transform: 'normalizeString' },
  { patterns: ['소속 (중분류)', '소속(중분류)', '중분류'], firestoreField: 'department', transform: 'normalizeString' },
  { patterns: ['소속 (소분류)', '소속(소분류)', '소분류'], firestoreField: 'subDepartment', transform: 'normalizeString' },
  { patterns: ['경영커뮤니티', '대분류'], firestoreField: 'division', transform: 'normalizeString' },
  { patterns: ['이메일', 'email'], firestoreField: 'email', transform: 'normalizeString' },
];

const PARTICIPATION_RULES: MappingRule[] = [
  { patterns: ['이름(본명)', '이름', '성명'], firestoreField: 'memberName', transform: 'normalizeString', confidence: 0.95 },
  { patterns: ['별명', '닉네임'], firestoreField: 'nickname', transform: 'normalizeString' },
  { patterns: ['투입율 합계', '투입률 합계', '참여율 합계'], firestoreField: 'totalRate', transform: 'normalizePercent' },
  { patterns: ['투입수 합계', '참여수'], firestoreField: 'totalProjectCount' },
  { patterns: ['투입률', '참여율', '참여율 (100%)'], firestoreField: 'rate', transform: 'normalizePercent' },
  { patterns: ['인건비 배정 기간', '배정기간', '참여기간'], firestoreField: 'period', transform: 'normalizeString' },
  { patterns: ['직무', '역할', '담당 직무'], firestoreField: 'role', transform: 'normalizeString' },
  { patterns: ['총참여기간', '총 참여기간'], firestoreField: 'totalPeriod', transform: 'normalizeString' },
];

const COLLECTION_RULES: Record<string, MappingRule[]> = {
  projects: PROJECT_RULES,
  transactions: TRANSACTION_RULES,
  members: MEMBER_RULES,
  participationEntries: PARTICIPATION_RULES,
};

/**
 * 정적 매핑 실행 (LLM 호출 없음)
 */
export async function mapSchemasStatic(manifests: SheetManifest[]): Promise<SheetMapping[]> {
  const allMappings: SheetMapping[] = [];

  for (const manifest of manifests) {
    for (const sheet of manifest.sheets) {
      if (sheet.profile?.skip) {
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: '',
          columnMappings: [],
          skipped: true,
          skipReason: sheet.profile.hint || 'Marked as skip',
        });
        continue;
      }

      if (!sheet.profile?.targetCollection) {
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: '',
          columnMappings: [],
          skipped: true,
          skipReason: 'No target collection',
        });
        continue;
      }

      const collection = sheet.profile.targetCollection;
      const rules = COLLECTION_RULES[collection];
      if (!rules) {
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: collection,
          columnMappings: [],
          skipped: true,
          skipReason: `No mapping rules for collection: ${collection}`,
        });
        continue;
      }

      console.log(`\n🗺️  [Static Map] ${sheet.name} → ${collection}`);

      // Synthesize headers from headerRows (use shared function for consistency with parseSheet)
      const headers = synthesizeHeaders(sheet.headerRows);
      const mappings = matchHeaders(headers, rules, sheet.name);

      allMappings.push({
        sheetName: sheet.name,
        targetCollection: collection,
        columnMappings: mappings,
        skipped: false,
      });

      const matched = mappings.filter(m => m.firestoreField !== 'unmapped').length;
      console.log(`  → ${matched}/${headers.length} columns mapped`);
    }
  }

  return allMappings;
}

/**
 * 헤더 목록을 규칙과 매치하여 ColumnMapping 생성
 */
function matchHeaders(headers: string[], rules: MappingRule[], sheetName: string): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedFields = new Set<string>();

  for (const header of headers) {
    if (!header || header.startsWith('col_')) {
      // 빈 헤더나 자동 생성 헤더는 skip
      continue;
    }

    let bestMatch: ColumnMapping | null = null;
    let bestScore = 0;

    // 멀티레벨 헤더의 마지막 세그먼트 추출 (e.g. "a > b > c" → "c")
    const segments = header.split(' > ');
    const lastSegment = segments[segments.length - 1].trim();
    const isMultiLevel = segments.length > 1;

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        // 멀티레벨 헤더는 마지막 세그먼트만 신뢰 (앞 세그먼트는 설명/가이드 문구가 많음)
        // 단일 헤더 시트는 전체 문자열 includes 매칭 허용
        let score = 0;
        if (lastSegment.includes(pattern)) {
          // 마지막 세그먼트 매치: 기본 점수 + 보너스 1000
          score = pattern.length + 1000;
        } else if (!isMultiLevel && header.includes(pattern)) {
          // 전체 헤더에서만 매치: 기본 점수만 (마지막 세그먼트 매치보다 항상 낮음)
          score = pattern.length;
        }

        if (score > 0 && score > bestScore && !usedFields.has(rule.firestoreField)) {
          bestScore = score;
          bestMatch = {
            excelColumn: header,
            firestoreField: rule.firestoreField,
            transform: rule.transform,
            confidence: rule.confidence ?? 0.85,
          };
        }
      }
    }

    if (bestMatch) {
      usedFields.add(bestMatch.firestoreField);
      mappings.push(bestMatch);
    }
    // unmapped 컬럼은 건너뜀 (노이즈 줄이기)
  }

  return mappings;
}

// ── cashflow_weeks 전용 매핑은 별도 처리 필요 ──
// cashflow는 행=항목, 열=주차 구조여서 일반 column mapping이 안 맞음
// → extract 단계에서 피벗 변환 필요
