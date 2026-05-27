export function decodeTextBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;

  try {
    return new TextDecoder('euc-kr', { fatal: false }).decode(bytes);
  } catch {
    return utf8;
  }
}

export async function readTextFile(file: File): Promise<string> {
  return decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
}
