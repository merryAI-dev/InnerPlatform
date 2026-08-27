import { useEffect, useRef, useState } from 'react';
import { Award, GraduationCap, Languages, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createPersonProfessionalProfileClient,
  type ProfessionalProfileCatalog,
  type ProfessionalProfileEvidenceRef,
  type ProfessionalProfileEducationRecordInput,
  type ProfessionalProfileEnglishEvidenceInput,
  type ProfessionalProfileInput,
  type StoredProfessionalProfile,
} from '../../lib/person-professional-profile-client';
import type { ActorLike } from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { Badge } from '../ui/badge';
import { EvidenceAttachment } from './EvidenceAttachment';
import { Button } from '../ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { Separator } from '../ui/separator';
import { Textarea } from '../ui/textarea';

const MAX_EDUCATION_RECORDS = 10;
const MAX_ENGLISH_EVIDENCE = 10;
const MAX_CERTIFICATIONS = 20;
const EMPTY_OPTION = '__EMPTY_OPTION__';

export interface ProfessionalProfileCertificationDraft {
  label: string;
  acquiredAt: string;
  evidence?: ProfessionalProfileEvidenceRef | null;
}

export interface ProfessionalProfileDraft {
  educationRecords: ProfessionalProfileEducationRecordInput[];
  englishEvidence: ProfessionalProfileEnglishEvidenceInput[];
  /** 취득일을 항목마다 받아야 해서 자유 텍스트가 아니라 행으로 관리한다. */
  certifications: ProfessionalProfileCertificationDraft[];
}

export interface ProfessionalProfileSaveAttempt {
  fingerprint: string;
  key: string;
}

type EditorError = {
  kind: 'load' | 'save' | 'conflict';
  message: string;
};

export function createEmptyProfessionalProfileDraft(): ProfessionalProfileDraft {
  return { educationRecords: [], englishEvidence: [], certifications: [] };
}

export function professionalProfileDraftToInput(draft: ProfessionalProfileDraft): ProfessionalProfileInput {
  return {
    educationRecords: draft.educationRecords.map((record) => ({
      attainmentCode: record.attainmentCode,
      institutionName: record.institutionName?.trim() || null,
      countryCode: record.countryCode?.trim() || null,
      major: record.major?.trim() || null,
      admissionYear: record.admissionYear?.trim() || null,
      degreeYear: record.degreeYear?.trim() || null,
      evidence: record.evidence || null,
    })),
    englishEvidence: draft.englishEvidence.map((evidence) => ({
      testCode: evidence.testCode,
      scaleCode: evidence.scaleCode,
      resultValue: evidence.resultValue.trim(),
      otherTestName: evidence.otherTestName?.trim() || null,
      testedAt: evidence.testedAt?.trim() || null,
      evidence: evidence.evidence || null,
    })),
    certifications: draft.certifications
      .map((certification) => ({
        label: certification.label.trim(),
        acquiredAt: certification.acquiredAt.trim() || null,
        evidence: certification.evidence || null,
      }))
      .filter((certification) => certification.label.length > 0),
  };
}

export function hasProfessionalProfileFacts(draft: ProfessionalProfileDraft): boolean {
  return draft.educationRecords.length > 0
    || draft.englishEvidence.length > 0
    || draft.certifications.some((certification) => certification.label.trim().length > 0);
}

export function resolveProfessionalProfileSaveAttempt(
  current: ProfessionalProfileSaveAttempt | null,
  input: {
    personId: string;
    expectedRevision: number;
    profile: ProfessionalProfileInput;
    randomUUID: () => string;
  },
): ProfessionalProfileSaveAttempt {
  const fingerprint = JSON.stringify({
    personId: input.personId,
    expectedRevision: input.expectedRevision,
    profile: input.profile,
  });
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    key: `professional-profile:${encodeURIComponent(input.personId)}:${input.randomUUID()}`,
  };
}

