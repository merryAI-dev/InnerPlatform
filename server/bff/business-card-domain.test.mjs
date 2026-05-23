import { describe, expect, it } from 'vitest';
import {
  assertConfirmableContact,
  buildContactDerivedFields,
  buildContactSearchTokens,
  normalizeBusinessCardContactPayload,
  normalizeBusinessCardExtraction,
  scoreContactSearchResult,
} from './business-card-domain.mjs';

describe('business-card-domain', () => {
  it('normalizes Gemini extraction output safely', () => {
    const result = normalizeBusinessCardExtraction({
      name: { value: ' 홍길동 ', confidence: 'certain', evidence: ' 홍길동 ' },
      emails: [{ value: ' PERSON@EXAMPLE.COM ', confidence: 'high', evidence: 'PERSON@EXAMPLE.COM' }],
      phones: [{ value: '010-1234-5678', confidence: 'medium', evidence: '010-1234-5678' }],
      website: { value: 'example.com', confidence: 'medium', evidence: 'example.com' },
      warnings: [' 확인 필요 '],
    });

    expect(result.name).toEqual({ value: '홍길동', confidence: 'low', evidence: '홍길동' });
    expect(result.emails[0].value).toBe('person@example.com');
    expect(result.phones[0].value).toBe('01012345678');
    expect(result.website.value).toBe('https://example.com');
    expect(result.warnings).toEqual(['확인 필요']);
  });

  it('builds deterministic search tokens for Korean, email, and phone values', () => {
    const contact = normalizeBusinessCardContactPayload({
      name: '홍 길동',
      organization: 'MYSC Labs',
      emails: ['PERSON@EXAMPLE.COM'],
      phones: ['010-1234-5678'],
    });

    expect(buildContactSearchTokens(contact)).toEqual(expect.arrayContaining([
      '길동',
      '홍길동',
      'mysc',
      'labs',
      'person@example.com',
      'person',
      'example',
      'example.com',
      '01012345678',
      '1234',
      '5678',
    ]));
  });

  it('materializes PostgreSQL-style derived search fields at write time', () => {
    const contact = normalizeBusinessCardContactPayload({
      name: ' 홍길동 ',
      organization: ' MYSC Labs ',
      title: '대표',
      emails: ['PERSON@EXAMPLE.COM'],
      phones: ['010-1234-5678'],
    });

    expect(buildContactDerivedFields(contact)).toMatchObject({
      normalizedName: '홍길동',
      normalizedOrganization: 'mysc labs',
      primaryEmail: 'person@example.com',
      primaryPhone: '01012345678',
      emailKeys: ['person@example.com'],
      phoneKeys: ['01012345678'],
      phoneDigits: ['01012345678'],
      normalizationVersion: 1,
      extractionSchemaVersion: 1,
      quality: {
        score: 1,
        status: 'ready',
        hasIdentity: true,
        hasContactMethod: true,
      },
    });
  });

  it('rejects contacts without identity or contact method', () => {
    expect(() => assertConfirmableContact({ name: '', organization: '', emails: ['a@example.com'], phones: [] })).toThrow('name or organization');
    expect(() => assertConfirmableContact({ name: '홍길동', organization: '', emails: [], phones: [] })).toThrow('email or phone');
  });

  it('scores exact email matches above weaker organization matches', () => {
    const now = new Date('2026-05-23T00:00:00.000Z');
    const emailScore = scoreContactSearchResult({
      name: '홍길동',
      organization: 'MYSC',
      emails: ['person@example.com'],
      phones: [],
      updatedAt: now.toISOString(),
    }, 'person@example.com', now);
    const orgScore = scoreContactSearchResult({
      name: '홍길동',
      organization: 'MYSC Labs',
      emails: [],
      phones: [],
      updatedAt: now.toISOString(),
    }, 'MYSC', now);

    expect(emailScore).toBeGreaterThan(orgScore);
  });

  it('scores multi-token name and organization queries by their individual tokens', () => {
    const now = new Date('2026-05-23T00:00:00.000Z');
    const score = scoreContactSearchResult({
      name: '홍길동',
      organization: 'MYSC Labs',
      emails: [],
      phones: [],
      updatedAt: now.toISOString(),
    }, 'MYSC 홍길동', now);

    expect(score).toBeGreaterThan(4);
  });
});
