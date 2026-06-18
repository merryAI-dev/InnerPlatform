export function extractSpreadsheetId(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const linkMatch = raw.match(/\/d\/([A-Za-z0-9-_]+)/);
  if (linkMatch) return linkMatch[1];

  const urlIdMatch = raw.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (urlIdMatch) return urlIdMatch[1];

  if (/^[A-Za-z0-9-_]{20,}$/.test(raw)) return raw;

  return '';
}
