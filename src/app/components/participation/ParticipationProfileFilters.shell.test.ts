import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ParticipationProfileFilters.tsx'), 'utf8');

describe('ParticipationProfileFilters server-owned option contract', () => {
  it('renders all three server option dimensions with counts', () => {
    expect(source).toContain('options.education.map');
    expect(source).toContain('options.englishEvidence.map');
    expect(source).toContain('options.certifications.map');
    expect(source).toContain('option.memberCount');
    expect(source).toContain('최종학력 필터');
    expect(source).toContain('영어 필터');
    expect(source).toContain('자격증 필터');
  });

  it('keeps zero-count options selectable and sends codes unchanged', () => {
    expect(source).not.toContain('option.memberCount === 0');
    expect(source).not.toContain('disabled={!option.memberCount}');
    expect(source).toContain('onEducationChange(event.target.value || null)');
    expect(source).toContain('onEnglishEvidenceChange(event.target.value || null)');
    expect(source).toContain('onCertificationToggle(value)');
    expect(source).not.toContain('onCertificationsChange(next)');
    expect(source).not.toContain('.reduce(');
  });

  it('caps certification filters at the BFF contract limit without closing the filter shell', () => {
    expect(source).toContain('MAX_CERTIFICATION_FILTERS = 20');
    expect(source).toContain('certifications.length >= MAX_CERTIFICATION_FILTERS');
    expect(source).toContain('disabled={isCertificationDisabled}');
    expect(source).toContain('최대 {MAX_CERTIFICATION_FILTERS}개');
    expect(source).toContain("option.value !== '__MISSING__'");
  });

  it('gives active filters a clear visual hierarchy with existing tokens', () => {
    expect(source).toContain("education ? 'border-sky-300 bg-sky-50");
    expect(source).toContain("englishEvidence ? 'border-sky-300 bg-sky-50");
    expect(source).toContain("certifications.length ? 'border-sky-300 bg-sky-50");
    expect(source).toContain("active ? 'border-sky-200 bg-sky-50/40'");
  });
});
