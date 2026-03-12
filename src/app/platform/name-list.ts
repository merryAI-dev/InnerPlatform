export function splitLooseNameList(value: string | null | undefined): string[] {
  return String(value || '')
    .split(/[\n,\/;|&]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

