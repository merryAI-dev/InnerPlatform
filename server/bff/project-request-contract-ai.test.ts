import { describe, expect, it } from 'vitest';
import {
  buildFallbackProjectRequestContractAnalysis,
  createProjectRequestContractAiService,
  sanitizeProjectName,
} from './project-request-contract-ai.mjs';

describe('project-request-contract-ai', () => {
  it('normalizes a short internal project name from contract title', () => {
    expect(sanitizeProjectName('뷰티풀 커넥트 운영 계약서')).toBe('뷰티풀커넥트');
  });

  it('builds fallback analysis from contract text', () => {
    const analysis = buildFallbackProjectRequestContractAnalysis({
      fileName: '뷰티풀커넥트_계약서.pdf',
      documentText: [
        '사업명: 뷰티풀 커넥트 운영 계약',
        '발주기관: 아모레퍼시픽재단',
        '계약기간: 2026.03.01 ~ 2026.12.31',
        '총 계약금액: 120,000,000원',
        '부가세: 12,000,000원',
        '사업 목적: 청년 창업가의 지역 연결을 지원한다.',
      ].join('\n'),
    }, '2026-03-16T09:00:00.000Z');

    expect(analysis.provider).toBe('heuristic');
    expect(analysis.fields.officialContractName.value).toContain('뷰티풀 커넥트');
    expect(analysis.fields.clientOrg.value).toBe('아모레퍼시픽재단');
    expect(analysis.fields.contractStart.value).toBe('2026-03-01');
    expect(analysis.fields.contractEnd.value).toBe('2026-12-31');
    expect(analysis.fields.contractAmount.value).toBe(120000000);
  });

  it('falls back when anthropic key is missing', async () => {
    const service = createProjectRequestContractAiService({
      now: () => '2026-03-16T09:00:00.000Z',
    });
    const analysis = await service.analyzeContract({
      fileName: 'contract.pdf',
      documentText: '계약명: 테스트 사업 운영 계약 계약금액: 500,000원',
    });

    expect(analysis.provider).toBe('heuristic');
    expect(analysis.extractedAt).toBe('2026-03-16T09:00:00.000Z');
  });
});
