/**
 * Step 3: Data Extraction Agent
 * SheetMapping 기반으로 데이터 추출 + 정규화
 */
import { parseSheet } from '../parsers/excel-reader.js';
import * as N from '../parsers/normalizers.js';
import { findSheetProfile } from '../config/sheet-profiles.js';
import type { SheetMapping, ColumnMapping } from './02-map-schema.js';

export interface ExtractedRecord {
  _source: { sheet: string; row: number };
  [key: string]: unknown;
}

export interface ExtractionResult {
  sheetName: string;
  targetCollection: string;
  records: ExtractedRecord[];
  errors: string[];
  stats: { total: number; extracted: number; errored: number };
}

const TRANSFORM_MAP: Record<string, (v: unknown) => unknown> = {
  normalizeDate: N.normalizeDate,
  normalizeAmount: N.normalizeAmount,
  normalizePercent: N.normalizePercent,
  normalizePaymentMethod: N.normalizePaymentMethod,
  normalizeProjectStatus: N.normalizeProjectStatus,
  normalizeProjectType: N.normalizeProjectType,
  normalizeSettlementType: N.normalizeSettlementType,
  normalizeAccountType: N.normalizeAccountType,
  normalizeString: N.normalizeString,
  normalizeWeekCode: N.normalizeWeekCode,
};

export async function extractData(
  filePath: string,
  mappings: SheetMapping[],
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];

  for (const mapping of mappings) {
    if (mapping.skipped || mapping.columnMappings.length === 0) continue;

    console.log(`\n📥 [Extract] ${mapping.sheetName} → ${mapping.targetCollection}`);

    try {
      // Use profile overrides for header/data boundaries
      const profile = findSheetProfile(mapping.sheetName);
      const parsed = await parseSheet(filePath, mapping.sheetName, {
        headerRowCount: profile?.headerRowCount,
        headerStartRow: profile?.headerStartRow,
        dataStartRow: profile?.dataStartRow,
      });

      // Build column resolver: mapping.excelColumn → actual parsed header key
      const colResolver = buildColumnResolver(parsed.headers, mapping.columnMappings);

      const records: ExtractedRecord[] = [];
      const errors: string[] = [];
      let errored = 0;

      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        try {
          const record = applyMappings(row, mapping.columnMappings, colResolver);
          const mappedValues = Object.entries(record)
            .filter(([k]) => !k.startsWith('_'))
            .map(([, v]) => v);
          // Skip records where all mapped fields are null
          if (mappedValues.every(v => v == null)) continue;

          // Collection-specific guardrails: drop low-confidence/summary rows before validation
          if (!shouldKeepRecord(record, mapping.targetCollection)) continue;

          record._source = { sheet: mapping.sheetName, row: i + 1 };
          records.push(record);
        } catch (err) {
          errored++;
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      console.log(`  → ${records.length} records extracted (${errored} errors from ${parsed.rows.length} rows)`);

      results.push({
        sheetName: mapping.sheetName,
        targetCollection: mapping.targetCollection,
        records,
        errors,
        stats: { total: parsed.rows.length, extracted: records.length, errored },
      });
    } catch (err) {
      console.error(`  ❌ Extraction failed: ${(err as Error).message}`);
      results.push({
        sheetName: mapping.sheetName,
        targetCollection: mapping.targetCollection,
        records: [],
        errors: [(err as Error).message],
        stats: { total: 0, extracted: 0, errored: 1 },
      });
    }
  }

  return results;
}

/**
 * Build a resolver map: mapping.excelColumn → actual parsed header key
 * Handles cases where header synthesis produces slightly different strings
 * between discovery (Step 1) and parsing (Step 3)
 */
function buildColumnResolver(
  parsedHeaders: string[],
  columnMappings: ColumnMapping[],
): Map<string, string> {
  const resolver = new Map<string, string>();

  for (const mapping of columnMappings) {
    const target = mapping.excelColumn;

    // 1. Exact match
    if (parsedHeaders.includes(target)) {
      resolver.set(target, target);
      continue;
    }

    // 2. Match by last segment (after last ' > ')
    const targetSegs = target.split(' > ');
    const targetLast = targetSegs[targetSegs.length - 1].trim();

    const candidates = parsedHeaders.filter(h => {
      const segs = h.split(' > ');
      return segs[segs.length - 1].trim() === targetLast;
    });

    if (candidates.length === 1) {
      resolver.set(target, candidates[0]);
      continue;
    }

    // 3. Multiple candidates — match by second-to-last segment too
    if (candidates.length > 1 && targetSegs.length > 1) {
      const targetPrev = targetSegs[targetSegs.length - 2]?.trim();
      const refined = candidates.filter(h => {
        const segs = h.split(' > ');
        return segs.length > 1 && segs[segs.length - 2]?.trim().includes(targetPrev);
      });
      if (refined.length >= 1) {
        resolver.set(target, refined[0]);
        continue;
      }
    }

    // 4. Contains match — normalized (collapse whitespace)
    const normTarget = target.replace(/\s+/g, '');
    for (const h of parsedHeaders) {
      const normH = h.replace(/\s+/g, '');
      if (normH.includes(normTarget) || normTarget.includes(normH)) {
        resolver.set(target, h);
        break;
      }
    }
  }

  return resolver;
}

function applyMappings(
  row: Record<string, unknown>,
  columnMappings: ColumnMapping[],
  colResolver: Map<string, string>,
): ExtractedRecord {
  const record: ExtractedRecord = { _source: { sheet: '', row: 0 } };

  for (const mapping of columnMappings) {
    if (mapping.firestoreField === 'unmapped') continue;
    if (mapping.confidence < 0.3) continue;

    // Use resolver to find the actual row key
    const resolvedKey = colResolver.get(mapping.excelColumn) ?? mapping.excelColumn;
    const rawValue = row[resolvedKey];

    // Apply transform if specified
    let value: unknown = rawValue;
    if (mapping.transform && TRANSFORM_MAP[mapping.transform]) {
      value = TRANSFORM_MAP[mapping.transform](rawValue);
    }

    // Handle nested fields (e.g., "amounts.bankAmount")
    const parts = mapping.firestoreField.split('.');
    if (parts.length === 1) {
      record[parts[0]] = value;
    } else {
      // Build nested object
      let current: any = record;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }
  }

  return record;
}

function shouldKeepRecord(record: ExtractedRecord, collection: string): boolean {
  switch (collection) {
    case 'transactions': {
      const hasDateOrWeek = isPresent(record.dateTime) || isPresent(record.weekCode);
      const hasMethod = isPresent(record.method);
      const amounts = (record.amounts && typeof record.amounts === 'object')
        ? (record.amounts as Record<string, unknown>)
        : {};
      const hasAnyAmount =
        amounts.expenseAmount != null ||
        amounts.depositAmount != null ||
        amounts.bankAmount != null ||
        amounts.balanceAfter != null;
      return hasDateOrWeek && hasMethod && hasAnyAmount;
    }

    case 'projects': {
      // Skip meta/aggregate rows without project or budget identity keys.
      const hasIdentity =
        isPresent(record.name) ||
        isPresent(record.clientOrg) ||
        isPresent(record.budgetCategory) ||
        isPresent(record.budgetSubCategory) ||
        isPresent(record.budgetDetail) ||
        isPresent(record.expenseCategory);
      return hasIdentity;
    }

    default:
      return true;
  }
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}
