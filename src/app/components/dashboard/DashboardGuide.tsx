import { useMemo, useState } from 'react';
import {
  BookOpen, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  Calendar, Clock, Banknote, Shield, Info, CircleAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import type { Project, Transaction } from '../../data/types';
import { ACCOUNT_TYPE_LABELS } from '../../data/types';

// ── Validation Types ──

export interface CheckItem {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  detail?: string;
}

export interface ProjectValidation {
  projectId: string;
  projectName: string;
  checks: CheckItem[];
  passCount: number;
  totalCount: number;
  score: number; // 0-100
}

// ── Validation Logic ──

export function validateProject(
  project: Project,
  transactions: Transaction[],
  hasLedger: boolean,
): ProjectValidation {
  const projectTx = transactions.filter(t => t.projectId === project.id);
  const approvedTx = projectTx.filter(t => t.state === 'APPROVED');
  const totalIn = approvedTx.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amounts.bankAmount, 0);
  const totalOut = approvedTx.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amounts.bankAmount, 0);

  const checks: CheckItem[] = [];

  // 1. 전용/운영통장 여부
  const accountOk = project.accountType !== 'NONE';
  checks.push({
    id: 'account-type',
    label: '통장 구분',
    description: '전용통장/운영통장 여부 지정',
    passed: accountOk,
    severity: 'error',
    detail: accountOk
      ? ACCOUNT_TYPE_LABELS[project.accountType]
      : '통장 구분이 지정되지 않았습니다',
  });

  // 2. 캐시플로 원장 링크
  checks.push({
    id: 'ledger-link',
    label: '원장 연결',
    description: '캐시플로(사용내역 연동) 원장 존재 여부',
    passed: hasLedger,
    severity: 'error',
    detail: hasLedger ? '원장이 연결되어 있습니다' : '연결된 원장이 없습니다',
  });

  // 3. 업데이트 날짜 & 담당자
  const hasManager = !!project.managerId && project.managerId.trim() !== '';
  const hasRecentUpdate = (() => {
    if (!project.updatedAt) return false;
    const updated = new Date(project.updatedAt);
    const now = new Date('2026-02-13T00:00:00Z'); // today
    const diffDays = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 30; // within last 30 days
  })();
  checks.push({
    id: 'update-manager',
    label: '업데이트 & 담당자',
    description: '최근 업데이트 일시 및 담당자 지정 여부',
    passed: hasManager && hasRecentUpdate,
    severity: hasManager ? 'warning' : 'error',
    detail: (() => {
      const parts: string[] = [];
      if (!hasManager) parts.push('담당자 미지정');
      if (!hasRecentUpdate) parts.push('30일 이상 미업데이트');
      if (parts.length === 0) return `담당자: ${project.managerName}, 최근 업데이트: ${project.updatedAt.slice(0, 10)}`;
      return parts.join(' / ');
    })(),
  });

  // 4. 총계약금액 = 캐시플로 입금합계
  const contractMatchesIn = (() => {
    if (project.contractAmount === 0) return true; // 계약전 미확정
    if (totalIn === 0 && project.status === 'CONTRACT_PENDING') return true; // 계약전이면 입금 없어도 OK
    return project.contractAmount === totalIn;
  })();
  checks.push({
    id: 'amount-in-match',
    label: '총계약금액 = 입금합계',
    description: '총계약금액과 캐시플로 입금합계 일치 여부',
    passed: contractMatchesIn,
    severity: 'warning',
    detail: (() => {
      if (project.contractAmount === 0) return '계약금액 미확정';
      const diff = project.contractAmount - totalIn;
      if (diff === 0) return '일치';
      return `차이: ${diff.toLocaleString('ko-KR')}원 (계약: ${project.contractAmount.toLocaleString('ko-KR')} / 입금: ${totalIn.toLocaleString('ko-KR')})`;
    })(),
  });

  // 5. 총계약금액 = 출금합계 (차이시 이유)
  const contractMatchesOut = (() => {
    if (project.contractAmount === 0) return true;
    if (totalOut === 0 && project.status === 'CONTRACT_PENDING') return true;
    if (project.contractAmount !== totalOut && project.cashflowDiffNote) return true; // 차이 이유 있으면 OK
    return project.contractAmount === totalOut;
  })();
  checks.push({
    id: 'amount-out-match',
    label: '총계약금액 ≈ 출금합계',
    description: '총계약금액과 캐시플로 출금합계 일치 (차이 시 사유 기입)',
    passed: contractMatchesOut,
    severity: 'warning',
    detail: (() => {
      if (project.contractAmount === 0) return '계약금액 미확정';
      const diff = project.contractAmount - totalOut;
      if (diff === 0) return '일치';
      if (project.cashflowDiffNote) return `차이 사유: ${project.cashflowDiffNote}`;
      return `차이: ${diff.toLocaleString('ko-KR')}원 (사유 미기입)`;
    })(),
  });

  // 6. 확인자 닉네임
  const hasConfirmer = !!project.confirmerName && project.confirmerName.trim() !== '';
  checks.push({
    id: 'confirmer',
    label: '확인자',
    description: '확인자(센터장/그룹장) 닉네임 기입 여부',
    passed: hasConfirmer,
    severity: 'warning',
    detail: hasConfirmer ? `확인자: ${project.confirmerName}` : '확인자 미지정',
  });

  const passCount = checks.filter(c => c.passed).length;
  const totalCount = checks.length;
  const score = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  return {
    projectId: project.id,
    projectName: project.name,
    checks,
    passCount,
    totalCount,
    score,
  };
}

