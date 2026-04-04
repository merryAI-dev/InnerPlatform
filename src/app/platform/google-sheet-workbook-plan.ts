import { normalizeSpace } from './csv-utils';
import {
  describeGoogleSheetMigrationTarget,
  type GoogleSheetMigrationTarget,
} from './google-sheet-migration';

export type GoogleSheetRuleFamily =
  | 'BANK_STATEMENT'
  | 'USAGE_LEDGER'
  | 'BUDGET_PLAN'
  | 'CASHFLOW'
  | 'EVIDENCE_RULES'
  | 'GROUP_BANK_STATEMENT'
  | 'GROUP_LEDGER'
  | 'GROUP_BUDGET'
  | 'GROUP_CASHFLOW'
  | 'PARTICIPATION'
  | 'WITHHOLDING_TAX'
  | 'OPTIONAL_TRAVEL_LEDGER'
  | 'REFERENCE'
  | 'UNKNOWN';

export type GoogleSheetWorkbookWave = 'CORE' | 'GROUP' | 'AUXILIARY' | 'REFERENCE';
export type GoogleSheetWorkbookConfidence = 'high' | 'medium' | 'low';

export interface GoogleSheetWorkbookSheetPlan {
  sheetName: string;
  target: GoogleSheetMigrationTarget;
  family: GoogleSheetRuleFamily;
  wave: GoogleSheetWorkbookWave;
  priority: number;
  confidence: GoogleSheetWorkbookConfidence;
  dependencies: GoogleSheetRuleFamily[];
  notes: string[];
}

export interface GoogleSheetWorkbookDependencyGap {
  sheetName: string;
  family: GoogleSheetRuleFamily;
  missingFamilies: GoogleSheetRuleFamily[];
}

export interface GoogleSheetWorkbookWaveSummary {
  wave: GoogleSheetWorkbookWave;
  sheetNames: string[];
  families: GoogleSheetRuleFamily[];
}

export interface GoogleSheetWorkbookPlan {
  sheets: GoogleSheetWorkbookSheetPlan[];
  executionOrder: GoogleSheetWorkbookSheetPlan[];
  waveSummaries: GoogleSheetWorkbookWaveSummary[];
  missingDependencies: GoogleSheetWorkbookDependencyGap[];
  unknownSheets: string[];
}

export const GOOGLE_SHEET_RULE_FAMILY_LABELS: Record<GoogleSheetRuleFamily, string> = {
  BANK_STATEMENT: '통장 원본',
  USAGE_LEDGER: '사용내역/지출대장',
  BUDGET_PLAN: '예산총괄',
  CASHFLOW: '캐시플로우',
  EVIDENCE_RULES: '증빙 규칙',
  GROUP_BANK_STATEMENT: '그룹 통장원본',
  GROUP_LEDGER: '그룹 지출대장',
  GROUP_BUDGET: '그룹 예산',
  GROUP_CASHFLOW: '그룹 캐시플로우',
  PARTICIPATION: '참여율/인력',
  WITHHOLDING_TAX: '원천세 계산기',
  OPTIONAL_TRAVEL_LEDGER: '옵션 사용내역',
  REFERENCE: '참고/안내',
  UNKNOWN: '미분류',
};

const FAMILY_CONFIG: Record<
  GoogleSheetRuleFamily,
  {
    wave: GoogleSheetWorkbookWave;
    priority: number;
    confidence: GoogleSheetWorkbookConfidence;
    dependencies: GoogleSheetRuleFamily[];
  }
> = {
  BANK_STATEMENT: {
    wave: 'CORE',
    priority: 10,
    confidence: 'high',
    dependencies: [],
  },
  USAGE_LEDGER: {
    wave: 'CORE',
    priority: 20,
    confidence: 'high',
    dependencies: [],
  },
  BUDGET_PLAN: {
    wave: 'CORE',
    priority: 30,
    confidence: 'high',
    dependencies: ['USAGE_LEDGER'],
  },
  CASHFLOW: {
    wave: 'CORE',
    priority: 40,
    confidence: 'high',
    dependencies: ['USAGE_LEDGER'],
  },
  EVIDENCE_RULES: {
    wave: 'CORE',
    priority: 50,
    confidence: 'high',
    dependencies: [],
  },
  GROUP_BANK_STATEMENT: {
    wave: 'GROUP',
    priority: 60,
    confidence: 'medium',
    dependencies: [],
  },
  GROUP_LEDGER: {
    wave: 'GROUP',
    priority: 70,
    confidence: 'high',
    dependencies: [],
  },
  GROUP_BUDGET: {
    wave: 'GROUP',
    priority: 80,
    confidence: 'high',
    dependencies: ['GROUP_LEDGER'],
  },
  GROUP_CASHFLOW: {
    wave: 'GROUP',
    priority: 90,
    confidence: 'high',
    dependencies: ['GROUP_LEDGER'],
  },
  PARTICIPATION: {
    wave: 'AUXILIARY',
    priority: 100,
    confidence: 'medium',
    dependencies: [],
  },
  WITHHOLDING_TAX: {
    wave: 'AUXILIARY',
    priority: 110,
    confidence: 'medium',
    dependencies: [],
  },
  OPTIONAL_TRAVEL_LEDGER: {
    wave: 'AUXILIARY',
    priority: 120,
    confidence: 'medium',
    dependencies: ['USAGE_LEDGER'],
  },
  REFERENCE: {
    wave: 'REFERENCE',
    priority: 900,
    confidence: 'low',
    dependencies: [],
  },
  UNKNOWN: {
    wave: 'REFERENCE',
    priority: 999,
    confidence: 'low',
    dependencies: [],
  },
};

