import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Award,
  Briefcase,
  CalendarClock,
  GraduationCap,
  Languages,
  Loader2,
  Mail,
  MapPin,
  RefreshCw,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  updatePersonProfileViaBff,
  type ActorLike,
  type PersonRecord,
} from '../../lib/platform-bff-client';
import {
  createPersonProfessionalProfileClient,
  type ProfessionalProfileCatalog,
  type StoredProfessionalProfile,
} from '../../lib/person-professional-profile-client';
import {
  EMPLOYMENT_STATE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  resolveCurrentEmployment,
  deriveAge,
  deriveTenure,
  resolveSeparationDate,
  type EmploymentState,
  type EmploymentType,
} from '../../platform/person-employment';
import { PERSON_GRADES, formatPersonGradeOption, isKnownPersonGrade } from '../../platform/person-grade';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

/**
 * 인사정보 콘솔.
 *
 * 한 사람의 인적사항·학력·어학·자격증·계약 이력을 한 창에서 읽는다. 예전에는 계약 관리와
 * 전문 프로필이 서로 다른 창이라, 같은 사람을 보면서도 두 번 열어야 했다.
 *
 * 조회(인사정보조회)와 입력(기본정보·상세정보)을 탭으로 나눈 것은 쓰는 사람의 목적이
 * 다르기 때문이다 — 대부분은 "누가 어떤 자격을 갖췄나"를 볼 뿐이고, 고치는 일은 드물다.
 */

const NO_GRADE = '__NO_GRADE__';

function formatDate(value?: string | null) {
  return value ? value.slice(0, 10) : '-';
}

/** 그룹웨어 인사기록카드의 요약 줄. 이름 옆에 직급이 붙어야 누구인지 한 번에 읽힌다. */
function SummaryField({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500">{label}</p>
        <p className="truncate text-[13px] font-medium text-slate-900">{value || '-'}</p>
      </div>
    </div>
  );
}

/** 인사정보조회 카드. 건수를 제목에 두고, 비어 있으면 비어 있다고 분명히 적는다. */
function RecordCard({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
          <span className="text-slate-500" aria-hidden>{icon}</span>
          {title}
        </h4>
        <span className="text-[11px] tabular-nums text-slate-500">{count}건</span>
      </header>
      <div className="px-3 py-2.5">
        {count === 0
          ? <p className="py-4 text-center text-[12px] text-slate-400">데이터가 존재하지 않습니다.</p>
          : children}
      </div>
    </section>
  );
}

function RecordRow({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div className="border-b border-slate-100 py-1.5 last:border-b-0">
      <p className="text-[12px] font-medium text-slate-900">{primary}</p>
      {secondary ? <p className="text-[11px] text-slate-500">{secondary}</p> : null}
    </div>
  );
}

export interface PersonProfileFormValue {
  nickname: string;
  email: string;
  birthDate: string;
  grade: string;
  title: string;
  departmentTop: string;
  departmentMid: string;
  workLocation: string;
}

export function personProfileFormFromRecord(person: PersonRecord): PersonProfileFormValue {
  return {
    nickname: person.nickname || '',
    email: person.email || '',
    birthDate: (person.birthDate || '').slice(0, 10),
    grade: person.grade || '',
    title: person.title || '',
    departmentTop: person.departmentTop || '',
    departmentMid: person.departmentMid || '',
    workLocation: person.workLocation || '',
  };
}

/** 저장할 값만 추린다. 서버는 부분 갱신이라 안 바뀐 칸까지 보내면 감사 기록이 뜻을 잃는다. */
export function changedPersonProfileFields(
  before: PersonProfileFormValue,
  after: PersonProfileFormValue,
): Partial<PersonProfileFormValue> {
  const changed: Partial<PersonProfileFormValue> = {};
  (Object.keys(after) as Array<keyof PersonProfileFormValue>).forEach((key) => {
    if (before[key] !== after[key]) changed[key] = after[key];
  });
  return changed;
}

