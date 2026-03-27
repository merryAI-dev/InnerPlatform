import { describe, expect, it } from 'vitest';
import {
  escapeCsvCell,
  normalizeKey,
  normalizeSpace,
  parseCsv,
  parseDate,
  parseNumber,
  pickValue,
  stableHash,
  toCsv,
} from './csv-utils';

// ── parseCsv ──

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('"hello, world",b')).toEqual([['hello, world', 'b']]);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(parseCsv('"he said ""hi""",ok')).toEqual([['he said "hi"', 'ok']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles \\r\\n line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles empty cells', () => {
    expect(parseCsv(',,')).toEqual([['', '', '']]);
  });

  it('handles a single value with no delimiter', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles trailing newline without producing empty row', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles multiple empty rows', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  it('handles quoted empty string', () => {
    expect(parseCsv('"",b')).toEqual([['', 'b']]);
  });

  it('handles mixed quoted and unquoted fields', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });
});

// ── escapeCsvCell ──

describe('escapeCsvCell', () => {
  it('returns plain value unchanged', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
  });

  it('wraps value with comma in double quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('wraps and escapes value with double quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps value with newline', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('handles value with all special characters', () => {
    expect(escapeCsvCell('"a,\nb"')).toBe('"""a,\nb"""');
  });

  it('handles empty string', () => {
    expect(escapeCsvCell('')).toBe('');
  });
});

// ── toCsv round-trip ──

describe('toCsv', () => {
  it('produces valid CSV from rows', () => {
    const rows = [
      ['name', 'value'],
      ['a', '1'],
    ];
    expect(toCsv(rows)).toBe('name,value\na,1');
  });

  it('round-trips with parseCsv for simple data', () => {
    const original = [
      ['이름', '금액', '비고'],
      ['홍길동', '1,000원', '정상'],
    ];
    const csv = toCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });

  it('round-trips with parseCsv for data containing quotes and newlines', () => {
    const original = [
      ['col1', 'col2'],
      ['has "quotes"', 'has\nnewline'],
    ];
    const csv = toCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });

  it('round-trips empty cells', () => {
    const original = [['', 'a', '']];
    const csv = toCsv(original);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual(original);
  });
});

// ── normalizeSpace ──

describe('normalizeSpace', () => {
  it('collapses multiple spaces', () => {
    expect(normalizeSpace('a   b')).toBe('a b');
  });

  it('trims leading and trailing spaces', () => {
    expect(normalizeSpace('  hello  ')).toBe('hello');
  });

  it('replaces tabs and newlines with single space', () => {
    expect(normalizeSpace('a\tb\nc')).toBe('a b c');
  });

  it('handles empty string', () => {
    expect(normalizeSpace('')).toBe('');
  });

  it('handles string of only whitespace', () => {
    expect(normalizeSpace('   \t\n  ')).toBe('');
  });
});

// ── normalizeKey ──

describe('normalizeKey', () => {
  it('lowercases and removes spaces', () => {
    expect(normalizeKey('Hello World')).toBe('helloworld');
  });

  it('removes punctuation characters', () => {
    expect(normalizeKey('key_(1)')).toBe('key1');
  });

  it('removes brackets, colons, slashes, pipes', () => {
    expect(normalizeKey('[a]{b}:c;d/e|f\\g')).toBe('abcdefg');
  });

  it('removes quotes and dots', () => {
    expect(normalizeKey("a.b'c\"d")).toBe('abcd');
  });

  it('removes hyphens and underscores', () => {
    expect(normalizeKey('my-key_name')).toBe('mykeyname');
  });

  it('handles empty string', () => {
    expect(normalizeKey('')).toBe('');
  });

  it('handles Korean text', () => {
    expect(normalizeKey('거래 일자')).toBe('거래일자');
  });
});

// ── pickValue ──

