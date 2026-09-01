import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyProfessionalProfileDraft,
  hasProfessionalProfileFacts,
  professionalProfileDraftToInput,
  resolveProfessionalProfileSaveAttempt,
} from './ProfessionalProfileEditor';

const source = readFileSync(resolve(import.meta.dirname, 'ProfessionalProfileEditor.tsx'), 'utf8');

describe('ProfessionalProfileEditor draft contract', () => {
  it('keeps each certificate with its own acquisition month and drops blank rows', () => {
    const draft = createEmptyProfessionalProfileDraft();
    // 취득일을 항목마다 받아야 해서 자유 텍스트가 아니라 행으로 관리한다.
    draft.certifications = [
      { label: ' PMP ', acquiredAt: '2019-05' },
      { label: 'ODA 전문가', acquiredAt: '' },
      { label: '   ', acquiredAt: '2020-01' },
    ];
    expect(hasProfessionalProfileFacts(draft)).toBe(true);
    expect(professionalProfileDraftToInput(draft).certifications).toEqual([
      { label: 'PMP', acquiredAt: '2019-05', evidence: null },
      { label: 'ODA 전문가', acquiredAt: null, evidence: null },
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
    expect(source).toContain('const scopeGenerationRef = useRef({ key: scopeKey, generation: 0 })');
    expect(source).toContain('scopeGenerationRef.current = { key: scopeKey, generation: scopeGenerationRef.current.generation + 1 }');
    expect(source).toContain('const saveGeneration = scopeGenerationRef.current.generation');
    expect(source).toContain('scopeGenerationRef.current.generation !== saveGeneration');
    expect(source).toContain('const renderScopeRef = useRef(scopeKey)');
    expect(source).toContain('const scopeLoaded = renderScopeRef.current === scopeKey');
    expect(source).toContain('loadedScopeRef.current = null');
    expect(source).toContain('setCatalog(null)');
    expect(source).toContain('setDraft(createEmptyProfessionalProfileDraft())');
    expect(source).toContain('setExpectedRevision(0)');
    expect(source).toContain('saveAttemptRef.current = null');
    expect(source).toContain('loadedScopeRef.current = scopeKey');
    expect(source).toContain('loading || !catalog || !scopeLoaded');
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
    expect(source).toContain('catalog.educationRegions.map');
    // 점수 체계는 시험을 고르면 하나로 정해진다 - 고르게 하지 않는다.
    expect(source).not.toContain('selectedTest.scales.map');
    expect(source).toContain('scales[0]?.code');
    expect(source).toContain('MAX_EDUCATION_RECORDS = 10');
    expect(source).toContain('MAX_ENGLISH_EVIDENCE = 10');
    expect(source).toContain('MAX_CERTIFICATIONS = 20');
    expect(source).not.toContain('BACHELOR_GRADUATED');
    expect(source).not.toContain("testCode: 'TOEIC'");
    expect(source).toContain('aria-label={`${title} 추가`}');
    // 자격증은 취득일을 항목마다 받아야 해서 자유 텍스트가 아니라 행 목록이다.
    expect(source).toContain('htmlFor={`certification-label-${index}`}');
    expect(source).toContain('htmlFor={`certification-acquired-${index}`}');
    expect(source).not.toContain('draft.certificationText');
    // 학력은 언제 다녔는지까지 남긴다.
    expect(source).toContain('htmlFor={`education-admission-${index}`}');
    expect(source).toContain('htmlFor={`education-degree-year-${index}`}');
    // 증빙은 세 종류 모두에 붙는다. 파일은 저장과 별개로 곧장 올라가고 참조만 남는다.
    expect(source).toContain('<EvidenceAttachment');
    expect(source).toContain('증빙은 인력을 등록한 뒤 붙일 수 있습니다.');
    expect(source).not.toContain('Revision {expectedRevision}');
  });

  it('새 인력 catalog 실패를 보조기기에 알리고 인력 명부 용어를 일관되게 쓴다', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('학력·어학·자격을 인력 명부에 저장합니다. 인사정보조회가 이 값을 그대로 읽습니다.');
    expect(source).not.toContain('People 원장');
    expect(source).toContain('인사정보 <span className="font-normal text-slate-500">(선택)</span>');
  });
});

describe('학력 구분과 점수 체계', () => {
  const source = readFileSync(new URL('./ProfessionalProfileEditor.tsx', import.meta.url), 'utf8');

  /**
   * 국가를 249개 중에서 고르게 하던 자리다. 실제로 쓰이는 구분은 국내인지 해외인지,
   * 해외라면 영미권인지 셋뿐이라 목록을 그만큼으로 줄였다.
   */
  it('국가 대신 국내·해외 구분을 고른다', () => {
    expect(source).toContain('catalog.educationRegions.map');
    expect(source).toContain('국내·해외 선택');
    expect(source).not.toContain('countryCode');
    expect(source).not.toContain('ISO');
  });

  /**
   * 점수 체계는 시험마다 하나뿐이다(TOEIC 990, IELTS 9, TEPS 600, OPIc 등급).
   * TOEFL 만 셋이었는데 PBT 는 없어졌고 iBT 6 은 쓰지 않아 iBT 120 으로 고정했다.
   * 고르게 할 것이 없는 칸은 두지 않는다 - 다만 점수 범위 검증은 그대로 산다.
   */
  it('점수 체계를 고르게 하지 않고 시험에서 정한다', () => {
    expect(source).not.toContain('점수 체계');
    expect(source).not.toContain('english-scale-');
    expect(source).toContain('scales[0]?.code');
    // 쓰이지 않게 된 라벨 함수를 남겨 두지 않는다.
    expect(source).not.toContain('formatEnglishScaleLabel');
  });
});
