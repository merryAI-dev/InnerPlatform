import type { ImportRow } from './settlement-csv';

export function readImportDraftCache(cacheKey: string): ImportRow[] | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: ImportRow[] } | null;
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch {
    return null;
  }
}

export function writeImportDraftCache(cacheKey: string, rows: ImportRow[]): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ rows }));
  } catch {
    // Ignore browser storage quota errors during local draft caching.
  }
}

export function clearImportDraftCache(cacheKey: string): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function serializeImportRows(rows: ImportRow[] | null | undefined): string {
  if (!rows || rows.length === 0) return '';
  try {
    return JSON.stringify(rows);
  } catch {
    return String(rows.length);
  }
}
