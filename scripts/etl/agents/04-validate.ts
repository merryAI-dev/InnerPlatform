/**
 * Step 4: Validation Agent
 * LLM 기반 데이터 검증 + 정제
 */
import { askClaudeJSON } from '../llm/claude.js';
import type { ExtractionResult, ExtractedRecord } from './03-extract.js';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  sheet: string;
  row?: number;
  field?: string;
  message: string;
  suggestion?: string;
}

export interface ValidationReport {
  collection: string;
  sheetName: string;
  issues: ValidationIssue[];
  cleanedRecords: ExtractedRecord[];
  stats: {
    inputRecords: number;
    outputRecords: number;
    errors: number;
    warnings: number;
  };
}

const BATCH_SIZE = 20; // LLM에 한 번에 보내는 레코드 수

export async function validateData(
  extractions: ExtractionResult[],
  options: { useLLM?: boolean } = {},
): Promise<ValidationReport[]> {
  const reports: ValidationReport[] = [];

  for (const extraction of extractions) {
    if (extraction.records.length === 0) continue;

    console.log(`\n🔍 [Validate] ${extraction.sheetName} (${extraction.records.length} records)`);

    const issues: ValidationIssue[] = [];
    const cleanedRecords: ExtractedRecord[] = [];

    // Rule-based validation (always)
    for (const record of extraction.records) {
      const recordIssues = validateRecord(record, extraction.targetCollection, extraction.sheetName);
      issues.push(...recordIssues);

      // Only keep records without errors
      const hasErrors = recordIssues.some(i => i.severity === 'error');
      if (!hasErrors) {
        cleanedRecords.push(record);
      }
    }

    // LLM-based validation (optional, for first batch)
    if (options.useLLM && extraction.records.length > 0) {
      const sample = extraction.records.slice(0, BATCH_SIZE);
      try {
        const llmIssues = await llmValidate(sample, extraction.targetCollection, extraction.sheetName);
        issues.push(...llmIssues);
      } catch (err) {
        console.warn(`  ⚠️  LLM validation skipped: ${(err as Error).message}`);
      }
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    console.log(`  → ${cleanedRecords.length}/${extraction.records.length} clean, ${errors} errors, ${warnings} warnings`);

    reports.push({
      collection: extraction.targetCollection,
      sheetName: extraction.sheetName,
      issues,
      cleanedRecords,
      stats: {
        inputRecords: extraction.records.length,
        outputRecords: cleanedRecords.length,
        errors,
        warnings,
      },
    });
  }

  return reports;
}

// ── Rule-based validation ──

function validateRecord(record: ExtractedRecord, collection: string, sheetName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const row = record._source?.row;

  switch (collection) {
    case 'projects':
      // Budget breakdown rows (예산총괄, 그룹예산) don't have a project name — that's OK
      if (!record.name && !record.budgetCategory && !record.budgetSubCategory && !record.budgetDetail && !record.expenseCategory) {
        issues.push({ severity: 'error', sheet: sheetName, row, field: 'name', message: '사업명 누락' });
      }
      if (record.contractAmount != null && typeof record.contractAmount === 'number' && record.contractAmount < 0) {
        issues.push({ severity: 'warning', sheet: sheetName, row, field: 'contractAmount', message: `음수 계약금액: ${record.contractAmount}` });
      }
      if (record.profitRate != null && typeof record.profitRate === 'number' && (record.profitRate < 0 || record.profitRate > 1)) {
        issues.push({ severity: 'warning', sheet: sheetName, row, field: 'profitRate', message: `비정상 수익률: ${record.profitRate}` });
      }
      break;

    case 'transactions':
      // Some transaction sheets use weekCode instead of dateTime (사용내역 uses 주차)
      if (!record.dateTime && !record.weekCode) {
        issues.push({ severity: 'error', sheet: sheetName, row, field: 'dateTime', message: '거래일시 또는 주차 누락' });
      }
      if (!record.method) {
        issues.push({ severity: 'error', sheet: sheetName, row, field: 'method', message: '결제수단 누락' });
      }
      {
        const amounts = (record.amounts && typeof record.amounts === 'object')
          ? (record.amounts as Record<string, unknown>)
          : {};
        const hasAnyAmount =
          amounts.expenseAmount != null ||
          amounts.depositAmount != null ||
          amounts.bankAmount != null ||
          amounts.balanceAfter != null;
        if (!hasAnyAmount) {
          issues.push({ severity: 'error', sheet: sheetName, row, field: 'amounts', message: '거래금액 계열 필드 누락' });
        }
      }
      break;

    case 'members':
      if (!record.name) {
        issues.push({ severity: 'error', sheet: sheetName, row, field: 'name', message: '성명 누락' });
      }
      break;

    case 'participationEntries':
      if (!record.memberName) {
        issues.push({ severity: 'error', sheet: sheetName, row, field: 'memberName', message: '참여자명 누락' });
      }
      if (record.rate != null && typeof record.rate === 'number' && (record.rate < 0 || record.rate > 100)) {
        issues.push({ severity: 'warning', sheet: sheetName, row, field: 'rate', message: `비정상 참여율: ${record.rate}%` });
      }
      break;
  }

  return issues;
}

// ── LLM-based validation ──

async function llmValidate(
  records: ExtractedRecord[],
  collection: string,
  sheetName: string,
): Promise<ValidationIssue[]> {
  const sample = records.slice(0, BATCH_SIZE).map(r => {
    const { _source, ...fields } = r;
    return fields;
  });

  const prompt = `## Task
You are validating data extracted from Korean business management Excel sheets for Firestore import.
Review these ${sample.length} records for the "${collection}" collection (source: "${sheetName}").

## Records
${JSON.stringify(sample, null, 2)}

## Validation Rules
1. Check for missing required fields
2. Flag obvious data quality issues (wrong types, impossible values)
3. Check Korean text for truncation or encoding issues
4. Check numeric values for reasonableness (e.g., project amounts typically 1M~10B KRW)
5. Check date ranges for logic (start before end)

## Response Format
\`\`\`json
{
  "issues": [
    {
      "severity": "warning",
      "field": "contractAmount",
      "message": "금액이 비정상적으로 높음 (100억 초과)",
      "suggestion": "단위 확인 필요 (원 vs 천원)"
    }
  ]
}
\`\`\`
Return empty issues array if no problems found.`;

  const result = await askClaudeJSON<{ issues: Omit<ValidationIssue, 'sheet'>[] }>(prompt, {
    system: 'You are a Korean business data quality analyst. Validate data records and report issues in JSON.',
    maxTokens: 2048,
  });

  return (result.issues || []).map(i => ({ ...i, sheet: sheetName }));
}
