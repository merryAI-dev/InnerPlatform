/**
 * ExcelJS wrapper — 병합셀 해제, 다중행 헤더 해석, 데이터 추출
 */
import ExcelJS from 'exceljs';

export interface CellInfo {
  value: unknown;
  row: number;
  col: number;
  isMerged: boolean;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  colCount: number;
  mergedCellCount: number;
  mergedRanges: string[];
  headerRows: string[][];    // 상위 N행의 셀 값
  sampleRows: string[][];    // 헤더 이후 데이터 샘플 (최대 5행)
  dataStartRow: number;      // 실제 데이터 시작 행 (1-indexed)
  headerRowCount: number;    // 헤더 행 수
}

export interface ParsedSheet {
  name: string;
  headers: string[];         // 최종 합성 헤더 (다중행 → 단일행)
  rows: Record<string, unknown>[];  // header key → value
  rawRows: unknown[][];      // 원본 행 데이터
}

/**
 * Excel 파일의 모든 시트 정보를 빠르게 스캔
 */
export async function discoverSheets(
  filePath: string,
  options?: {
    maxHeaderRows?: number;
    maxSampleRows?: number;
    /** Per-sheet overrides for header/data boundaries */
    overrides?: Map<string, { headerRowCount?: number; headerStartRow?: number; dataStartRow?: number }>;
  },
): Promise<SheetInfo[]> {
  const maxHeaderRows = options?.maxHeaderRows ?? 5;
  const maxSampleRows = options?.maxSampleRows ?? 5;
  const overrides = options?.overrides;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const results: SheetInfo[] = [];

  for (const ws of wb.worksheets) {
    const mergedRanges = Object.keys(ws.model.merges || {});
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;

    // Skip empty sheets
    if (rowCount < 2) continue;

    // Check for profile overrides
    const override = overrides?.get(ws.name);

    // Unmerge and propagate values for reading
    const scanDepth = Math.min(rowCount, maxHeaderRows + maxSampleRows + 10);
    const allRows = readRowsRaw(ws, 1, scanDepth, colCount);

    // Use overrides if available, otherwise auto-detect
    let headerRowCount: number;
    let headerStartIdx: number; // 0-indexed
    let dataStartRow: number;
    if (override?.headerRowCount != null && override?.dataStartRow != null) {
      headerRowCount = override.headerRowCount;
      headerStartIdx = (override.headerStartRow ?? 1) - 1;
      dataStartRow = override.dataStartRow;
    } else {
      const detected = detectHeaderBoundary(allRows, maxHeaderRows);
      headerRowCount = override?.headerRowCount ?? detected.headerRowCount;
      headerStartIdx = (override?.headerStartRow ?? 1) - 1;
      dataStartRow = override?.dataStartRow ?? detected.dataStartRow;
    }

    const headerRows = allRows.slice(headerStartIdx, headerStartIdx + headerRowCount).map(row =>
      row.map(v => cleanHeader(v))
    );

    const sampleRows = allRows.slice(dataStartRow - 1, dataStartRow - 1 + maxSampleRows).map(row =>
      row.map(v => v == null ? '' : String(v).trim().replace(/\n/g, ' ').slice(0, 60))
    );

    results.push({
      name: ws.name,
      rowCount,
      colCount,
      mergedCellCount: mergedRanges.length,
      mergedRanges: mergedRanges.slice(0, 10), // 최대 10개만
      headerRows,
      sampleRows,
      dataStartRow,
      headerRowCount,
    });
  }

  return results;
}

/**
 * 특정 시트의 전체 데이터를 파싱
 */
export async function parseSheet(
  filePath: string,
  sheetName: string,
  options?: {
    headerRowCount?: number;
    headerStartRow?: number;  // 1-indexed, default 1
    dataStartRow?: number;
    maxRows?: number;
  },
): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const colCount = ws.columnCount;
  const rowCount = ws.rowCount;

  // Read ALL rows as raw values (unmerge first)
  const allRows = readRowsRaw(ws, 1, rowCount, colCount);

  const headerStartRow = (options?.headerStartRow ?? 1) - 1; // convert to 0-indexed
  const headerRowCount = options?.headerRowCount ?? detectHeaderBoundary(allRows, 5).headerRowCount;
  const dataStartRow = options?.dataStartRow ?? (headerStartRow + headerRowCount + 1);

  // Synthesize multi-row headers into single row
  const headers = synthesizeHeaders(allRows.slice(headerStartRow, headerStartRow + headerRowCount));

  // Extract data rows
  const maxRows = options?.maxRows ?? rowCount;
  const dataRows = allRows.slice(dataStartRow - 1, dataStartRow - 1 + maxRows);

  const rows: Record<string, unknown>[] = [];
  for (const row of dataRows) {
    // Skip completely empty rows
    if (row.every(v => v == null || String(v).trim() === '')) continue;

    const record: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] || `col_${i + 1}`;
      record[key] = row[i] ?? null;
    }
    rows.push(record);
  }

  return { name: sheetName, headers, rows, rawRows: dataRows };
}

// ── Internal helpers ──