// ── Update Schedule Helper ──

function getNextUpdateFridays(): { next: Date; isOverdue: boolean; daysLeft: number } {
  const today = new Date('2026-02-13T00:00:00Z');
  const year = today.getFullYear();
  const month = today.getMonth();

  // Find 2nd and 4th Fridays of current month
  const fridays: Date[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    if (dt.getDay() === 5) fridays.push(dt); // Friday
  }

  const secondFriday = fridays[1];
  const fourthFriday = fridays[3];

  let nextDate: Date;
  if (today <= secondFriday) {
    nextDate = secondFriday;
  } else if (today <= fourthFriday) {
    nextDate = fourthFriday;
  } else {
    // Next month's 2nd Friday
    const nextMonth = month + 1;
    const nextFridays: Date[] = [];
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, nextMonth, d);
      if (dt.getMonth() !== nextMonth) break;
      if (dt.getDay() === 5) nextFridays.push(dt);
    }
    nextDate = nextFridays[1];
  }

  const diffMs = nextDate.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const isToday = daysLeft === 0;

  return {
    next: nextDate,
    isOverdue: isToday,
    daysLeft,
  };
}

// ── Components ──

function CheckIcon({ passed, severity }: { passed: boolean; severity: string }) {
  if (passed) return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (severity === 'error') return <XCircle className="w-4 h-4 text-rose-500 shrink-0" />;
  return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
}

// ── Guide Panel ──