function normalizeSheetName(sheetName: string): string {
  return normalizeSpace(sheetName).replace(/\s+/g, '').toLowerCase();
}

export function classifyGoogleSheetRuleFamily(sheetName: string): GoogleSheetRuleFamily {
  const normalized = normalizeSheetName(sheetName);
  if (!normalized) return 'UNKNOWN';

  if (normalized.includes('그룹통장내역')) return 'GROUP_BANK_STATEMENT';
  if (normalized.includes('그룹지출대장')) return 'GROUP_LEDGER';
  if (normalized.includes('그룹예산')) return 'GROUP_BUDGET';
  if (normalized.includes('그룹cashflow')) return 'GROUP_CASHFLOW';

  if (normalized.includes('예산총괄')) return 'BUDGET_PLAN';
  if (normalized.includes('비목별증빙자료') || normalized.includes('증빙서류')) return 'EVIDENCE_RULES';
  if (normalized.includes('인력투입률')) return 'PARTICIPATION';
  if (normalized.includes('원천세계산기')) return 'WITHHOLDING_TAX';
  if (normalized.includes('해외출장') || normalized.includes('별도관리시트')) return 'OPTIONAL_TRAVEL_LEDGER';
  if (normalized.includes('cashflow')) return 'CASHFLOW';
  if (normalized.includes('사용내역') || normalized.includes('지출대장') || normalized.includes('비용사용내역')) {
    return 'USAGE_LEDGER';
  }
  if (normalized.includes('통장내역')) return 'BANK_STATEMENT';
  if (
    normalized.includes('faq')
    || normalized.includes('안내사항')
    || normalized.includes('정산보완요청')
    || normalized.includes('최종정산제출')
  ) {
    return 'REFERENCE';
  }
  return 'UNKNOWN';
}

function buildSheetNotes(sheetName: string, family: GoogleSheetRuleFamily): string[] {
  const normalized = normalizeSheetName(sheetName);
  const notes: string[] = [];

  if (family === 'USAGE_LEDGER' && normalized.includes('취소내역')) {
    notes.push('취소/환입 컬럼까지 포함된 원장이라 net calculation 기준 시트로 다뤄야 합니다.');
  }
  if (family === 'CASHFLOW' && normalized.includes('가이드')) {
    notes.push('guide 성격의 cashflow 탭이므로 projection/설명 규칙과 actual 규칙을 분리해 다뤄야 합니다.');
  }
  if (family === 'REFERENCE') {
    notes.push('직접 반영보다 preview/reference 용도로 취급하는 것이 안전합니다.');
  }
  if (family === 'UNKNOWN') {
    notes.push('자동 분류 규칙에 걸리지 않았습니다. manual triage가 필요합니다.');
  }
  return notes;
}

export function planGoogleSheetWorkbook(sheetNames: string[]): GoogleSheetWorkbookPlan {
  const sheets = sheetNames.map((sheetName) => {
    const family = classifyGoogleSheetRuleFamily(sheetName);
    const target = describeGoogleSheetMigrationTarget(sheetName).target;
    const config = FAMILY_CONFIG[family];
    return {
      sheetName,
      target,
      family,
      wave: config.wave,
      priority: config.priority,
      confidence: config.confidence,
      dependencies: [...config.dependencies],
      notes: buildSheetNotes(sheetName, family),
    } satisfies GoogleSheetWorkbookSheetPlan;
  });

  const executionOrder = [...sheets].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.sheetName.localeCompare(right.sheetName, 'ko');
  });

  const presentFamilies = new Set(
    sheets
      .map((sheet) => sheet.family)
      .filter((family) => family !== 'REFERENCE' && family !== 'UNKNOWN'),
  );

  const missingDependencies = executionOrder
    .map((sheet) => {
      const missingFamilies = sheet.dependencies.filter((family) => !presentFamilies.has(family));
      return missingFamilies.length > 0
        ? {
            sheetName: sheet.sheetName,
            family: sheet.family,
            missingFamilies,
          } satisfies GoogleSheetWorkbookDependencyGap
        : null;
    })
    .filter((item): item is GoogleSheetWorkbookDependencyGap => Boolean(item));

  const waveOrder: GoogleSheetWorkbookWave[] = ['CORE', 'GROUP', 'AUXILIARY', 'REFERENCE'];
  const waveSummaries = waveOrder.map((wave) => {
    const waveSheets = executionOrder.filter((sheet) => sheet.wave === wave);
    return {
      wave,
      sheetNames: waveSheets.map((sheet) => sheet.sheetName),
      families: Array.from(new Set(waveSheets.map((sheet) => sheet.family))),
    } satisfies GoogleSheetWorkbookWaveSummary;
  });

  return {
    sheets,
    executionOrder,
    waveSummaries,
    missingDependencies,
    unknownSheets: sheets.filter((sheet) => sheet.family === 'UNKNOWN').map((sheet) => sheet.sheetName),
  };
}