function certificationDraftError(draft: ProfessionalProfileDraft): string | null {
  const filled = draft.certifications.filter((certification) => certification.label.trim().length > 0);
  if (filled.length > MAX_CERTIFICATIONS) return '자격증은 최대 20개까지 입력할 수 있습니다.';
  if (filled.some(({ label }) => label.trim().length > 80)) return '자격증 이름은 각각 80자 이내로 입력해 주세요.';
  if (draft.certifications.some(({ acquiredAt }) => acquiredAt.trim() && !/^\d{4}-(0[1-9]|1[0-2])$/.test(acquiredAt.trim()))) {
    return '자격증 취득일은 YYYY-MM 형식으로 입력해 주세요.';
  }
  return null;
}

function storedProfileToDraft(profile: StoredProfessionalProfile): ProfessionalProfileDraft {
  return {
    educationRecords: profile.educationRecords.map((record) => ({ ...record })),
    englishEvidence: profile.englishEvidence.map((evidence) => ({ ...evidence })),
    certifications: profile.certifications.map((certification) => ({
      label: certification.label,
      acquiredAt: certification.acquiredAt || '',
      evidence: certification.evidence || null,
    })),
  };
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') return '';
  const nested = (body as { code?: unknown; error?: unknown }).code
    || (body as { code?: unknown; error?: unknown }).error;
  return typeof nested === 'string' ? nested : '';
}

function ProfileSectionHeader({
  icon: Icon, title, count, limit, onAdd, disabled, readOnly,
}: {
  icon: typeof GraduationCap;
  title: string;
  count: number;
  limit: number;
  onAdd: () => void;
  disabled: boolean;
  readOnly: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-slate-500" />
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <span className="text-[11px] tabular-nums text-slate-500">{count}/{limit}</span>
      {!readOnly ? (
        <Button
          type="button" variant="outline" size="sm" className="ml-auto h-7 gap-1 px-2 text-[11px]"
          aria-label={`${title} 추가`}
          onClick={onAdd} disabled={disabled || count >= limit}
        >
          <Plus className="h-3 w-3" /> 추가
        </Button>
      ) : null}
    </div>
  );
}

export function formatEnglishScaleLabel(scale: ProfessionalProfileCatalog['englishTests'][number]['scales'][number]): string {
  return scale.label ?? scale.code;
}

