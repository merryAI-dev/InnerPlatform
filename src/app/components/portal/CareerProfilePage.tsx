import { useState, useEffect } from 'react';
import {
  User, GraduationCap, Briefcase, Award, Building2,
  Plus, Trash2, Edit2, Save, X, FileDown, Loader2,
  CalendarDays, Phone, Mail, BookOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import { useCareerProfile } from '../../data/career-profile-store';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useTraining } from '../../data/training-store';
import {
  SETTLEMENT_SYSTEM_SHORT,
  TRAINING_CATEGORY_LABELS,
  ENROLLMENT_STATUS_LABELS,
  type DegreeType,
  type EducationEntry,
  type WorkHistoryEntry,
  type CertificationEntry,
} from '../../data/types';
import { toast } from 'sonner';

const DEGREE_OPTIONS: DegreeType[] = ['학사', '석사', '박사', '전문학사', '수료', '기타'];

// ── 섹션 헤더 ──

function SectionHeader({ icon: Icon, title, onAdd, addLabel }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-teal-600" />
        <span className="text-[13px]" style={{ fontWeight: 600 }}>{title}</span>
      </div>
      {onAdd && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd} className="h-7 gap-1.5 text-[11px]">
          <Plus className="w-3 h-3" /> {addLabel || '추가'}
        </Button>
      )}
    </div>
  );
}

// ── 기본 정보 탭 ──

