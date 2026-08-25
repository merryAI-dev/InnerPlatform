import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyProfessionalProfileDraft,
  hasProfessionalProfileFacts,
  professionalProfileDraftToInput,
  resolveProfessionalProfileSaveAttempt,
  splitCertificationLabels,
} from './ProfessionalProfileEditor';

const source = readFileSync(resolve(import.meta.dirname, 'ProfessionalProfileEditor.tsx'), 'utf8');

describe('ProfessionalProfileEditor draft contract', () => {
  it('maps comma/newline certificate input without putting it in the global person model', () => {
    expect(splitCertificationLabels(' PMP,\n ODA 전문가 \n\n')).toEqual([
      { label: 'PMP' },
      { label: 'ODA 전문가' },
    ]);

    const draft = createEmptyProfessionalProfileDraft();
    draft.certificationText = 'PMP, ODA 전문가';
    expect(hasProfessionalProfileFacts(draft)).toBe(true);
    expect(professionalProfileDraftToInput(draft).certifications).toEqual([
      { label: 'PMP' },
      { label: 'ODA 전문가' },
    ]);
  });

  it('treats an empty create draft as revision-0 missing data', () => {
    const draft = createEmptyProfessionalProfileDraft();
    expect(hasProfessionalProfileFacts(draft)).toBe(false);
    expect(professionalProfileDraftToInput(draft)).toEqual({
      educationRecords: [],
      englishEvidence: [],
      certifications: [],
    });
  });

  it('reuses one idempotency key for the same uncertain save and rotates it after an edit', () => {
    const profile = professionalProfileDraftToInput(createEmptyProfessionalProfileDraft());
    const first = resolveProfessionalProfileSaveAttempt(null, {
      personId: 'person-a', expectedRevision: 2, profile, randomUUID: () => 'attempt-a',
    });
    const retry = resolveProfessionalProfileSaveAttempt(first, {
      personId: 'person-a', expectedRevision: 2, profile, randomUUID: () => 'should-not-run',
    });
    const edited = resolveProfessionalProfileSaveAttempt(retry, {
      personId: 'person-a', expectedRevision: 2,
      profile: { ...profile, certifications: [{ label: 'PMP' }] },
      randomUUID: () => 'attempt-b',
    });

    expect(retry).toBe(first);
    expect(retry.key).toBe('professional-profile:person-a:attempt-a');
    expect(edited.key).toBe('professional-profile:person-a:attempt-b');
  });

  it('keeps GET lifecycle abortable while the PUT attempt is caller-owned and stable', () => {
    expect(source).toContain('new AbortController()');
    expect(source).toContain('scopeClient.getCatalog(controller.signal)');
    expect(source).toContain('scopeClient.get(personId, controller.signal)');
    expect(source).toContain('saveAttemptRef');
    expect(source).toContain('crypto.randomUUID()');
    expect(source).toContain('clientRef.current.save(personId');
    const saveCall = source.slice(
      source.indexOf('clientRef.current.save(personId'),
      source.indexOf('clientRef.current.save(personId') + 500,
    );
    expect(saveCall).not.toContain('signal:');
  });

  it('fails closed on a tenant/person scope transition and cannot save a stale draft', () => {
    expect(source).toContain('const scopeKey =');
    expect(source).toContain('loadedScopeRef.current = null');
    expect(source).toContain('setCatalog(null)');
    expect(source).toContain('setDraft(createEmptyProfessionalProfileDraft())');
    expect(source).toContain('setExpectedRevision(0)');
    expect(source).toContain('saveAttemptRef.current = null');
    expect(source).toContain('loadedScopeRef.current = scopeKey');
    expect(source).toContain('if (loadedScopeRef.current !== scopeKey || loading || !catalog) return');
  });

  it('refreshes request credentials without making token refresh a draft-reset dependency', () => {
    expect(source).toContain('clientRef.current = createPersonProfessionalProfileClient');
    const loadEffect = source.slice(source.indexOf('void Promise.all(['), source.indexOf('const reloadCanonicalProfile'));
    expect(loadEffect).not.toContain('actor.idToken');
    expect(loadEffect).not.toContain('[client, personId]');
  });

  it('retains a conflict draft and offers an explicit canonical reload', () => {
    expect(source).toContain("kind: 'conflict'");
    expect(source).toContain('최신 정보 다시 불러오기');
    expect(source).toContain('reloadCanonicalProfile');
    expect(source).toContain('if (saving) return');
    expect(source).toContain("readErrorCode(saveError) === 'professional_profile_revision_conflict'");
    expect(source).toContain('resolveApiErrorMessage(saveError');
  });

  it('uses the canonical PUT response without a second unguarded GET', () => {
    expect(source).toContain('const canonical = await clientRef.current.save(personId');
    expect(source).toContain('setDraft(storedProfileToDraft(canonical.profile))');
    const saveFlow = source.slice(source.indexOf('const save = async'), source.indexOf('const requestClose'));
    expect(saveFlow).not.toContain('client.get(personId');
  });

  it('renders every code list from the server catalog and enforces row limits', () => {
    expect(source).toContain('catalog.educationAttainments.map');
    expect(source).toContain('catalog.englishTests.map');
    expect(source).toContain('catalog.countryCodes.map');
    expect(source).toContain('selectedTest.scales.map');
    expect(source).toContain('MAX_EDUCATION_RECORDS = 10');
    expect(source).toContain('MAX_ENGLISH_EVIDENCE = 10');
    expect(source).toContain('MAX_CERTIFICATIONS = 20');
    expect(source).not.toContain('BACHELOR_GRADUATED');
    expect(source).not.toContain("testCode: 'TOEIC'");
    expect(source).toContain('formatEnglishScaleLabel(scale)');
    expect(source).toContain('return scale.label ?? scale.code');
    expect(source).toContain('aria-label={`${title} 추가`}');
    expect(source).toContain('htmlFor="professional-profile-certifications"');
    expect(source).not.toContain('Revision {expectedRevision}');
  });

  it('새 인력 catalog 실패를 보조기기에 알리고 인력 명부 용어를 일관되게 쓴다', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('학력·영어 증빙·자격증을 인력 명부에 저장합니다.');
    expect(source).not.toContain('People 원장');
    expect(source).toContain('전문 프로필 <span className="font-normal text-slate-500">(선택)</span>');
  });
});
