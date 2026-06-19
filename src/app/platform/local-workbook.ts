import { parseCsv } from './csv-utils';
import { loadExcelJs } from './lazy-heavy-modules';

export interface LocalWorkbookSheet {
  name: string;
  matrix: string[][];
}

function cellToString(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'object') {
    const value = cell as {
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      richText?: Array<{ text?: unknown }>;
      hyperlink?: unknown;
    };
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => cellToString(part.text)).join('');
    }
    if (value.text != null) return cellToString(value.text);
    if (value.result != null) return cellToString(value.result);
    if (value.hyperlink != null && value.text != null) return cellToString(value.text);
    if (value.formula != null) return '';
  }
  return String(cell);
}

export async function parseXlsxWorkbook(buffer: ArrayBuffer): Promise<LocalWorkbookSheet[]> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets.map((worksheet) => {
    const matrix: string[][] = [];
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row: string[] = [];
      for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
        row.push(cellToString(worksheet.getCell(rowIndex, columnIndex).value));
      }
      matrix.push(row);
    }
    return { name: worksheet.name, matrix };
  });
}

export async function parseLocalWorkbookFile(file: File): Promise<LocalWorkbookSheet[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return [{ name: file.name, matrix: parseCsv(text) }];
  }

  if (name.endsWith('.xlsx')) {
    return parseXlsxWorkbook(await file.arrayBuffer());
  }

  if (name.endsWith('.xls')) {
    throw new Error('보안 정책상 XLS 바이너리는 지원하지 않습니다. CSV 또는 XLSX로 변환해 업로드해 주세요.');
  }

  throw new Error('지원하지 않는 파일 형식입니다. CSV 또는 XLSX를 사용하세요.');
}
