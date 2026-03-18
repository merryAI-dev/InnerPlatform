import { useState } from 'react';
import { BookOpen, Search, Clock, Users, CheckCircle2, Loader2, GraduationCap, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { useTraining } from '../../data/training-store';
import {
  TRAINING_CATEGORY_LABELS,
  TRAINING_STATUS_LABELS,
  ENROLLMENT_STATUS_LABELS,
  type TrainingCourse,
  type TrainingCategory,
} from '../../data/types';

// ── 카테고리 필터 ──

const CATEGORY_FILTERS: { value: 'all' | TrainingCategory; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'management', label: '사업관리' },
  { value: 'compliance', label: '컴플라이언스' },
  { value: 'technical', label: '직무/기술' },
  { value: 'soft-skills', label: '소프트스킬' },
  { value: 'language', label: '어학' },
  { value: 'other', label: '기타' },
];

const categoryColors: Record<TrainingCategory, string> = {
  technical: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  compliance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'soft-skills': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  management: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  language: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  other: 'bg-muted text-muted-foreground',
};

const enrollmentStatusColors: Record<string, string> = {
  ENROLLED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  COMPLETED: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  DROPPED: 'bg-muted text-muted-foreground',
};

// ── 강의 카드 ──

function CourseCard({
  course,
  isEnrolled,
  isCompleted,
  onEnroll,
}: {
  course: TrainingCourse;
  isEnrolled: boolean;
  isCompleted: boolean;
  onEnroll: (course: TrainingCourse) => void;
}) {
  const isOpen = course.status === 'OPEN';

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <Badge className={`text-[10px] h-5 border-0 ${categoryColors[course.category]}`}>
                {TRAINING_CATEGORY_LABELS[course.category]}
              </Badge>
              {course.isRequired && (
                <Badge className="text-[10px] h-5 border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  필수
                </Badge>
              )}
              {isCompleted && (
                <Badge className="text-[10px] h-5 border-0 bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> 이수완료
                </Badge>
              )}
            </div>

            <h3 className="text-[14px] mb-1" style={{ fontWeight: 600 }}>{course.title}</h3>
            <p className="text-[12px] text-muted-foreground line-clamp-2">{course.description}</p>

            <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <GraduationCap className="w-3 h-3" /> {course.instructor}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" /> {course.durationHours}시간
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" /> 최대 {course.maxParticipants}명
              </span>
              <span>{course.startDate} ~ {course.endDate}</span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-2">
            <Badge variant="outline" className={`text-[10px] h-5 ${!isOpen ? 'opacity-60' : ''}`}>
              {TRAINING_STATUS_LABELS[course.status]}
            </Badge>
            {isCompleted ? (
              <Button size="sm" variant="outline" disabled className="h-8 text-[11px] text-teal-600 border-teal-300">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 이수완료
              </Button>
            ) : isEnrolled ? (
              <Button size="sm" variant="outline" disabled className="h-8 text-[11px]">
                신청완료
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onEnroll(course)}
                disabled={!isOpen}
                className="h-8 text-[11px]"
              >
                {isOpen ? '신청하기' : '마감'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 메인 페이지 ──

export function PortalTrainingPage() {
  const { courses, myEnrollments, enrollTraining } = useTraining();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TrainingCategory>('all');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [enrollTarget, setEnrollTarget] = useState<TrainingCourse | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  // 수강 상태 맵
  const enrolledCourseIds = new Set(
    myEnrollments.filter((e) => e.status === 'ENROLLED').map((e) => e.courseId)
  );
  const completedCourseIds = new Set(
    myEnrollments.filter((e) => e.status === 'COMPLETED').map((e) => e.courseId)
  );

  // 필터된 강의 목록
  const filteredCourses = courses.filter((c) => {
    if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
    if (requiredOnly && !c.isRequired) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase()) && !c.instructor.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 수강 신청 처리
  const handleConfirmEnroll = async () => {
    if (!enrollTarget) return;
    setEnrolling(true);
    await enrollTraining(enrollTarget.id);
    setEnrolling(false);
    setEnrollTarget(null);
  };

  const completedCount = myEnrollments.filter((e) => e.status === 'COMPLETED').length;
  const enrolledCount = myEnrollments.filter((e) => e.status === 'ENROLLED').length;

  return (
    <div className="p-5 max-w-[900px] mx-auto space-y-5">
      {/* 헤더 */}
      <div>
        <h1 className="text-[18px]" style={{ fontWeight: 700 }}>사내 교육</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          사내 강의를 신청하고 이수한 교육은 경력 프로필에 자동으로 반영됩니다.
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] text-muted-foreground">이수 완료</p>
            <p className="text-[24px] text-teal-600 mt-0.5" style={{ fontWeight: 700 }}>{completedCount}</p>
            <p className="text-[10px] text-muted-foreground">강의</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] text-muted-foreground">수강 중</p>
            <p className="text-[24px] text-blue-600 mt-0.5" style={{ fontWeight: 700 }}>{enrolledCount}</p>
            <p className="text-[10px] text-muted-foreground">강의</p>
          </CardContent>
        </Card>
        <Card className="hidden sm:block">
          <CardContent className="p-3">
            <p className="text-[11px] text-muted-foreground">개설 강의</p>
            <p className="text-[24px] text-indigo-600 mt-0.5" style={{ fontWeight: 700 }}>
              {courses.filter((c) => c.status === 'OPEN').length}
            </p>
            <p className="text-[10px] text-muted-foreground">모집 중</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="h-9">
          <TabsTrigger value="all" className="text-[12px]">전체 강의</TabsTrigger>
          <TabsTrigger value="mine" className="text-[12px]">
            내 수강
            {myEnrollments.length > 0 && (
              <Badge className="ml-1.5 text-[9px] h-4 px-1 bg-primary/15 text-primary border-0">
                {myEnrollments.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* 전체 강의 */}
        <TabsContent value="all" className="mt-4 space-y-4">
          {/* 검색 & 필터 */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="강의명 또는 강사 검색..."
                className="h-9 text-[13px] pl-9"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {CATEGORY_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setCategoryFilter(f.value)}
                  className={`h-7 px-3 rounded-full text-[11px] border transition-all ${
                    categoryFilter === f.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-primary/50 text-muted-foreground'
                  }`}
                  style={{ fontWeight: categoryFilter === f.value ? 600 : 400 }}
                >
                  {f.label}
                </button>
              ))}
              <button
                onClick={() => setRequiredOnly((p) => !p)}
                className={`h-7 px-3 rounded-full text-[11px] border transition-all ${
                  requiredOnly
                    ? 'bg-rose-500 text-white border-rose-500'
                    : 'border-border hover:border-rose-400 text-muted-foreground'
                }`}
                style={{ fontWeight: requiredOnly ? 600 : 400 }}
              >
                필수 교육만
              </button>
            </div>
          </div>

          {filteredCourses.length === 0 ? (
            <div className="py-12 text-center">
              <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-[13px] text-muted-foreground">검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCourses.map((course) => (
                <CourseCard
                  key={course.id}
                  course={course}
                  isEnrolled={enrolledCourseIds.has(course.id)}
                  isCompleted={completedCourseIds.has(course.id)}
                  onEnroll={setEnrollTarget}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* 내 수강 */}
        <TabsContent value="mine" className="mt-4">
          {myEnrollments.length === 0 ? (
            <div className="py-12 text-center">
              <GraduationCap className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-[13px] text-muted-foreground">신청한 강의가 없습니다.</p>
              <p className="text-[12px] text-muted-foreground mt-1">전체 강의 탭에서 원하는 강의를 신청해 보세요.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myEnrollments.map((enrollment) => {
                const course = courses.find((c) => c.id === enrollment.courseId);
                return (
                  <Card key={enrollment.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px]" style={{ fontWeight: 600 }}>{enrollment.courseTitle}</p>
                        {course && (
                          <p className="text-[12px] text-muted-foreground mt-0.5">
                            {course.startDate} ~ {course.endDate} · 강사: {course.instructor}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          신청일: {enrollment.enrolledAt.slice(0, 10)}
                          {enrollment.completedAt && ` · 이수일: ${enrollment.completedAt.slice(0, 10)}`}
                        </p>
                      </div>
                      <Badge className={`text-[10px] h-5 border-0 shrink-0 ${enrollmentStatusColors[enrollment.status] || ''}`}>
                        {ENROLLMENT_STATUS_LABELS[enrollment.status]}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* 수강 신청 확인 다이얼로그 */}
      <AlertDialog open={!!enrollTarget} onOpenChange={(open) => !open && setEnrollTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>강의 수강 신청</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>다음 강의를 신청하시겠습니까?</p>
                {enrollTarget && (
                  <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                    <p className="text-[13px] text-foreground" style={{ fontWeight: 600 }}>{enrollTarget.title}</p>
                    <p className="text-[12px]">강사: {enrollTarget.instructor}</p>
                    <p className="text-[12px]">{enrollTarget.startDate} ~ {enrollTarget.endDate} · {enrollTarget.durationHours}시간</p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEnroll} disabled={enrolling}>
              {enrolling ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />신청 중...</> : '신청'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
