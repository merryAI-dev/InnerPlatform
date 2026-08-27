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
import { deriveAge, deriveTenure } from '../../platform/person-employment';
import { useMyHrProfile } from './useMyHrProfile';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useTraining } from '../../data/training-store';
import {
  SETTLEMENT_SYSTEM_SHORT,
  TRAINING_CATEGORY_LABELS,
  ENROLLMENT_STATUS_LABELS,
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

/** 인사 명부에서 온 값 한 줄. 여기서 고치지 않으므로 입력칸이 아니라 읽는 줄로 둔다. */
function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-2 border-b border-border/50 last:border-b-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="text-[13px]">{value || '미등록'}</p>
    </div>
  );
}

/**
 * 기본 정보. 인력 명부(persons)가 단일 진실이고 여기서는 자기 것만 읽는다.
 *
 * 예전에는 careerProfiles 라는 별도 컬렉션에 따로 저장했다. 그래서 본인이 고친 값이
 * 명부와 어긋난 채로 남았다 - 정산과 제안서가 명부를 근거로 삼는데도.
 */
function BasicInfoTab() {
  const { data: hr, loading, error } = useMyHrProfile();
  const asOf = new Date().toISOString().slice(0, 10);

  if (loading) return <p className="py-8 text-center text-[12px] text-muted-foreground">인사정보를 불러오는 중…</p>;
  if (error) return <p className="py-8 text-center text-[12px] text-rose-600" role="alert">{error}</p>;
  if (hr && !hr.linked) {
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-muted-foreground">아직 인력 명부에 연결되지 않은 계정입니다.</p>
        <p className="text-[12px] text-muted-foreground mt-1">인사 담당자에게 문의해 주세요.</p>
      </div>
    );
  }

  const person = hr?.person;
  const age = person?.birthDate ? deriveAge(person.birthDate, asOf) : null;
  const tenure = person?.joinedAt ? deriveTenure(person.joinedAt, asOf) : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-[13px]" style={{ fontWeight: 600 }}>기본 정보</h3>
          </div>
          <Badge variant="outline" className="text-[10px]">인사정보 · 조회 전용</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          인력 명부의 값입니다. 고칠 내용이 있으면 인사 담당자에게 알려 주세요.
        </p>
        <div className="mt-3">
          <ProfileRow label="이름" value={person?.name || ''} />
          <ProfileRow label="닉네임" value={person?.nickname || ''} />
          <ProfileRow
            label="생년월일"
            value={person?.birthDate ? `${person.birthDate}${age === null ? '' : ` (만 ${age}세)`}` : ''}
          />
          <ProfileRow label="대분류" value={person?.departmentTop || ''} />
          <ProfileRow label="중분류" value={person?.departmentMid || ''} />
          <ProfileRow label="직책" value={person?.title || ''} />
          <ProfileRow label="직급" value={person?.grade || ''} />
          <ProfileRow
            label="입사일"
            value={person?.joinedAt ? `${person.joinedAt}${tenure ? ` (${tenure.label})` : ''}` : ''}
          />
          <ProfileRow label="이메일" value={person?.email || ''} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── 학력/경력 탭 ──

function EducationCareerTab() {
  const { data: hr, loading: hrLoading, error: hrError } = useMyHrProfile();

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

export function CareerProfilePage() {
  const { data: hr } = useMyHrProfile();
  const { user: authUser } = useAuth();
  const person = hr?.person;
  const displayName = person?.name || authUser?.name || '내 프로필';

  return (
    <div className="p-5 max-w-[900px] mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px]" style={{ fontWeight: 700 }}>마이페이지</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            사업 참여 이력과 사내 교육 이수 이력이 자동으로 반영됩니다.
          </p>
        </div>
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
              {person?.title && (
                <span className="text-[12px] text-muted-foreground">{person.title}</span>
              )}
              {person?.departmentTop && (
                <span className="text-[12px] text-muted-foreground">{person.departmentTop}</span>
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
