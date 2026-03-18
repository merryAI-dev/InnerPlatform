/**
 * Step 3: Data Extraction Agent
 * SheetMapping 기반으로 데이터 추출 + 정규화
 */
import { parseSheet } from '../parsers/excel-reader.js';
import ExcelJS from 'exceljs';
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
    if (mapping.skipped) continue;

    console.log(`\n📥 [Extract] ${mapping.sheetName} → ${mapping.targetCollection}`);

    try {
      if (isParticipationMatrixSheet(mapping.sheetName)) {
        const special = await extractParticipationMatrixSheet(filePath, mapping.sheetName);
        console.log(`  → ${special.records.length} records extracted (0 errors from ${special.stats.total} rows)`);
        results.push({
          sheetName: mapping.sheetName,
          targetCollection: mapping.targetCollection,
          records: special.records,
          errors: [],
          stats: special.stats,
        });
        continue;
      }

      if (mapping.columnMappings.length === 0) {
        continue;
      }

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

function isParticipationMatrixSheet(sheetName: string): boolean {
  return sheetName.includes('100-1.참여율(전체)');
}

async function extractParticipationMatrixSheet(
  filePath: string,
  sheetName: string,
): Promise<{ records: ExtractedRecord[]; stats: { total: number; extracted: number; errored: number } }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const mergedMap = buildMergedCellMap(ws);
  const colCount = ws.columnCount;
  const rowCount = ws.rowCount;

  const rowProject = 4;
  const rowClientOrg = 5;
  const rowDepartment = 6;
  const rowSpecial = 7;
  const rowStage = 8;
  const rowHeader = 9;
  const dataStartRow = 10;

  const groupStarts: number[] = [];
  for (let c = 5; c <= colCount - 2; c++) {
    const hName = normalizeSpace(asString(getCellValue(ws, mergedMap, rowHeader, c)));
    const hRate = normalizeSpace(asString(getCellValue(ws, mergedMap, rowHeader, c + 1)));
    if (!hName.includes('이름')) continue;
    if (!/(참여율|투입률|투입율)/.test(hRate)) continue;
    groupStarts.push(c);
    c += 2;
  }

  const summaryByName = new Map<string, {
    nickname: string | null;
    totalRate: number | null;
    totalProjectCount: number | null;
  }>();

  for (let r = dataStartRow; r <= rowCount; r++) {
    const name = N.normalizeString(getCellValue(ws, mergedMap, r, 1));
    if (!name) continue;
    summaryByName.set(name, {
      nickname: N.normalizeString(getCellValue(ws, mergedMap, r, 2)),
      totalRate: normalizeParticipationRate(getCellValue(ws, mergedMap, r, 3)),
      totalProjectCount: N.normalizeAmount(getCellValue(ws, mergedMap, r, 4)),
    });
  }

  const records: ExtractedRecord[] = [];
  let consecutiveEmptyRows = 0;

  for (let r = dataStartRow; r <= rowCount; r++) {
    let rowHasEntry = false;

    for (const c of groupStarts) {
      const memberName = N.normalizeString(getCellValue(ws, mergedMap, r, c));
      const rawRate = getCellValue(ws, mergedMap, r, c + 1);
      const period = N.normalizeString(getCellValue(ws, mergedMap, r, c + 2));

      const rate = normalizeParticipationRate(rawRate);
      const hasPayload = !!memberName || rate != null || !!period;
      if (!hasPayload) continue;

      rowHasEntry = true;
      if (!memberName) continue;
      if (memberName.startsWith('※')) continue;

      const projectName = N.normalizeString(getCellValue(ws, mergedMap, rowProject, c));
      const clientOrg = N.normalizeString(getCellValue(ws, mergedMap, rowClientOrg, c));
      const department = N.normalizeString(getCellValue(ws, mergedMap, rowDepartment, c));
      const specialNote = N.normalizeString(getCellValue(ws, mergedMap, rowSpecial, c));
      const stage = N.normalizeString(getCellValue(ws, mergedMap, rowStage, c));

      const summary = summaryByName.get(memberName);
      const totalProjectCountRaw = summary?.totalProjectCount;
      const totalProjectCount = totalProjectCountRaw == null ? null : Math.trunc(totalProjectCountRaw);

      records.push({
        _source: { sheet: sheetName, row: r },
        memberName,
        nickname: summary?.nickname ?? null,
        totalRate: summary?.totalRate ?? null,
        totalProjectCount,
        projectName,
        clientOrg,
        department,
        note: specialNote,
        stage,
        rate,
        period,
      });
    }

    if (rowHasEntry) {
      consecutiveEmptyRows = 0;
    } else {
      consecutiveEmptyRows++;
      // 매트릭스 데이터 종료 이후 긴 빈 구간을 만나면 중단
      if (consecutiveEmptyRows >= 30) break;
    }
  }

  return {
    records,
    stats: {
      total: Math.max(0, rowCount - dataStartRow + 1),
      extracted: records.length,
      errored: 0,
    },
  };
}

function getCellValue(
  ws: ExcelJS.Worksheet,
  mergedMap: Map<string, unknown>,
  row: number,
  col: number,
): unknown {
  const merged = mergedMap.get(`${row}:${col}`);
  if (merged !== undefined) return merged;
  return extractCellValue(ws.getCell(row, col).value);
}

function buildMergedCellMap(ws: ExcelJS.Worksheet): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const merges = ws.model.merges || [];
  for (const range of merges) {
    const parsed = parseRange(String(range));
    if (!parsed) continue;
    const topLeft = extractCellValue(ws.getCell(parsed.startRow, parsed.startCol).value);
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
      for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        if (r === parsed.startRow && c === parsed.startCol) continue;
        map.set(`${r}:${c}`, topLeft);
      }
    }
  }
  return map;
}

function extractCellValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray((obj as any).richText)) {
      return ((obj as any).richText as Array<{ text: string }>).map((t) => t.text).join('');
    }
    if ('result' in obj) {
      const result = (obj as any).result;
      if (result && typeof result === 'object' && 'error' in (result as any)) return null;
      return result ?? null;
    }
    if ('sharedFormula' in obj || 'formula' in obj) return null;
    if ('text' in obj && typeof obj.text === 'string') return obj.text;
    if ('error' in obj) return null;
  }
  return raw;
}

function parseRange(range: string): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  return {
    startCol: colToNum(m[1]),
    startRow: parseInt(m[2], 10),
    endCol: colToNum(m[3]),
    endRow: parseInt(m[4], 10),
  };
}

function colToNum(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function normalizeSpace(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

/**
 * 참여율 정규화 (100-1 매트릭스 전용)
 * - Excel 퍼센트 셀(10% → 0.1, 103% → 1.03)은 그대로 유지
 * - 10, 35 같은 정수 퍼센트는 0.10, 0.35로 변환
 * - "35%" 문자열은 0.35로 변환
 */
function normalizeParticipationRate(raw: unknown): number | null {
  if (raw == null) return null;

  if (typeof raw === 'number') {
    if (!isFinite(raw)) return null;
    if (raw >= 0 && raw <= 2) return raw;
    if (raw > 2 && raw <= 100) return raw / 100;
    return raw / 100;
  }

  const s = String(raw).trim();
  if (!s) return null;
  const hasPercentSign = s.includes('%');
  const n = Number.parseFloat(s.replace(/[%\s]/g, '').replace(/,/g, ''));
  if (!isFinite(n)) return null;
  if (hasPercentSign) return n / 100;
  if (n >= 0 && n <= 2) return n;
  if (n > 2 && n <= 100) return n / 100;
  return n / 100;
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