export function DashboardGuidePanel() {
  const [expanded, setExpanded] = useState(false);
  const schedule = useMemo(() => getNextUpdateFridays(), []);

  return (
    <div className="rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50/50 to-blue-50/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
            <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <span className="text-[13px] text-indigo-900" style={{ fontWeight: 600 }}>대시보드 작성 가이드</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
              schedule.daysLeft <= 1
                ? 'bg-rose-100 text-rose-700 border border-rose-200'
                : schedule.daysLeft <= 3
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}
            style={{ fontWeight: 500 }}
          >
            <Calendar className="w-3 h-3" />
            {schedule.isOverdue
              ? '오늘 업데이트!'
              : `다음: ${schedule.next.getMonth() + 1}/${schedule.next.getDate()}(금) — ${schedule.daysLeft}일`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-7 w-7 p-0 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-100"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-indigo-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-3">
            {/* 입력 시기 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-blue-800" style={{ fontWeight: 600 }}>
                <Clock className="w-3.5 h-3.5" />
                입력 시기
              </div>
              <ul className="space-y-1 text-muted-foreground ml-5">
                <li className="list-disc">계약 전이라도 <span className="text-foreground" style={{ fontWeight: 500 }}>사업 선정 후 1주일 이내</span> 입력</li>
                <li className="list-disc">사업진행상태: <Badge variant="outline" className="text-[10px] py-0 px-1">계약전</Badge> 으로 설정</li>
                <li className="list-disc">금액 미확정 시에도 <span className="text-foreground" style={{ fontWeight: 500 }}>총 계약금액, 캐시플로 예상 입금시기</span> 입력</li>
              </ul>
            </div>

            {/* 중요 데이터 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-red-700" style={{ fontWeight: 600 }}>
                <Banknote className="w-3.5 h-3.5" />
                중요 데이터
              </div>
              <div className="bg-red-50 rounded-md px-3 py-2 border border-red-200">
                <p className="text-red-800" style={{ fontWeight: 500 }}>
                  운영통장으로 입금, 운영통장에서 출금되는 Big Money!
                </p>
                <p className="text-red-600 mt-0.5">
                  전용/운영통장 구분을 반드시 확인하세요.
                </p>
              </div>
            </div>

            {/* 업데이트 시기 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-blue-800" style={{ fontWeight: 600 }}>
                <Calendar className="w-3.5 h-3.5" />
                업데이트 시기
              </div>
              <ul className="space-y-1 text-muted-foreground ml-5">
                <li className="list-disc">매월 <span className="text-foreground" style={{ fontWeight: 500 }}>2주, 4주 금요일</span> 업데이트</li>
                <li className="list-disc"><span className="text-foreground" style={{ fontWeight: 500 }}>계획과 실적의 합계(Sum)</span>가 반드시 일치해야 함</li>
              </ul>
            </div>

            {/* 기본 체크 사항 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-blue-800" style={{ fontWeight: 600 }}>
                <Shield className="w-3.5 h-3.5" />
                기본 체크 사항 (6개 항목)
              </div>
              <ol className="space-y-1 text-muted-foreground ml-5">
                <li className="list-decimal">전용/운영통장 여부</li>
                <li className="list-decimal">캐시플로 원장 연결</li>
                <li className="list-decimal">업데이트 날짜 & 담당자</li>
                <li className="list-decimal">총계약금액 = 캐시플로 입금합계</li>
                <li className="list-decimal">총계약금액 = 캐시플로 출금합계 (차이 사유 기입)</li>
                <li className="list-decimal">확인자 닉네임 기입 <span className="text-foreground">(Joint Action → 메인 PM 소속 센터장)</span></li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Validation Summary Card ──

interface ValidationSummaryProps {
  validations: ProjectValidation[];
}

export function ValidationSummaryCard({ validations }: ValidationSummaryProps) {
  const [showDetails, setShowDetails] = useState(false);

  const summary = useMemo(() => {
    const total = validations.length;
    const perfect = validations.filter(v => v.score === 100).length;
    const hasErrors = validations.filter(v => v.checks.some(c => !c.passed && c.severity === 'error')).length;
    const avgScore = total > 0 ? Math.round(validations.reduce((s, v) => s + v.score, 0) / total) : 0;

    const checkTotals = validations.reduce((acc, v) => {
      v.checks.forEach(c => {
        if (!acc[c.id]) acc[c.id] = { label: c.label, passed: 0, failed: 0 };
        if (c.passed) acc[c.id].passed++;
        else acc[c.id].failed++;
      });
      return acc;
    }, {} as Record<string, { label: string; passed: number; failed: number }>);

    return { total, perfect, hasErrors, avgScore, checkTotals };
  }, [validations]);

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-amber-50 flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-amber-600" />
            </div>
            검증 현황
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="text-[10px] gap-1 h-6 text-muted-foreground hover:text-foreground"
          >
            {showDetails ? '접기' : '상세'}
            {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Overview */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div className="text-center p-2 rounded-lg bg-slate-50">
            <p className="text-[20px] text-slate-800" style={{ fontWeight: 700 }}>{summary.total}</p>
            <p className="text-[10px] text-slate-500">전체 사업</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-emerald-50">
            <p className="text-[20px] text-emerald-600" style={{ fontWeight: 700 }}>{summary.perfect}</p>
            <p className="text-[10px] text-slate-500">검증 완료</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-rose-50">
            <p className="text-[20px] text-rose-600" style={{ fontWeight: 700 }}>{summary.hasErrors}</p>
            <p className="text-[10px] text-slate-500">필수 누락</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-indigo-50">
            <div className="flex items-center justify-center gap-0.5">
              <p className="text-[20px] text-indigo-600" style={{ fontWeight: 700 }}>{summary.avgScore}</p>
              <span className="text-[12px] text-indigo-400">%</span>
            </div>
            <p className="text-[10px] text-slate-500">평균 점수</p>
          </div>
        </div>

        {/* Check item summary */}
        <div className="space-y-1.5">
          {Object.entries(summary.checkTotals).map(([id, data]) => {
            const total = data.passed + data.failed;
            const pct = total > 0 ? Math.round((data.passed / total) * 100) : 0;
            return (
              <div key={id} className="flex items-center gap-2 text-xs">
                <span className="w-32 text-muted-foreground truncate">{data.label}</span>
                <Progress value={pct} className="flex-1 h-2" />
                <span className="w-16 text-right" style={{ fontWeight: 500 }}>
                  <span className="text-green-700">{data.passed}</span>
                  <span className="text-muted-foreground">/{total}</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* Per-project details */}
        {showDetails && (
          <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto">
            {validations
              .sort((a, b) => a.score - b.score)
              .map(v => (
                <div key={v.projectId} className="border rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs truncate max-w-[200px]" style={{ fontWeight: 500 }}>{v.projectName}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        v.score === 100
                          ? 'text-green-700 border-green-300'
                          : v.score >= 67
                          ? 'text-amber-700 border-amber-300'
                          : 'text-red-700 border-red-300'
                      }`}
                    >
                      {v.passCount}/{v.totalCount} ({v.score}%)
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    {v.checks.map(c => (
                      <div key={c.id} className="flex items-center gap-1.5 text-[11px]">
                        <CheckIcon passed={c.passed} severity={c.severity} />
                        <span className={c.passed ? 'text-muted-foreground' : ''} style={!c.passed ? { fontWeight: 500 } : undefined}>
                          {c.label}
                        </span>
                        {c.detail && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Info className="w-3 h-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[300px] text-xs">
                                {c.detail}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Inline Validation Badge for Table Rows ──

interface ProjectValidationBadgeProps {
  validation: ProjectValidation;
}

export function ProjectValidationBadge({ validation }: ProjectValidationBadgeProps) {
  const { score, passCount, totalCount, checks } = validation;

  const failedChecks = checks.filter(c => !c.passed);
  const hasErrors = failedChecks.some(c => c.severity === 'error');

  let bgColor = 'bg-green-100 text-green-800';
  if (score < 100 && !hasErrors) bgColor = 'bg-amber-100 text-amber-800';
  if (hasErrors) bgColor = 'bg-red-100 text-red-800';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${bgColor}`}>
            {score === 100 ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : hasErrors ? (
              <CircleAlert className="w-3 h-3" />
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
            {passCount}/{totalCount}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[280px]">
          <div className="space-y-1">
            <p className="text-xs" style={{ fontWeight: 600 }}>검증 결과 ({score}%)</p>
            {checks.map(c => (
              <div key={c.id} className="flex items-start gap-1 text-[11px]">
                <CheckIcon passed={c.passed} severity={c.severity} />
                <div>
                  <span style={!c.passed ? { fontWeight: 500 } : undefined}>{c.label}</span>
                  {c.detail && !c.passed && (
                    <p className="text-muted-foreground text-[10px]">{c.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Update Reminder Badge (for header area) ──

export function UpdateReminderBadge() {
  const schedule = useMemo(() => getNextUpdateFridays(), []);

  if (schedule.daysLeft > 7) return null;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
        schedule.daysLeft <= 1
          ? 'bg-red-100 text-red-800 border border-red-200'
          : schedule.daysLeft <= 3
          ? 'bg-amber-100 text-amber-800 border border-amber-200'
          : 'bg-blue-100 text-blue-800 border border-blue-200'
      }`}
    >
      <Calendar className="w-3.5 h-3.5" />
      {schedule.isOverdue ? (
        <span style={{ fontWeight: 600 }}>오늘 업데이트일입니다!</span>
      ) : (
        <span>
          다음 업데이트: <span style={{ fontWeight: 500 }}>{schedule.next.getMonth() + 1}/{schedule.next.getDate()}(금)</span> — {schedule.daysLeft}일 남음
        </span>
      )}
    </div>
  );
}