// ── Shared CSV parse / export / download utilities ──

/** RFC-compliant CSV parser handling quoted fields and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeKey(value: string): string {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[()\[\]{}:;'",._/\-|\\]/g, '')
    .replace(/\s+/g, '');
}

/** Fuzzy header match — checks if normalized alias matches or is substring of key (or vice versa). */
export function pickValue(row: Record<string, string>, aliases: string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    for (const [rawKey, rawVal] of entries) {
      if (!rawVal) continue;
      const k = normalizeKey(rawKey);
      if (k === key || k.includes(key) || key.includes(k)) {
        return normalizeSpace(rawVal);
      }
    }
  }
  return '';
}

export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s원₩]/g, '').replace(/[^0-9.+-]/g, '');
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatIsoDate(year: number, month: number, day: number): string {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDate(raw: string): string {
  if (!raw) return '';
  const value = normalizeSpace(raw).replace(/[./]/g, '-');
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return formatIsoDate(
      Number.parseInt(iso[1], 10),
      Number.parseInt(iso[2], 10),
      Number.parseInt(iso[3], 10),
    );
  }
  const monthDayYear = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (monthDayYear) {
    return formatIsoDate(
      Number.parseInt(monthDayYear[3], 10),
      Number.parseInt(monthDayYear[1], 10),
      Number.parseInt(monthDayYear[2], 10),
    );
  }
  const short = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (short) {
    const first = Number.parseInt(short[1], 10);
    const second = Number.parseInt(short[2], 10);
    const third = Number.parseInt(short[3], 10);
    if (first > 12 && second <= 12) {
      return formatIsoDate(2000 + first, second, third);
    }
    return formatIsoDate(2000 + third, first, second);
  }
  return '';
}

export function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(36);
}