function BasicInfoTab() {
  const { myProfile, saveMyProfile, isLoading } = useCareerProfile();
  const { user: authUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    nameKo: myProfile?.nameKo || authUser?.name || '',
    nameEn: myProfile?.nameEn || '',
    nameHanja: myProfile?.nameHanja || '',
    birthDate: myProfile?.birthDate || '',
    phone: myProfile?.phone || '',
    officePhone: myProfile?.officePhone || '',
    department: myProfile?.department || '',
    title: myProfile?.title || '',
    joinedAt: myProfile?.joinedAt || '',
    bio: myProfile?.bio || '',
  });

  useEffect(() => {
    if (myProfile) {
      setDraft({
        nameKo: myProfile.nameKo || authUser?.name || '',
        nameEn: myProfile.nameEn || '',
        nameHanja: myProfile.nameHanja || '',
        birthDate: myProfile.birthDate || '',
        phone: myProfile.phone || '',
        officePhone: myProfile.officePhone || '',
        department: myProfile.department || '',
        title: myProfile.title || '',
        joinedAt: myProfile.joinedAt || '',
        bio: myProfile.bio || '',
      });
    }
  }, [myProfile]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveMyProfile(draft);
    setSaving(false);
    if (ok) {
      setEditing(false);
      toast.success('기본 정보가 저장되었습니다.');
    }
  };

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {editing ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="h-8 gap-1.5 text-[12px]">
              <X className="w-3.5 h-3.5" /> 취소
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 gap-1.5 text-[12px]">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 저장
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-8 gap-1.5 text-[12px]">
            <Edit2 className="w-3.5 h-3.5" /> 편집
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: '국문 성명', field: 'nameKo' as const },
          { label: '영문 성명', field: 'nameEn' as const },
          { label: '한자 성명', field: 'nameHanja' as const },
        ].map(({ label, field }) => (
          <div key={field}>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">{label}</Label>
            {editing ? (
              <Input value={draft[field]} onChange={(e) => setDraft((p) => ({ ...p, [field]: e.target.value }))} className="h-9 text-[13px]" />
            ) : (
              <p className="text-[13px] py-1.5">{(myProfile as any)?.[field] || '—'}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: '생년월일', field: 'birthDate' as const, icon: CalendarDays, type: 'date' },
          { label: '입사일', field: 'joinedAt' as const, icon: CalendarDays, type: 'date' },
          { label: '핸드폰', field: 'phone' as const, icon: Phone, type: 'text' },
          { label: '직장 전화', field: 'officePhone' as const, icon: Phone, type: 'text' },
          { label: '부서', field: 'department' as const, icon: Building2, type: 'text' },
          { label: '직책', field: 'title' as const, icon: Briefcase, type: 'text' },
        ].map(({ label, field, icon: Icon, type }) => (
          <div key={field}>
            <Label className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
              <Icon className="w-3 h-3" /> {label}
            </Label>
            {editing ? (
              <Input type={type} value={draft[field]} onChange={(e) => setDraft((p) => ({ ...p, [field]: e.target.value }))} className="h-9 text-[13px]" />
            ) : (
              <p className="text-[13px] py-1.5">{(myProfile as any)?.[field] || '—'}</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <Label className="text-[11px] text-muted-foreground mb-1.5 block">간단 소개</Label>
        {editing ? (
          <Textarea
            value={draft.bio}
            onChange={(e) => setDraft((p) => ({ ...p, bio: e.target.value }))}
            placeholder="본인을 간략히 소개해 주세요."
            className="text-[13px] min-h-[80px]"
          />
        ) : (
          <p className="text-[13px] py-1.5 text-muted-foreground leading-relaxed">{myProfile?.bio || '소개가 없습니다.'}</p>
        )}
      </div>
    </div>
  );
}

// ── 학력/경력 탭 ──

function EducationCareerTab() {
  const {
    myProfile,
    addEducation, updateEducation, removeEducation,
    addWorkHistory, removeWorkHistory,
    addCertification, removeCertification,
  } = useCareerProfile();

  // 학력 신규 입력 폼
  const [newEdu, setNewEdu] = useState({ school: '', major: '', degree: '학사' as DegreeType, startDate: '', endDate: '' });
  const [showEduForm, setShowEduForm] = useState(false);

  // 직장경력 신규 입력 폼
  const [newWork, setNewWork] = useState({ company: '', title: '', description: '', startDate: '', endDate: '' });
  const [showWorkForm, setShowWorkForm] = useState(false);

  // 자격증 신규 입력 폼
  const [newCert, setNewCert] = useState({ name: '', issuedAt: '', issuer: '' });
  const [showCertForm, setShowCertForm] = useState(false);

  const handleAddEducation = async () => {
    if (!newEdu.school.trim()) { toast.error('학교명을 입력해 주세요.'); return; }
    await addEducation(newEdu);
    setNewEdu({ school: '', major: '', degree: '학사', startDate: '', endDate: '' });
    setShowEduForm(false);
  };

  const handleAddWork = async () => {
    if (!newWork.company.trim()) { toast.error('기업명을 입력해 주세요.'); return; }
    await addWorkHistory(newWork);
    setNewWork({ company: '', title: '', description: '', startDate: '', endDate: '' });
    setShowWorkForm(false);
  };

  const handleAddCert = async () => {
    if (!newCert.name.trim()) { toast.error('자격증명을 입력해 주세요.'); return; }
    await addCertification(newCert);
    setNewCert({ name: '', issuedAt: '', issuer: '' });
    setShowCertForm(false);
  };

  return (
    <div className="space-y-6">
      {/* 학력 */}
      <Card>
        <CardContent className="p-4">
          <SectionHeader icon={GraduationCap} title="학력" onAdd={() => setShowEduForm(true)} />
          {(myProfile?.education || []).length === 0 && !showEduForm && (
            <p className="text-[12px] text-muted-foreground py-2">등록된 학력이 없습니다.</p>
          )}
          <div className="space-y-2">
            {(myProfile?.education || []).map((edu) => (
              <div key={edu.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="min-w-0">
                  <p className="text-[13px]" style={{ fontWeight: 600 }}>{edu.school}</p>
                  <p className="text-[12px] text-muted-foreground">{edu.major} · {edu.degree}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{edu.startDate} ~ {edu.endDate}</p>
                </div>
                <button onClick={() => removeEducation(edu.id)} className="text-muted-foreground hover:text-rose-500 ml-3 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          {showEduForm && (
            <div className="mt-3 p-3 border border-teal-200 dark:border-teal-800 rounded-lg space-y-2 bg-teal-50/20 dark:bg-teal-950/10">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label className="text-[11px] text-muted-foreground mb-1 block">학교명</Label>
                  <Input value={newEdu.school} onChange={(e) => setNewEdu((p) => ({ ...p, school: e.target.value }))} placeholder="예: 한국외국어대학교" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">전공</Label>
                  <Input value={newEdu.major} onChange={(e) => setNewEdu((p) => ({ ...p, major: e.target.value }))} placeholder="예: 국제학" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">학위</Label>
                  <select value={newEdu.degree} onChange={(e) => setNewEdu((p) => ({ ...p, degree: e.target.value as DegreeType }))} className="h-8 w-full rounded-md border border-input bg-input-background px-2 text-[12px]">
                    {DEGREE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">입학 (YYYY-MM)</Label>
                  <Input value={newEdu.startDate} onChange={(e) => setNewEdu((p) => ({ ...p, startDate: e.target.value }))} placeholder="2015-03" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">졸업 (YYYY-MM)</Label>
                  <Input value={newEdu.endDate} onChange={(e) => setNewEdu((p) => ({ ...p, endDate: e.target.value }))} placeholder="2019-02 또는 재학중" className="h-8 text-[12px]" />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowEduForm(false)} className="h-7 text-[11px]">취소</Button>
                <Button size="sm" onClick={handleAddEducation} className="h-7 text-[11px]">추가</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 직장경력 */}
      <Card>
        <CardContent className="p-4">
          <SectionHeader icon={Briefcase} title="직장경력 (MYSC 이전)" onAdd={() => setShowWorkForm(true)} />
          {(myProfile?.workHistory || []).length === 0 && !showWorkForm && (
            <p className="text-[12px] text-muted-foreground py-2">등록된 경력이 없습니다.</p>
          )}
          <div className="space-y-2">
            {(myProfile?.workHistory || []).map((wh) => (
              <div key={wh.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="min-w-0">
                  <p className="text-[13px]" style={{ fontWeight: 600 }}>{wh.company}</p>
                  <p className="text-[12px] text-muted-foreground">{wh.title}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{wh.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{wh.startDate} ~ {wh.endDate}</p>
                </div>
                <button onClick={() => removeWorkHistory(wh.id)} className="text-muted-foreground hover:text-rose-500 ml-3 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          {showWorkForm && (
            <div className="mt-3 p-3 border border-teal-200 dark:border-teal-800 rounded-lg space-y-2 bg-teal-50/20 dark:bg-teal-950/10">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">기업명</Label>
                  <Input value={newWork.company} onChange={(e) => setNewWork((p) => ({ ...p, company: e.target.value }))} placeholder="예: KOICA" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">최종직위</Label>
                  <Input value={newWork.title} onChange={(e) => setNewWork((p) => ({ ...p, title: e.target.value }))} placeholder="예: 인턴" className="h-8 text-[12px]" />
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px] text-muted-foreground mb-1 block">담당업무/주요프로젝트</Label>
                  <Input value={newWork.description} onChange={(e) => setNewWork((p) => ({ ...p, description: e.target.value }))} placeholder="주요 업무 내용" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">시작 (YYYY-MM)</Label>
                  <Input value={newWork.startDate} onChange={(e) => setNewWork((p) => ({ ...p, startDate: e.target.value }))} placeholder="2020-06" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">종료 (YYYY-MM)</Label>
                  <Input value={newWork.endDate} onChange={(e) => setNewWork((p) => ({ ...p, endDate: e.target.value }))} placeholder="2021-02 또는 현재" className="h-8 text-[12px]" />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowWorkForm(false)} className="h-7 text-[11px]">취소</Button>
                <Button size="sm" onClick={handleAddWork} className="h-7 text-[11px]">추가</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 자격증 */}
      <Card>
        <CardContent className="p-4">
          <SectionHeader icon={Award} title="자격증" onAdd={() => setShowCertForm(true)} />
          {(myProfile?.certifications || []).length === 0 && !showCertForm && (
            <p className="text-[12px] text-muted-foreground py-2">등록된 자격증이 없습니다.</p>
          )}
          <div className="space-y-2">
            {(myProfile?.certifications || []).map((cert) => (
              <div key={cert.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="min-w-0">
                  <p className="text-[13px]" style={{ fontWeight: 600 }}>{cert.name}</p>
                  <p className="text-[12px] text-muted-foreground">{cert.issuer} · {cert.issuedAt}</p>
                </div>
                <button onClick={() => removeCertification(cert.id)} className="text-muted-foreground hover:text-rose-500 ml-3 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          {showCertForm && (
            <div className="mt-3 p-3 border border-teal-200 dark:border-teal-800 rounded-lg space-y-2 bg-teal-50/20 dark:bg-teal-950/10">
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label className="text-[11px] text-muted-foreground mb-1 block">자격증명</Label>
                  <Input value={newCert.name} onChange={(e) => setNewCert((p) => ({ ...p, name: e.target.value }))} placeholder="예: ODA 전문가 과정" className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">취득일</Label>
                  <Input type="date" value={newCert.issuedAt} onChange={(e) => setNewCert((p) => ({ ...p, issuedAt: e.target.value }))} className="h-8 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1 block">발행기관</Label>
                  <Input value={newCert.issuer} onChange={(e) => setNewCert((p) => ({ ...p, issuer: e.target.value }))} placeholder="예: KOICA" className="h-8 text-[12px]" />
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => setShowCertForm(false)} className="h-7 text-[11px]">취소</Button>
                <Button size="sm" onClick={handleAddCert} className="h-7 text-[11px]">추가</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 참여 사업 탭 ──

function ParticipationTab() {
  const { participationEntries } = usePortalStore();
  const { user: authUser } = useAuth();
  const myEntries = participationEntries.filter((e) => e.memberId === authUser?.uid);

  if (myEntries.length === 0) {
    return (
      <div className="py-8 text-center">
        <Building2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-[13px] text-muted-foreground">참여 사업 이력이 없습니다.</p>
        <p className="text-[12px] text-muted-foreground mt-1">관리자가 참여율을 입력하면 자동으로 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {myEntries.map((entry) => (
        <Card key={entry.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px]" style={{ fontWeight: 600 }}>{entry.projectName}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">{entry.clientOrg}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] h-5">
                    {entry.periodStart} ~ {entry.periodEnd}
                  </Badge>
                  <Badge className="text-[10px] h-5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border-0">
                    {SETTLEMENT_SYSTEM_SHORT[entry.settlementSystem]}
                  </Badge>
                  {entry.isDocumentOnly && (
                    <Badge variant="outline" className="text-[10px] h-5 text-amber-600 border-amber-300">
                      서류상 인력
                    </Badge>
                  )}
                </div>
                {entry.note && <p className="text-[11px] text-muted-foreground mt-1.5">{entry.note}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[20px] text-teal-600 dark:text-teal-400" style={{ fontWeight: 700 }}>{entry.rate}%</p>
                <p className="text-[10px] text-muted-foreground">참여율</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── 사내 교육 탭 ──

function TrainingTab() {
  const { myEnrollments } = useTraining();

  const completed = myEnrollments.filter((e) => e.status === 'COMPLETED');
  const enrolled = myEnrollments.filter((e) => e.status === 'ENROLLED');

  if (myEnrollments.length === 0) {
    return (
      <div className="py-8 text-center">
        <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-[13px] text-muted-foreground">수강 이력이 없습니다.</p>
        <p className="text-[12px] text-muted-foreground mt-1">포털 &gt; 사내 교육에서 강의를 신청해 보세요.</p>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    COMPLETED: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
    ENROLLED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    DROPPED: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-2">
      {myEnrollments.map((e) => (
        <Card key={e.id}>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px]" style={{ fontWeight: 600 }}>{e.courseTitle}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                신청일: {e.enrolledAt.slice(0, 10)}
                {e.completedAt && ` · 이수일: ${e.completedAt.slice(0, 10)}`}
              </p>
            </div>
            <Badge className={`text-[10px] h-5 border-0 shrink-0 ${statusColor[e.status] || ''}`}>
              {ENROLLMENT_STATUS_LABELS[e.status]}
            </Badge>
          </CardContent>
        </Card>
      ))}

      {completed.length > 0 && (
        <div className="pt-2 border-t border-border mt-4">
          <p className="text-[11px] text-muted-foreground">
            총 이수 완료: <strong>{completed.length}개</strong> 강의
          </p>
        </div>
      )}
    </div>
  );
}

// ── 이력서 내보내기 ──

function exportProfile(profile: ReturnType<typeof useCareerProfile>['myProfile'], name: string) {
  if (!profile) return;
  const lines: string[] = [
    `# ${name} 이력서`,
    '',
    '## 가. 인적사항',
    `| 항목 | 내용 |`,
    `| --- | --- |`,
    `| 성명 (국문) | ${profile.nameKo} |`,
    `| 성명 (영문) | ${profile.nameEn || '—'} |`,
    `| 생년월일 | ${profile.birthDate || '—'} |`,
    `| 연락처 | ${profile.phone || '—'} |`,
    `| 직책 | ${profile.title || '—'} |`,
    `| 입사일 | ${profile.joinedAt || '—'} |`,
    '',
    '## 나. 학력',
    '| 시작 | 종료 | 학교명 | 전공 | 학위 |',
    '| --- | --- | --- | --- | --- |',
    ...(profile.education || []).map((e) =>
      `| ${e.startDate} | ${e.endDate} | ${e.school} | ${e.major} | ${e.degree} |`
    ),
    '',
    '## 다. 직장경력',
    '| 시작 | 종료 | 기업명 | 최종직위 | 담당업무 |',
    '| --- | --- | --- | --- | --- |',
    ...(profile.workHistory || []).map((w) =>
      `| ${w.startDate} | ${w.endDate} | ${w.company} | ${w.title} | ${w.description} |`
    ),
    '',
    '## 라. 자격증',
    '| 자격증명 | 취득일 | 발행기관 |',
    '| --- | --- | --- |',
    ...(profile.certifications || []).map((c) =>
      `| ${c.name} | ${c.issuedAt} | ${c.issuer} |`
    ),
  ];

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `이력서_${profile.nameKo}_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 메인 페이지 ──

export function CareerProfilePage() {
  const { myProfile } = useCareerProfile();
  const { user: authUser } = useAuth();
  const displayName = myProfile?.nameKo || authUser?.name || '내 프로필';

  return (
    <div className="p-5 max-w-[900px] mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px]" style={{ fontWeight: 700 }}>내 경력 프로필</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            사업 참여 이력과 사내 교육 이수 이력이 자동으로 반영됩니다.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportProfile(myProfile, displayName)}
          className="h-8 gap-1.5 text-[12px]"
        >
          <FileDown className="w-3.5 h-3.5" /> 이력서 내보내기
        </Button>
      </div>

      {/* 프로필 요약 카드 */}
      <Card className="bg-gradient-to-r from-teal-50/50 to-slate-50/50 dark:from-teal-950/20 dark:to-slate-950/20 border-teal-200/60 dark:border-teal-800/40">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[16px]" style={{ fontWeight: 700 }}>{displayName}</p>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {myProfile?.title && (
                <span className="text-[12px] text-muted-foreground">{myProfile.title}</span>
              )}
              {myProfile?.department && (
                <span className="text-[12px] text-muted-foreground">{myProfile.department}</span>
              )}
              {authUser?.email && (
                <span className="text-[12px] text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3 h-3" /> {authUser.email}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 탭 */}
      <Tabs defaultValue="basic">
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="basic" className="text-[12px]">기본 정보</TabsTrigger>
          <TabsTrigger value="education" className="text-[12px]">학력/경력</TabsTrigger>
          <TabsTrigger value="participation" className="text-[12px]">참여 사업</TabsTrigger>
          <TabsTrigger value="training" className="text-[12px]">사내 교육</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="basic"><BasicInfoTab /></TabsContent>
          <TabsContent value="education"><EducationCareerTab /></TabsContent>
          <TabsContent value="participation"><ParticipationTab /></TabsContent>
          <TabsContent value="training"><TrainingTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