function readRowsRaw(ws: ExcelJS.Worksheet, startRow: number, endRow: number, colCount: number): unknown[][] {
  // Build merged-cell value map
  const mergedMap = buildMergedCellMap(ws);

  const result: unknown[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: unknown[] = [];
    for (let c = 1; c <= colCount; c++) {
      // Check merged cell map first
      const mergeKey = `${r}:${c}`;
      if (mergedMap.has(mergeKey)) {
        row.push(mergedMap.get(mergeKey));
        continue;
      }
      const cell = ws.getCell(r, c);
      row.push(extractCellValue(cell));
    }
    result.push(row);
  }
  return result;
}

function extractCellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v == null) return null;
  // ExcelJS wraps rich text in { richText: [...] }
  if (typeof v === 'object' && 'richText' in (v as any)) {
    return ((v as any).richText as { text: string }[]).map(t => t.text).join('');
  }
  // Formula with cached result
  if (typeof v === 'object' && 'result' in (v as any)) {
    const result = (v as any).result;
    // Nested error in formula result
    if (result && typeof result === 'object' && 'error' in result) return null;
    return result ?? null;
  }
  // Shared formula reference (no cached result) — return null rather than formula object
  if (typeof v === 'object' && ('sharedFormula' in (v as any) || 'formula' in (v as any))) {
    return null;
  }
  // Error value
  if (typeof v === 'object' && 'error' in (v as any)) {
    return null; // #REF!, #N/A, etc → null
  }
  // Date objects → ISO string
  if (v instanceof Date) {
    return v.toISOString().split('T')[0]; // YYYY-MM-DD
  }
  return v;
}

function buildMergedCellMap(ws: ExcelJS.Worksheet): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const merges = ws.model.merges || [];
  for (const range of merges) {
    const parsed = parseRange(String(range));
    if (!parsed) continue;
    // Read the top-left cell value
    const topLeft = ws.getCell(parsed.startRow, parsed.startCol);
    const val = extractCellValue(topLeft);
    // Propagate to all cells in the range
    for (let r = parsed.startRow; r <= parsed.endRow; r++) {
      for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        if (r === parsed.startRow && c === parsed.startCol) continue;
        map.set(`${r}:${c}`, val);
      }
    }
  }
  return map;
}

function parseRange(range: string): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  // e.g., "B1:D1" or "AC13:AE13"
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    startCol: colToNum(match[1]),
    startRow: parseInt(match[2], 10),
    endCol: colToNum(match[3]),
    endRow: parseInt(match[4], 10),
  };
}

function colToNum(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

/**
 * 다중행 헤더를 단일 행으로 합성
 * e.g., Row1: ["<입금합계>", ""] + Row2: ["입금액(사업비)", "매입부가세 반환"]
 * → ["입금합계 > 입금액(사업비)", "입금합계 > 매입부가세 반환"]
 */
export function synthesizeHeaders(headerRows: unknown[][]): string[] {
  if (headerRows.length === 0) return [];
  if (headerRows.length === 1) {
    return headerRows[0].map(v => cleanHeader(v));
  }

  const colCount = Math.max(...headerRows.map(r => r.length));
  const result: string[] = [];

  for (let c = 0; c < colCount; c++) {
    const parts: string[] = [];
    for (const row of headerRows) {
      const val = row[c];
      if (val != null) {
        const s = cleanHeader(val);
        if (s && !parts.includes(s)) parts.push(s);
      }
    }
    result.push(parts.join(' > ') || `col_${c + 1}`);
  }

  return result;
}

export function cleanHeader(raw: unknown): string {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .slice(0, 100);
}

/**
 * 헤더/데이터 경계를 자동 감지
 * 전략:
 * 1. 첫 행이 대부분 텍스트 → 단일 헤더 가능
 * 2. 숫자+날짜가 주로 등장하는 첫 행을 데이터 시작으로 판단
 * 3. 행 패턴이 급격히 바뀌는 지점 (텍스트→숫자) 감지
 */
function detectHeaderBoundary(rows: unknown[][], maxHeader: number): { headerRowCount: number; dataStartRow: number } {
  if (rows.length < 2) return { headerRowCount: 1, dataStartRow: 2 };

  for (let i = 1; i < Math.min(rows.length, maxHeader + 3); i++) {
    const row = rows[i];
    if (!row) continue;
    const nonEmpty = row.filter(v => v != null && String(v).trim() !== '');
    if (nonEmpty.length < 2) continue;

    // Count data-like values: numbers, dates, booleans
    const dataLikeCount = nonEmpty.filter(v => {
      if (typeof v === 'number') return true;
      if (typeof v === 'boolean') return true;
      if (v instanceof Date) return true;
      const s = String(v).trim();
      // Pure number
      if (/^-?\d+([.,]\d+)?$/.test(s)) return true;
      // Date-like patterns
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) return true;
      if (/^\d{2}-\d{1,2}-\d{1,2}$/.test(s)) return true;
      // ISO date
      if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return true;
      return false;
    }).length;

    // If >40% of non-empty cells are data-like, this is a data row
    if (dataLikeCount / nonEmpty.length > 0.4) {
      return { headerRowCount: i, dataStartRow: i + 1 };
    }

    // Also check: if previous row was all text and current row has a
    // sequential number in first non-empty cell (e.g., "1", "No.1")
    const firstVal = nonEmpty[0];
    if (typeof firstVal === 'number' && firstVal === 1 && i > 0) {
      return { headerRowCount: i, dataStartRow: i + 1 };
    }
  }

  // Default: first row is header
  return { headerRowCount: 1, dataStartRow: 2 };
}
