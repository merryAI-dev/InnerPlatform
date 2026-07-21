import { describe, expect, it } from 'vitest';
import { toPdfJsData } from './pdf-text.mjs';

describe('pdf text input normalization', () => {
  it('copies a Node.js Buffer into a plain Uint8Array accepted by pdfjs', () => {
    const source = Buffer.from([0x25, 0x50, 0x44, 0x46]);

    const normalized = toPdfJsData(source);

    expect(normalized.constructor).toBe(Uint8Array);
    expect(Buffer.isBuffer(normalized)).toBe(false);
    expect(Array.from(normalized)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(normalized).not.toBe(source);
  });
});
