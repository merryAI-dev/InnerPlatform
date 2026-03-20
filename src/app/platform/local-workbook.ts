import { parseCsv } from './csv-utils';

export interface LocalWorkbookSheet {
  name: string;
  matrix: string[][];
}

function cellToString(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

export async function parseLocalWorkbookFile(file: File): Promise<LocalWorkbookSheet[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return [{ name: file.name, matrix: parseCsv(text) }];
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buffer = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
    return workbook.SheetNames.map((sheetName) => {
      const ws = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
      return {
        name: sheetName,
        matrix: rawRows.map((row) => (Array.isArray(row) ? row : []).map(cellToString)),
      };
    });
  }

  throw new Error('지원하지 않는 파일 형식입니다. CSV 또는 XLSX를 사용하세요.');
}
