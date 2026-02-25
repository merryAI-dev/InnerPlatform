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

export function parseDate(raw: string): string {
  if (!raw) return '';
  const value = normalizeSpace(raw).replace(/[./]/g, '-');
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const short = value.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (short) {
    return `20${short[1]}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}`;
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