describe('pickValue', () => {
  it('returns exact match value', () => {
    const row = { '거래일자': '2026-01-01', '금액': '1000' };
    expect(pickValue(row, ['거래일자'])).toBe('2026-01-01');
  });

  it('returns fuzzy substring match (alias is substring of key)', () => {
    const row = { '거래일자(입금)': '2026-03-01' };
    expect(pickValue(row, ['거래일자'])).toBe('2026-03-01');
  });

  it('returns fuzzy substring match (key is substring of alias)', () => {
    const row = { '일자': '2026-05-01' };
    expect(pickValue(row, ['거래일자'])).toBe('2026-05-01');
  });

  it('returns empty string when no match found', () => {
    const row = { '이름': '홍길동' };
    expect(pickValue(row, ['금액'])).toBe('');
  });

  it('tries multiple aliases in order', () => {
    const row = { 'amount': '500' };
    expect(pickValue(row, ['금액', 'amount'])).toBe('500');
  });

  it('skips entries with empty values', () => {
    const row = { '금액': '', 'amount': '100' };
    expect(pickValue(row, ['금액', 'amount'])).toBe('100');
  });

  it('normalizes spaces in returned value', () => {
    const row = { 'memo': '  hello   world  ' };
    expect(pickValue(row, ['memo'])).toBe('hello world');
  });

  it('handles empty row', () => {
    expect(pickValue({}, ['anything'])).toBe('');
  });

  it('handles empty aliases', () => {
    const row = { 'a': '1' };
    expect(pickValue(row, [])).toBe('');
  });
});

// ── parseNumber ──

describe('parseNumber', () => {
  it('parses simple integer', () => {
    expect(parseNumber('42')).toBe(42);
  });

  it('parses Korean comma-formatted number', () => {
    expect(parseNumber('1,000')).toBe(1000);
  });

  it('parses large Korean formatted number', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
  });

  it('parses number with 원 suffix', () => {
    expect(parseNumber('5,000원')).toBe(5000);
  });

  it('parses number with ₩ prefix', () => {
    expect(parseNumber('₩10000')).toBe(10000);
  });

  it('parses negative number', () => {
    expect(parseNumber('-500')).toBe(-500);
  });

  it('parses decimal number', () => {
    expect(parseNumber('3.14')).toBe(3.14);
  });

  it('parses zero', () => {
    expect(parseNumber('0')).toBe(0);
  });

  it('returns null for empty string', () => {
    expect(parseNumber('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(parseNumber('   ')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseNumber('abc')).toBeNull();
  });

  it('parses number with spaces', () => {
    expect(parseNumber(' 1 000 ')).toBe(1000);
  });
});

// ── parseDate ──

describe('parseDate', () => {
  it('parses ISO format YYYY-MM-DD', () => {
    expect(parseDate('2026-03-19')).toBe('2026-03-19');
  });

  it('parses dot-separated YYYY.MM.DD', () => {
    expect(parseDate('2026.03.19')).toBe('2026-03-19');
  });

  it('parses slash-separated YYYY/MM/DD', () => {
    expect(parseDate('2026/03/19')).toBe('2026-03-19');
  });

  it('parses US-style MM/DD/YYYY', () => {
    expect(parseDate('03/19/2026')).toBe('2026-03-19');
  });

  it('parses US-style with single digits', () => {
    expect(parseDate('1/4/26')).toBe('2026-01-04');
  });

  it('parses short year-first 26-03-19', () => {
    expect(parseDate('26-03-19')).toBe('2026-03-19');
  });

  it('parses short US-style 12/31/25', () => {
    expect(parseDate('12/31/25')).toBe('2025-12-31');
  });

  it('returns empty for invalid calendar date (Feb 30)', () => {
    expect(parseDate('2026-02-30')).toBe('');
  });

  it('returns empty for invalid day (Dec 32)', () => {
    expect(parseDate('12/32/25')).toBe('');
  });

  it('returns empty for month > 12', () => {
    expect(parseDate('2026-13-01')).toBe('');
  });

  it('returns empty for empty string', () => {
    expect(parseDate('')).toBe('');
  });

  it('handles leading/trailing whitespace', () => {
    expect(parseDate('  2026-01-15  ')).toBe('2026-01-15');
  });

  it('pads single digit month and day', () => {
    expect(parseDate('2026-1-5')).toBe('2026-01-05');
  });
});

// ── stableHash ──

describe('stableHash', () => {
  it('returns consistent result for same input', () => {
    const hash1 = stableHash('hello');
    const hash2 = stableHash('hello');
    expect(hash1).toBe(hash2);
  });

  it('returns different results for different inputs', () => {
    expect(stableHash('hello')).not.toBe(stableHash('world'));
  });

  it('returns a non-empty string', () => {
    expect(stableHash('test').length).toBeGreaterThan(0);
  });

  it('returns base-36 encoded string', () => {
    const hash = stableHash('anything');
    expect(hash).toMatch(/^[0-9a-z]+$/);
  });

  it('handles empty string', () => {
    const hash = stableHash('');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('handles unicode / Korean characters', () => {
    const hash = stableHash('한글 테스트');
    expect(hash).toMatch(/^[0-9a-z]+$/);
  });

  it('produces different hashes for similar strings', () => {
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });
});
