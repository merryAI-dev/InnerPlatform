import { describe, expect, it } from 'vitest';
import { decodeTextBytes } from './text-file-decoder';

describe('text-file-decoder', () => {
  it('decodes UTF-8 text without changing normal CSV files', () => {
    const bytes = new TextEncoder().encode('통장번호,거래일시,적요\n111,2026-04-07,택시');

    expect(decodeTextBytes(bytes)).toContain('통장번호,거래일시,적요');
  });

  it('falls back to EUC-KR for Korean bank CSV exports', () => {
    const cp949Bytes = new Uint8Array([
      197, 235, 192, 229, 185, 248, 200, 163, 44, 176, 197, 183, 161, 192, 207, 189,
      195, 44, 192, 251, 191, 228, 10, 49, 49, 49, 44, 50, 48, 50, 54, 45, 48, 52,
      45, 48, 55, 44, 197, 195, 189, 195,
    ]);

    expect(decodeTextBytes(cp949Bytes)).toBe('통장번호,거래일시,적요\n111,2026-04-07,택시');
  });
});