function ProfessionalProfileFields({
  catalog, draft, onChange, disabled, readOnly, tenantId, actor, personId,
}: {
  catalog: ProfessionalProfileCatalog;
  draft: ProfessionalProfileDraft;
  onChange: (next: ProfessionalProfileDraft) => void;
  disabled: boolean;
  readOnly: boolean;
  tenantId: string;
  actor: ActorLike;
  /** 새 인력 등록처럼 아직 사람이 없으면 증빙은 등록 뒤에 붙인다. */
  personId: string | null;
}) {
  const addEducation = () => {
    const attainment = catalog.educationAttainments[0];
    if (!attainment || draft.educationRecords.length >= MAX_EDUCATION_RECORDS) return;
    onChange({
      ...draft,
      educationRecords: [...draft.educationRecords, {
        attainmentCode: attainment.code,
        institutionName: null,
        countryCode: null,
        major: null,
      }],
    });
  };

  const addEnglish = () => {
    const test = catalog.englishTests[0];
    const scale = test?.scales[0];
    if (!test || !scale || draft.englishEvidence.length >= MAX_ENGLISH_EVIDENCE) return;
    onChange({
      ...draft,
      englishEvidence: [...draft.englishEvidence, {
        testCode: test.code,
        scaleCode: scale.code,
        resultValue: '',
        otherTestName: null,
        testedAt: null,
      }],
    });
  };

  const updateEducation = (index: number, patch: Partial<ProfessionalProfileEducationRecordInput>) => {
    onChange({
      ...draft,
      educationRecords: draft.educationRecords.map((record, recordIndex) => (
        recordIndex === index ? { ...record, ...patch } : record
      )),
    });
  };

  const updateEnglish = (index: number, patch: Partial<ProfessionalProfileEnglishEvidenceInput>) => {
    onChange({
      ...draft,
      englishEvidence: draft.englishEvidence.map((evidence, evidenceIndex) => (
        evidenceIndex === index ? { ...evidence, ...patch } : evidence
      )),
    });
  };

  const certificationCount = draft.certifications.filter((certification) => certification.label.trim()).length;
  const certificationError = certificationDraftError(draft);

  return (
    <div className="space-y-5">
      <section className="space-y-2.5" aria-label="학력">
        <ProfileSectionHeader
          icon={GraduationCap} title="최종학력·학력 이력"
          count={draft.educationRecords.length} limit={MAX_EDUCATION_RECORDS}
          onAdd={addEducation} disabled={disabled} readOnly={readOnly}
        />
        {draft.educationRecords.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-slate-500">입력된 학력이 없습니다.</p>
        ) : draft.educationRecords.map((record, index) => (
          <div key={`education-${index}`} className="rounded-lg border bg-slate-50/60 p-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <Label className="text-[11px]" htmlFor={`education-attainment-${index}`}>학력 구분</Label>
                <Select
                  value={record.attainmentCode}
                  onValueChange={(value) => updateEducation(index, { attainmentCode: value })}
                  disabled={disabled || readOnly}
                >
                  <SelectTrigger id={`education-attainment-${index}`} className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {catalog.educationAttainments.map((attainment) => (
                      <SelectItem key={attainment.code} value={attainment.code}>{attainment.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]" htmlFor={`education-institution-${index}`}>학교</Label>
                <Input
                  id={`education-institution-${index}`} className="mt-1 h-9" maxLength={80}
                  value={record.institutionName || ''} disabled={disabled || readOnly}
                  placeholder="학교명"
                  onChange={(event) => updateEducation(index, { institutionName: event.target.value })}
                />
              </div>
              <div>
                <Label className="text-[11px]" htmlFor={`education-country-${index}`}>국가</Label>
                <Select
                  value={record.countryCode || EMPTY_OPTION}
                  onValueChange={(value) => updateEducation(index, { countryCode: value === EMPTY_OPTION ? null : value })}
                  disabled={disabled || readOnly}
                >
                  <SelectTrigger id={`education-country-${index}`} className="mt-1 h-9"><SelectValue placeholder="국가 선택" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={EMPTY_OPTION}>미입력</SelectItem>
                    {catalog.countryCodes.map((countryCode) => (
                      <SelectItem key={countryCode} value={countryCode}>{countryCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]" htmlFor={`education-major-${index}`}>전공</Label>
                <Input
                  id={`education-major-${index}`} className="mt-1 h-9" maxLength={80}
                  value={record.major || ''} disabled={disabled || readOnly}
                  placeholder="전공명"
                  onChange={(event) => updateEducation(index, { major: event.target.value })}
                />
              </div>
              {/* 재학·수료·졸업 상태는 위 '학력 구분' 코드가 이미 담고 있다(석사 수료 등).
                  여기서는 언제 다녔는지만 받는다. */}
              <div>
                <Label className="text-[11px]" htmlFor={`education-admission-${index}`}>입학년도</Label>
                <Input
                  id={`education-admission-${index}`} className="mt-1 h-9 tabular-nums" inputMode="numeric" maxLength={4}
                  value={record.admissionYear || ''} disabled={disabled || readOnly}
                  placeholder="예: 2015"
                  onChange={(event) => updateEducation(index, { admissionYear: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
              </div>
              <div>
                <Label className="text-[11px]" htmlFor={`education-degree-year-${index}`}>학위취득년도</Label>
                <Input
                  id={`education-degree-year-${index}`} className="mt-1 h-9 tabular-nums" inputMode="numeric" maxLength={4}
                  value={record.degreeYear || ''} disabled={disabled || readOnly}
                  placeholder="예: 2019"
                  onChange={(event) => updateEducation(index, { degreeYear: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {personId ? (
                <EvidenceAttachment
                  tenantId={tenantId} actor={actor} personId={personId}
                  label={`학력 ${index + 1}`} evidence={record.evidence} disabled={disabled} readOnly={readOnly}
                  onChange={(evidence) => updateEducation(index, { evidence })}
                />
              ) : <span className="text-[11px] text-slate-400">증빙은 인력을 등록한 뒤 붙일 수 있습니다.</span>}
              {!readOnly ? (
                <Button
                  type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
                  disabled={disabled}
                  onClick={() => onChange({
                    ...draft,
                    educationRecords: draft.educationRecords.filter((_, recordIndex) => recordIndex !== index),
                  })}
                >
                  <Trash2 className="h-3 w-3" /> 이 학력 삭제
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <Separator />

      <section className="space-y-2.5" aria-label="영어 증빙">
        <ProfileSectionHeader
          icon={Languages} title="영어 증빙"
          count={draft.englishEvidence.length} limit={MAX_ENGLISH_EVIDENCE}
          onAdd={addEnglish} disabled={disabled} readOnly={readOnly}
        />
        {draft.englishEvidence.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-slate-500">입력된 영어 증빙이 없습니다.</p>
        ) : draft.englishEvidence.map((evidence, index) => {
          const selectedTest = catalog.englishTests.find(({ code }) => code === evidence.testCode)
            || catalog.englishTests[0];
          const selectedScale = selectedTest?.scales.find(({ code }) => code === evidence.scaleCode)
            || selectedTest?.scales[0];
          const isFreeTextTest = selectedTest?.scales.some(({ resultType }) => resultType === 'TEXT') === true;
          return (
            <div key={`english-${index}`} className="rounded-lg border bg-slate-50/60 p-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px]" htmlFor={`english-test-${index}`}>시험</Label>
                  <Select
                    value={evidence.testCode}
                    disabled={disabled || readOnly}
                    onValueChange={(value) => {
                      const test = catalog.englishTests.find(({ code }) => code === value);
                      updateEnglish(index, {
                        testCode: value,
                        scaleCode: test?.scales[0]?.code || '',
                        resultValue: '',
                        otherTestName: null,
                      });
                    }}
                  >
                    <SelectTrigger id={`english-test-${index}`} className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {catalog.englishTests.map((test) => (
                        <SelectItem key={test.code} value={test.code}>{test.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]" htmlFor={`english-scale-${index}`}>점수 체계</Label>
                  <Select
                    value={evidence.scaleCode}
                    disabled={disabled || readOnly}
                    onValueChange={(value) => updateEnglish(index, { scaleCode: value, resultValue: '' })}
                  >
                    <SelectTrigger id={`english-scale-${index}`} className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {selectedTest.scales.map((scale) => (
                        <SelectItem key={scale.code} value={scale.code}>{formatEnglishScaleLabel(scale)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]" htmlFor={`english-result-${index}`}>결과</Label>
                  {selectedScale?.resultType === 'GRADE' ? (
                    <Select
                      value={evidence.resultValue || EMPTY_OPTION}
                      disabled={disabled || readOnly}
                      onValueChange={(value) => updateEnglish(index, { resultValue: value === EMPTY_OPTION ? '' : value })}
                    >
                      <SelectTrigger id={`english-result-${index}`} className="mt-1 h-9"><SelectValue placeholder="등급 선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY_OPTION}>미입력</SelectItem>
                        {(selectedScale.allowedValues || []).map((value) => (
                          <SelectItem key={value} value={value}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`english-result-${index}`} className="mt-1 h-9" maxLength={80}
                      type={selectedScale?.resultType === 'NUMBER' ? 'number' : 'text'}
                      min={selectedScale?.min} max={selectedScale?.max} step={selectedScale?.step}
                      value={evidence.resultValue} disabled={disabled || readOnly}
                      placeholder={selectedScale?.resultType === 'NUMBER' ? '점수' : '결과'}
                      onChange={(event) => updateEnglish(index, { resultValue: event.target.value })}
                    />
                  )}
                </div>
                <div>
                  <Label className="text-[11px]" htmlFor={`english-tested-at-${index}`}>시험월</Label>
                  <Input
                    id={`english-tested-at-${index}`} className="mt-1 h-9" type="month"
                    value={evidence.testedAt || ''} disabled={disabled || readOnly}
                    onChange={(event) => updateEnglish(index, { testedAt: event.target.value })}
                  />
                </div>
                {isFreeTextTest ? (
                  <div className="sm:col-span-2">
                    <Label className="text-[11px]" htmlFor={`english-other-name-${index}`}>시험명</Label>
                    <Input
                      id={`english-other-name-${index}`} className="mt-1 h-9" maxLength={80}
                      value={evidence.otherTestName || ''} disabled={disabled || readOnly}
                      placeholder="시험명을 입력해 주세요"
                      onChange={(event) => updateEnglish(index, { otherTestName: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                {personId ? (
                  <EvidenceAttachment
                    tenantId={tenantId} actor={actor} personId={personId}
                    label={`어학 ${index + 1}`} evidence={evidence.evidence} disabled={disabled} readOnly={readOnly}
                    onChange={(next) => updateEnglish(index, { evidence: next })}
                  />
                ) : <span className="text-[11px] text-slate-400">증빙은 인력을 등록한 뒤 붙일 수 있습니다.</span>}
                {!readOnly ? (
                  <Button
                    type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
                    disabled={disabled}
                    onClick={() => onChange({
                      ...draft,
                      englishEvidence: draft.englishEvidence.filter((_, evidenceIndex) => evidenceIndex !== index),
                    })}
                  >
                    <Trash2 className="h-3 w-3" /> 이 어학 삭제
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <Separator />

      <section className="space-y-2" aria-label="자격증">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">자격증</h3>
          <span className={`text-[11px] tabular-nums ${certificationError ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
            {certificationCount}/{MAX_CERTIFICATIONS}
          </span>
        </div>
        {!readOnly ? (
          <Button
            type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]"
            disabled={disabled || draft.certifications.length >= MAX_CERTIFICATIONS}
            onClick={() => onChange({
              ...draft,
              certifications: [...draft.certifications, { label: '', acquiredAt: '', evidence: null }],
            })}
          >
            <Plus className="h-3 w-3" /> 자격증 추가
          </Button>
        ) : null}
        {draft.certifications.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-slate-500">입력된 자격증이 없습니다.</p>
        ) : draft.certifications.map((certification, index) => (
          <div key={`certification-${index}`} className="grid gap-2.5 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
            <div>
              <Label className="text-[11px]" htmlFor={`certification-label-${index}`}>자격증 이름</Label>
              <Input
                id={`certification-label-${index}`} className="mt-1 h-9" maxLength={80}
                value={certification.label} disabled={disabled || readOnly}
                placeholder="예: 정보처리기사"
                onChange={(event) => onChange({
                  ...draft,
                  certifications: draft.certifications.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, label: event.target.value } : item
                  )),
                })}
              />
            </div>
            <div>
              <Label className="text-[11px]" htmlFor={`certification-acquired-${index}`}>취득일</Label>
              <Input
                id={`certification-acquired-${index}`} type="month" className="mt-1 h-9 tabular-nums"
                value={certification.acquiredAt} disabled={disabled || readOnly}
                onChange={(event) => onChange({
                  ...draft,
                  certifications: draft.certifications.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, acquiredAt: event.target.value } : item
                  )),
                })}
              />
            </div>
            {!readOnly ? (
              <Button
                type="button" variant="ghost" size="sm" className="h-9 gap-1 px-2 text-[11px] text-slate-500"
                disabled={disabled} aria-label={`자격증 ${index + 1} 삭제`}
                onClick={() => onChange({
                  ...draft,
                  certifications: draft.certifications.filter((_, itemIndex) => itemIndex !== index),
                })}
              >
                <Trash2 className="h-3 w-3" /> 삭제
              </Button>
            ) : null}
            <div className="sm:col-span-3">
              {personId ? (
                <EvidenceAttachment
                  tenantId={tenantId} actor={actor} personId={personId}
                  label={`자격증 ${index + 1}`} evidence={certification.evidence} disabled={disabled} readOnly={readOnly}
                  onChange={(evidence) => onChange({
                    ...draft,
                    certifications: draft.certifications.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, evidence } : item
                    )),
                  })}
                />
              ) : <span className="text-[11px] text-slate-400">증빙은 인력을 등록한 뒤 붙일 수 있습니다.</span>}
            </div>
          </div>
        ))}
        <p className={`text-[11px] ${certificationError ? 'text-rose-700' : 'text-slate-500'}`}>
          {certificationError
            ? certificationError
            : '증빙자료가 제출된 자격증만 적습니다. 같은 이름은 저장할 때 하나로 정리됩니다.'}
        </p>
      </section>
    </div>
  );
}

export function ProfessionalProfileEditor({
  tenantId, actor, personId, personName, canWrite, onClose,
}: {
  tenantId: string;
  actor: ActorLike;
  personId: string;
  personName: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const actorScopeKey = `${actor.uid}\u0000${actor.role || ''}`;
  const scopeKey = `${tenantId}\u0000${personId}\u0000${actorScopeKey}`;
  const clientRef = useRef(createPersonProfessionalProfileClient({ tenantId, actor }));
  clientRef.current = createPersonProfessionalProfileClient({ tenantId, actor });
  const [catalog, setCatalog] = useState<ProfessionalProfileCatalog | null>(null);
  const [draft, setDraft] = useState<ProfessionalProfileDraft>(createEmptyProfessionalProfileDraft);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<EditorError | null>(null);
  const aliveRef = useRef(true);
  const currentScopeRef = useRef(scopeKey);
  currentScopeRef.current = scopeKey;
  const scopeGenerationRef = useRef({ key: scopeKey, generation: 0 });
  if (scopeGenerationRef.current.key !== scopeKey) {
    scopeGenerationRef.current = { key: scopeKey, generation: scopeGenerationRef.current.generation + 1 };
  }
  const renderScopeRef = useRef(scopeKey);
  const loadedScopeRef = useRef<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const saveAttemptRef = useRef<ProfessionalProfileSaveAttempt | null>(null);
  const scopeLoaded = renderScopeRef.current === scopeKey;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      renderScopeRef.current = '';
      loadedScopeRef.current = null;
      loadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const scopeClient = clientRef.current;
    renderScopeRef.current = scopeKey;
    loadedScopeRef.current = null;
    saveAttemptRef.current = null;
    setCatalog(null);
    setDraft(createEmptyProfessionalProfileDraft());
    setExpectedRevision(0);
    setLoading(true);
    setSaving(false);
    setError(null);
    void Promise.all([
      scopeClient.getCatalog(controller.signal),
      scopeClient.get(personId, controller.signal),
    ]).then(([nextCatalog, response]) => {
      if (controller.signal.aborted || !aliveRef.current || currentScopeRef.current !== scopeKey) return;
      setCatalog(nextCatalog);
      setDraft(storedProfileToDraft(response.profile));
      setExpectedRevision(response.revision);
      loadedScopeRef.current = scopeKey;
      setLoading(false);
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted || !aliveRef.current || currentScopeRef.current !== scopeKey) return;
      setError({
        kind: 'load',
        message: resolveApiErrorMessage(loadError, '인사정보를 불러오지 못했습니다.'),
      });
      setLoading(false);
    });
    return () => {
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = null;
    };
  }, [scopeKey]);

  const reloadCanonicalProfile = async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const reloadScope = scopeKey;
    loadedScopeRef.current = null;
    setLoading(true);
    setError(null);
    try {
      const [nextCatalog, response] = await Promise.all([
        catalog ? Promise.resolve(catalog) : clientRef.current.getCatalog(controller.signal),
        clientRef.current.get(personId, controller.signal),
      ]);
      if (controller.signal.aborted || !aliveRef.current || currentScopeRef.current !== reloadScope) return;
      setCatalog(nextCatalog);
      setDraft(storedProfileToDraft(response.profile));
      setExpectedRevision(response.revision);
      saveAttemptRef.current = null;
      loadedScopeRef.current = reloadScope;
    } catch (loadError: unknown) {
      if (controller.signal.aborted || !aliveRef.current || currentScopeRef.current !== reloadScope) return;
      setError({
        kind: 'load',
        message: resolveApiErrorMessage(loadError, '최신 인사정보를 불러오지 못했습니다.'),
      });
    } finally {
      if (!controller.signal.aborted && aliveRef.current && currentScopeRef.current === reloadScope) setLoading(false);
    }
  };

  const save = async () => {
    if (!canWrite || saving) return;
    if (loadedScopeRef.current !== scopeKey || loading || !catalog) return;
    const draftError = certificationDraftError(draft);
    if (draftError) {
      setError({ kind: 'save', message: draftError });
      return;
    }
    const profile = professionalProfileDraftToInput(draft);
    saveAttemptRef.current = resolveProfessionalProfileSaveAttempt(saveAttemptRef.current, {
      personId,
      expectedRevision,
      profile,
      randomUUID: () => crypto.randomUUID(),
    });
    const idempotencyKey = saveAttemptRef.current.key;
    setSaving(true);
    setError(null);
    const saveScope = scopeKey;
    const saveGeneration = scopeGenerationRef.current.generation;
    try {
      const canonical = await clientRef.current.save(personId, {
        expectedRevision,
        profile,
        idempotencyKey,
      });
      if (!aliveRef.current
        || currentScopeRef.current !== saveScope
        || scopeGenerationRef.current.generation !== saveGeneration
        || loadedScopeRef.current !== saveScope) return;
      setDraft(storedProfileToDraft(canonical.profile));
      setExpectedRevision(canonical.revision);
      saveAttemptRef.current = null;
      toast.success(`${personName}님의 인사정보를 저장했습니다.`);
    } catch (saveError: unknown) {
      if (!aliveRef.current
        || currentScopeRef.current !== saveScope
        || scopeGenerationRef.current.generation !== saveGeneration) return;
      if (readErrorCode(saveError) === 'professional_profile_revision_conflict') {
        setError({
          kind: 'conflict',
          message: '다른 사용자가 먼저 수정했습니다. 입력한 내용은 그대로 두었어요.',
        });
      } else {
        setError({
          kind: 'save',
          message: resolveApiErrorMessage(saveError, '인사정보를 저장하지 못했습니다. 입력값을 확인해 주세요.'),
        });
      }
    } finally {
      if (aliveRef.current && scopeGenerationRef.current.generation === saveGeneration) setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent
        className="flex max-h-[90vh] max-w-[820px] flex-col overflow-hidden"
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-4 w-4" /> {personName} — 학력·어학·자격
          </DialogTitle>
          <DialogDescription>
            학력·어학·자격을 인력 명부에 저장합니다. 인사정보조회가 이 값을 그대로 읽습니다.
          </DialogDescription>
        </DialogHeader>

        {!canWrite ? <Badge variant="secondary" className="w-fit text-[10px]">조회 전용</Badge> : null}

        {scopeLoaded && error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
            <p>{error.message}</p>
            <Button
              type="button" variant="outline" size="sm" className="mt-2 h-7 gap-1 bg-white px-2 text-[11px]"
              onClick={() => void reloadCanonicalProfile()} disabled={loading || saving}
            >
              <RefreshCw className="h-3 w-3" />
              {error.kind === 'conflict' ? '최신 정보 다시 불러오기' : '다시 불러오기'}
            </Button>
          </div>
        ) : null}

        <div className="-mx-6 flex-1 overflow-y-auto px-6 py-1">
          {loading || !catalog || !scopeLoaded ? (
            <div className="py-12 text-center text-sm text-slate-500">인사정보를 불러오는 중…</div>
          ) : (
            <ProfessionalProfileFields
              catalog={catalog} draft={draft} onChange={setDraft}
              disabled={saving} readOnly={!canWrite}
              tenantId={tenantId} actor={actor} personId={personId}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={requestClose} disabled={saving}>닫기</Button>
          {canWrite ? (
            <Button
              type="button" size="sm" onClick={() => void save()}
              disabled={loading || saving || !catalog || loadedScopeRef.current !== scopeKey || !!certificationDraftError(draft)}
            >
              {saving ? '저장 중…' : '저장'}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewPersonProfessionalProfileFields({
  tenantId, actor, disabled, onChange,
}: {
  tenantId: string;
  actor: ActorLike;
  disabled: boolean;
  onChange: (profile: ProfessionalProfileInput | null, valid: boolean) => void;
}) {
  const createScopeKey = `${tenantId}\u0000${actor.uid}\u0000${actor.role || ''}`;
  const clientRef = useRef(createPersonProfessionalProfileClient({ tenantId, actor }));
  clientRef.current = createPersonProfessionalProfileClient({ tenantId, actor });
  const [catalog, setCatalog] = useState<ProfessionalProfileCatalog | null>(null);
  const [draft, setDraft] = useState<ProfessionalProfileDraft>(createEmptyProfessionalProfileDraft);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setDraft(createEmptyProfessionalProfileDraft());
    onChange(null, true);
    setLoading(true);
    setError(null);
    void clientRef.current.getCatalog(controller.signal).then((nextCatalog) => {
      if (controller.signal.aborted) return;
      setCatalog(nextCatalog);
      setLoading(false);
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted) return;
      setError(resolveApiErrorMessage(loadError, '인사정보 입력 기준을 불러오지 못했습니다.'));
      setLoading(false);
    });
    return () => controller.abort();
  }, [createScopeKey, reloadToken]);

  const updateDraft = (next: ProfessionalProfileDraft) => {
    setDraft(next);
    const valid = certificationDraftError(next) === null;
    onChange(valid && hasProfessionalProfileFacts(next) ? professionalProfileDraftToInput(next) : null, valid);
  };

  return (
    <section className="space-y-3 rounded-xl border bg-slate-50/40 p-4" aria-label="신규 인력 인사정보">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">인사정보 <span className="font-normal text-slate-500">(선택)</span></h3>
        <p className="mt-0.5 text-[11px] text-slate-500">입력한 경우에만 인력 등록과 함께 저장됩니다.</p>
      </div>
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          <p>{error}</p>
          <Button
            type="button" variant="outline" size="sm" className="mt-2 h-7 bg-white px-2 text-[11px]"
            onClick={() => setReloadToken((value) => value + 1)} disabled={loading || disabled}
          >
            다시 불러오기
          </Button>
        </div>
      ) : null}
      {loading || !catalog ? (
        <p className="py-5 text-center text-xs text-slate-500">입력 기준을 불러오는 중…</p>
      ) : (
        <ProfessionalProfileFields
          catalog={catalog} draft={draft} onChange={updateDraft}
          disabled={disabled} readOnly={false}
          tenantId={tenantId} actor={actor} personId={null}
        />
      )}
    </section>
  );
}
