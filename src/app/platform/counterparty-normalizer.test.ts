import { describe, expect, it } from 'vitest';
import {
  normalizeCounterpartyName,
  levenshtein,
  findSimilarCounterparty,
} from './counterparty-normalizer';

describe('normalizeCounterpartyName', () => {
  it('removes leading 주식회사', () => {
    expect(normalizeCounterpartyName('주식회사 한국전력')).toBe('한국전력');
  });

  it('removes trailing 주식회사', () => {
    expect(normalizeCounterpartyName('한국전력 주식회사')).toBe('한국전력');
  });

  it('removes (주) suffix notation', () => {
    expect(normalizeCounterpartyName('삼성전자(주)')).toBe('삼성전자');
    expect(normalizeCounterpartyName('삼성전자 (주)')).toBe('삼성전자');
  });

  it('removes 사단법인 prefix', () => {
    expect(normalizeCounterpartyName('사단법인 희망나눔')).toBe('희망나눔');
  });

  it('lowercases and trims whitespace', () => {
    expect(normalizeCounterpartyName('  ABC Corp  ')).toBe('abc corp');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeCounterpartyName('한국  전자')).toBe('한국 전자');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('returns length for empty string comparison', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts single character difference', () => {
    expect(levenshtein('삼성전자', '삼정전자')).toBe(1);
  });

  it('counts transposition as 2 edits', () => {
    expect(levenshtein('ab', 'ba')).toBe(2);
  });

  it('handles typo within distance 2', () => {
    // '코이카' vs '코카이' — distance 2
    expect(levenshtein('코이카', '코카이')).toBeLessThanOrEqual(2);
  });
});

describe('findSimilarCounterparty', () => {
  const existing = ['삼성전자(주)', '주식회사 한국전력', '코이카', '사단법인 희망나눔'];

  it('returns null when no similar counterparty found', () => {
    expect(findSimilarCounterparty('전혀다른거래처', existing)).toBeNull();
  });

  it('detects typo within edit distance 2', () => {
    const result = findSimilarCounterparty('삼성전장', existing);
    expect(result).not.toBeNull();
    expect(result?.original).toBe('삼성전자(주)');
    expect(result?.distance).toBeLessThanOrEqual(2);
  });

  it('excludes exact same name', () => {
    const result = findSimilarCounterparty('코이카', existing);
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findSimilarCounterparty('', existing)).toBeNull();
  });

  it('ignores duplicates in existing list', () => {
    const withDupes = ['삼성전자(주)', '삼성전자(주)', '삼성전자(주)'];
    const result = findSimilarCounterparty('삼성전장', withDupes);
    expect(result).not.toBeNull();
  });
});