export function PersonHrConsole({
  tenantId,
  actor,
  person,
  canReadProfile,
  canWriteProfile,
  canWritePerson,
  onClose,
  onPersonUpdated,
  onManageEmployment,
  onEditProfessionalProfile,
  asOf,
}: {
  tenantId: string;
  actor: ActorLike;
  person: PersonRecord;
  canReadProfile: boolean;
  canWriteProfile: boolean;
  canWritePerson: boolean;
  onClose: () => void;
  onPersonUpdated: () => void;
  onManageEmployment: () => void;
  onEditProfessionalProfile: () => void;
  asOf: string;
}) {
  const [form, setForm] = useState<PersonProfileFormValue>(() => personProfileFormFromRecord(person));
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<StoredProfessionalProfile | null>(null);
  const [catalog, setCatalog] = useState<ProfessionalProfileCatalog | null>(null);
  const [profileLoading, setProfileLoading] = useState(canReadProfile);
  const [profileError, setProfileError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const baselineRef = useRef(personProfileFormFromRecord(person));

  useEffect(() => {
    const next = personProfileFormFromRecord(person);
    baselineRef.current = next;
    setForm(next);
  }, [person]);

  useEffect(() => {
    if (!canReadProfile) {
      setProfile(null);
      setProfileLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const client = createPersonProfessionalProfileClient({ tenantId, actor });
    setProfileLoading(true);
    setProfileError('');
    void Promise.all([
      client.getCatalog(controller.signal),
      client.get(person.personId, controller.signal),
    ]).then(([nextCatalog, response]) => {
      if (controller.signal.aborted) return;
      setCatalog(nextCatalog);
      setProfile(response.profile);
    }).catch(() => {
      if (controller.signal.aborted) return;
      // 인사정보를 못 읽어도 인적사항·계약 이력은 그대로 보여준다.
      setProfileError('학력·어학·자격 정보를 불러오지 못했습니다.');
    }).finally(() => {
      if (!controller.signal.aborted) setProfileLoading(false);
    });
    return () => controller.abort();
  }, [tenantId, actor, person.personId, canReadProfile, reloadToken]);

  const current = useMemo(() => resolveCurrentEmployment(person, asOf), [person, asOf]);
  const separated = useMemo(() => resolveSeparationDate(person), [person]);
  const tenure = useMemo(() => deriveTenure(person.joinedAt, asOf), [person.joinedAt, asOf]);
  const age = useMemo(() => deriveAge(person.birthDate, asOf), [person.birthDate, asOf]);

  const educationLabelOf = (code: string) => (
    catalog?.educationAttainments.find((entry) => entry.code === code)?.label || code
  );
  const englishLabelOf = (testCode: string, otherName?: string | null) => {
    if (testCode === 'OTHER') return otherName || '기타';
    return catalog?.englishTests.find((entry) => entry.code === testCode)?.displayLabel || testCode;
  };

  const statusText = separated
    ? `${formatDate(separated)} 퇴사`
    : current
      ? `${EMPLOYMENT_STATE_LABELS[current.state as EmploymentState]}${tenure ? ` (${tenure.label})` : ''}`
      : '계약 없음';

  const dirty = Object.keys(changedPersonProfileFields(baselineRef.current, form)).length > 0;

  const saveProfileFields = async () => {
    const changed = changedPersonProfileFields(baselineRef.current, form);
    if (Object.keys(changed).length === 0) return;
    setSaving(true);
    try {
      await updatePersonProfileViaBff({
        tenantId,
        actor,
        personId: person.personId,
        profile: {
          ...changed,
          ...(changed.birthDate !== undefined ? { birthDate: changed.birthDate || null } : {}),
        },
      });
      baselineRef.current = form;
      toast.success('인적사항을 저장했습니다.');
      onPersonUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '인적사항을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const gradeOptionValue = form.grade && isKnownPersonGrade(form.grade) ? form.grade : NO_GRADE;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-[940px] flex-col overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{person.name} 인사정보</DialogTitle>
          <DialogDescription>인적사항, 학력·어학·자격, 계약 이력을 확인하고 수정합니다.</DialogDescription>
        </DialogHeader>

        {/* ── 인사기록카드 머리 — 누구인지, 지금 어떤 상태인지 한 줄에 ── */}
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                <User className="h-7 w-7" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[17px] font-semibold text-slate-950">{person.name}</span>
                  {person.grade ? <span className="text-[14px] font-medium text-slate-700">{person.grade}</span> : null}
                  {person.nickname ? <span className="text-[12px] text-slate-500">({person.nickname})</span> : null}
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  {[person.departmentTop, person.departmentMid, person.title].filter(Boolean).join(' · ') || '소속 미지정'}
                </p>
                <p className="mt-1 text-[12px] text-slate-600">
                  {person.joinedAt ? `${formatDate(person.joinedAt)} 입사` : '입사일 미등록'}
                  {' · '}
                  <span className={separated ? 'text-slate-500' : 'font-medium text-slate-800'}>{statusText}</span>
                  {current ? ` · ${EMPLOYMENT_TYPE_LABELS[current.type as EmploymentType]}` : ''}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[400px]">
              <SummaryField
                icon={<CalendarClock className="h-4 w-4" />}
                label="생년월일"
                value={person.birthDate ? `${formatDate(person.birthDate)}${age === null ? '' : ` (만 ${age}세)`}` : '미등록'}
              />
              <SummaryField icon={<Mail className="h-4 w-4" />} label="이메일" value={person.email || '미등록'} />
              <SummaryField
                icon={<Briefcase className="h-4 w-4" />}
                label="근속"
                value={tenure ? tenure.label : '입사일 필요'}
              />
              <SummaryField icon={<MapPin className="h-4 w-4" />} label="근무지" value={person.workLocation || '미등록'} />
            </div>
          </div>
        </div>

        <Tabs defaultValue="records" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-6 mt-4 w-fit">
            <TabsTrigger value="basic" className="text-[13px]">기본정보</TabsTrigger>
            <TabsTrigger value="records" className="text-[13px]">인사정보조회</TabsTrigger>
            <TabsTrigger value="detail" className="text-[13px]">상세정보</TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-3">
            {/* ── 기본정보: 사람이 적는 인적사항 ── */}
            <TabsContent value="basic" className="mt-0 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[12px]">이름</Label>
                  <Input className="mt-1 h-9" value={person.name} disabled readOnly />
                  <p className="mt-1 text-[11px] text-slate-500">이름은 재직자 명단이 정하므로 여기서 고치지 않습니다.</p>
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-nickname">닉네임</Label>
                  <Input
                    id="hr-nickname" className="mt-1 h-9" value={form.nickname} disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, nickname: event.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-birth">생년월일</Label>
                  <Input
                    id="hr-birth" type="date" className="mt-1 h-9 tabular-nums" value={form.birthDate}
                    disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    만 나이는 저장하지 않고 오늘({asOf}) 기준으로 계산합니다.
                  </p>
                </div>
                <div>
                  <Label className="text-[12px]">직급</Label>
                  <Select
                    value={gradeOptionValue}
                    disabled={!canWritePerson || saving}
                    onValueChange={(value) => setForm({ ...form, grade: value === NO_GRADE ? '' : value })}
                  >
                    <SelectTrigger className="mt-1 h-9 text-[13px]" aria-label="직급"><SelectValue placeholder="직급 선택" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GRADE}>미지정</SelectItem>
                      {PERSON_GRADES.map((grade) => (
                        <SelectItem key={grade.code} value={grade.label}>{formatPersonGradeOption(grade)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.grade && !isKnownPersonGrade(form.grade) ? (
                    <p className="mt-1 text-[11px] text-amber-700">
                      현재 값 &quot;{form.grade}&quot;은 오피스핸드북 직급이 아닙니다. 목록에서 고르면 바뀝니다.
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">괄호 안은 대외 문서용 대응 직급입니다.</p>
                  )}
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-title">직책</Label>
                  <Input
                    id="hr-title" className="mt-1 h-9" value={form.title} disabled={!canWritePerson || saving}
                    placeholder="예: 팀장" onChange={(event) => setForm({ ...form, title: event.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">직급과 다른 축입니다. 맡은 역할을 적습니다.</p>
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-email">이메일</Label>
                  <Input
                    id="hr-email" className="mt-1 h-9" value={form.email} disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-dept-top">소속</Label>
                  <Input
                    id="hr-dept-top" className="mt-1 h-9" value={form.departmentTop} disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, departmentTop: event.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-dept-mid">팀</Label>
                  <Input
                    id="hr-dept-mid" className="mt-1 h-9" value={form.departmentMid} disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, departmentMid: event.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[12px]" htmlFor="hr-location">근무지</Label>
                  <Input
                    id="hr-location" className="mt-1 h-9" value={form.workLocation} disabled={!canWritePerson || saving}
                    onChange={(event) => setForm({ ...form, workLocation: event.target.value })}
                  />
                </div>
              </div>
              {canWritePerson ? (
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void saveProfileFields()} disabled={saving || !dirty}>
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {saving ? '저장 중…' : '인적사항 저장'}
                  </Button>
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">조회 권한만 있어 인적사항을 고칠 수 없습니다.</p>
              )}
            </TabsContent>

            {/* ── 인사정보조회: 학력·어학·자격·계약을 카드로 훑는다 ── */}
            <TabsContent value="records" className="mt-0 space-y-3">
              {!canReadProfile ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-[12px] text-slate-600">
                  학력·어학·자격 정보를 볼 권한이 없습니다. 계약 이력은 상세정보 탭에서 확인할 수 있습니다.
                </p>
              ) : profileLoading ? (
                <p className="py-10 text-center text-[13px] text-slate-500">인사정보를 불러오는 중…</p>
              ) : profileError ? (
                <div className="rounded-md border border-rose-200 bg-white px-3 py-3 text-[12px] text-rose-700" role="alert">
                  <p>{profileError}</p>
                  <Button
                    variant="outline" size="sm" className="mt-2 h-7 gap-1 text-[11px]"
                    onClick={() => setReloadToken((token) => token + 1)}
                  >
                    <RefreshCw className="h-3 w-3" /> 다시 불러오기
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <RecordCard
                      icon={<GraduationCap className="h-3.5 w-3.5" />}
                      title="학력"
                      count={profile?.educationRecords.length || 0}
                    >
                      {(profile?.educationRecords || []).map((record, index) => (
                        <RecordRow
                          key={`${record.attainmentCode}-${index}`}
                          primary={[record.institutionName, record.major].filter(Boolean).join(' · ') || educationLabelOf(record.attainmentCode)}
                          secondary={[
                            educationLabelOf(record.attainmentCode),
                            record.admissionYear || record.degreeYear
                              ? `${record.admissionYear || '?'}~${record.degreeYear || '?'}`
                              : '',
                          ].filter(Boolean).join(' · ')}
                        />
                      ))}
                    </RecordCard>

                    <RecordCard
                      icon={<Languages className="h-3.5 w-3.5" />}
                      title="어학"
                      count={profile?.englishEvidence.length || 0}
                    >
                      {(profile?.englishEvidence || []).map((evidence, index) => (
                        <RecordRow
                          key={`${evidence.testCode}-${index}`}
                          primary={`${englishLabelOf(evidence.testCode, evidence.otherTestName)} ${evidence.resultValue}`}
                          secondary={evidence.testedAt ? `${evidence.testedAt} 취득` : ''}
                        />
                      ))}
                    </RecordCard>

                    <RecordCard
                      icon={<Award className="h-3.5 w-3.5" />}
                      title="자격면허"
                      count={profile?.certifications.length || 0}
                    >
                      {(profile?.certifications || []).map((certification) => (
                        <RecordRow
                          key={certification.key}
                          primary={certification.label}
                          secondary={certification.acquiredAt ? `${certification.acquiredAt} 취득` : ''}
                        />
                      ))}
                    </RecordCard>
                  </div>

                  {canWriteProfile ? (
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={onEditProfessionalProfile}>
                        학력·어학·자격 수정
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </TabsContent>

            {/* ── 상세정보: 계약 이력 — 참여율의 근거가 되는 기간이다 ── */}
            <TabsContent value="detail" className="mt-0 space-y-3">
              <RecordCard
                icon={<Briefcase className="h-3.5 w-3.5" />}
                title="계약 이력"
                count={person.employments.length}
              >
                <div className="space-y-1.5">
                  {person.employments.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
                      <span className="text-[12px] tabular-nums text-slate-700">
                        {formatDate(item.startDate)} ~ {formatDate(item.endDate)}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {EMPLOYMENT_TYPE_LABELS[item.type as EmploymentType]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {EMPLOYMENT_STATE_LABELS[item.state as EmploymentState]}
                      </Badge>
                      {item.note ? <span className="text-[11px] text-slate-500">{item.note}</span> : null}
                    </div>
                  ))}
                </div>
              </RecordCard>
              <p className="text-[11px] text-slate-500">
                계약 이력은 지우지 않고 쌓습니다 — 지난 기간의 참여율이 왜 그 기준이었는지 설명할 근거가 남아야 합니다.
              </p>
              {canWritePerson ? (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={onManageEmployment}>계약 변경·추가</Button>
                </div>
              ) : null}
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex justify-end border-t border-slate-200 px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>닫기</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
