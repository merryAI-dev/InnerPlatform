/**
 * RFC 4180 compliant TSV encoding/decoding + HTML spreadsheet paste support.
 * Inspired by Wafflebase grids.ts — adapted for InnerPlatform settlement grid.
 */

function quoteTsvField(field: string): string {
  if (field.includes('\t') || field.includes('\n') || field.includes('"')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export function grid2tsv(grid: string[][]): string {
  return grid.map((row) => row.map(quoteTsvField).join('\t')).join('\n');
}

export function parseTsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuote = true;
      i++;
      continue;
    }

    if (ch === '\t') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

export function isSpreadsheetHtml(html: string): boolean {
  return (
    html.includes('google-sheets-html-origin')
    || html.includes('urn:schemas-microsoft-com:office:excel')
    || html.includes('xmlns:x="urn:schemas-microsoft-com:office:excel"')
  );
}

export function html2grid(html: string): string[][] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];

  const grid: string[][] = [];
  const trs = table.querySelectorAll('tr');

  for (const tr of trs) {
    const row: string[] = [];
    const cells = tr.querySelectorAll('td, th');
    for (const cell of cells) {
      row.push((cell.textContent ?? '').trim());
    }
    if (row.length > 0) {
      grid.push(row);
    }
  }

  return grid;
}
