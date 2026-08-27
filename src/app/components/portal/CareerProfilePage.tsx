import { useState, useEffect } from 'react';
import {
  User, GraduationCap, Briefcase, Building2,
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
import { useMyHrProfile } from './useMyHrProfile';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useTraining } from '../../data/training-store';
import {
  SETTLEMENT_SYSTEM_SHORT,
  TRAINING_CATEGORY_LABELS,
  ENROLLMENT_STATUS_LABELS,
  type WorkHistoryEntry,
} from '../../data/types';
import { toast } from 'sonner';


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
  const { myProfile, addWorkHistory, removeWorkHistory } = useCareerProfile();
  const { data: hr, loading: hrLoading, error: hrError } = useMyHrProfile();

  // 직장경력 신규 입력 폼
  const [newWork, setNewWork] = useState({ company: '', title: '', description: '', startDate: '', endDate: '' });
  const [showWorkForm, setShowWorkForm] = useState(false);


  const handleAddWork = async () => {
    if (!newWork.company.trim()) { toast.error('기업명을 입력해 주세요.'); return; }
    await addWorkHistory(newWork);
    setNewWork({ company: '', title: '', description: '', startDate: '', endDate: '' });
    setShowWorkForm(false);
  };

  return (
    <div className="space-y-6">
      {/* 학력·어학·자격은 인력 명부(인사정보)가 단일 진실이다. 여기서는 자기 것을 읽기만 한다. */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-[13px]" style={{ fontWeight: 600 }}>학력 · 어학 · 자격</h3>
            </div>
            <Badge variant="outline" className="text-[10px]">인사정보 · 조회 전용</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            증빙과 함께 인사 담당자가 관리합니다. 고칠 내용이 있으면 인사 담당자에게 알려 주세요.
          </p>

          {hrLoading ? (
            <p className="text-[12px] text-muted-foreground py-4">인사정보를 불러오는 중…</p>
          ) : hrError ? (
            <p className="text-[12px] text-rose-600 py-4" role="alert">{hrError}</p>
          ) : hr && !hr.linked ? (
            <p className="text-[12px] text-muted-foreground py-4">
              아직 인력 명부에 연결되지 않은 계정입니다. 인사 담당자에게 문의해 주세요.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">학력</p>
                {(hr?.profile?.educationRecords || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">등록된 학력이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {(hr?.profile?.educationRecords || []).map((record, index) => {
                      const row = record as Record<string, string | null>;
                      const period = row.admissionYear || row.degreeYear
                        ? `${row.admissionYear || '?'}~${row.degreeYear || '?'}`
                        : '';
                      return (
                        <div key={`edu-${index}`} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                          <p className="text-[13px]" style={{ fontWeight: 600 }}>
                            {[row.institutionName, row.major].filter(Boolean).join(' · ') || '학교 미입력'}
                          </p>
                          <p className="text-[12px] text-muted-foreground">
                            {[row.attainmentCode, period].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground mb-1">어학</p>
                {(hr?.profile?.englishEvidence || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">등록된 어학 성적이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {(hr?.profile?.englishEvidence || []).map((record, index) => {
                      const row = record as Record<string, string | null>;
                      return (
                        <div key={`lang-${index}`} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                          <p className="text-[13px]" style={{ fontWeight: 600 }}>
                            {row.otherTestName || row.testCode} {row.resultValue}
                          </p>
                          {row.testedAt ? <p className="text-[12px] text-muted-foreground">{row.testedAt} 취득</p> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground mb-1">자격증</p>
                {(hr?.profile?.certifications || []).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">등록된 자격증이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {(hr?.profile?.certifications || []).map((cert) => (
                      <div key={cert.key} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                        <p className="text-[13px]" style={{ fontWeight: 600 }}>{cert.label}</p>
                        {cert.acquiredAt ? <p className="text-[12px] text-muted-foreground">{cert.acquiredAt} 취득</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                  <Badge className="text-[10px] h-5 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300 border-0">
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
