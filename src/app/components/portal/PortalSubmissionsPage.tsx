import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, BarChart3, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Loader2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { usePortalStore } from '../../data/portal-store';
import { STATE_LABELS, type ChangeRequestState } from '../../data/personnel-change-data';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { resolveWeeklyAccountingSnapshot } from '../../platform/weekly-accounting-state';

function sortIsoDesc(a: string | undefined, b: string | undefined): number {
  return String(b || '').localeCompare(String(a || ''));
}

function formatKstDateTime(value: string | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '--';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')} KST`,
  };
}

function pickLatestAuditMeta(props: {
  editedAt?: string;
  editedByName?: string;
  updatedAt?: string;
  updatedByName?: string;
  syncAt?: string;
  syncByName?: string;
  syncTitle?: string;
}) {
  const items = [
    props.syncAt
      ? { title: props.syncTitle || '최종 동기화 상태 반영', at: props.syncAt, byName: props.syncByName }
      : null,
    props.updatedAt
      ? { title: '기존 제출 이력 반영', at: props.updatedAt, byName: props.updatedByName }
      : null,
    props.editedAt
      ? { title: '최종 수정 상태 반영', at: props.editedAt, byName: props.editedByName }
      : null,
  ].filter(Boolean) as Array<{ title: string; at: string; byName?: string }>;

  if (items.length === 0) return null;
  items.sort((left, right) => String(right.at).localeCompare(String(left.at)));
  return items[0];
}

function AuditMetaLine(props: {
  title: string;
  at?: string;
  byName?: string;
}) {
  const formatted = formatKstDateTime(props.at);
  if (!formatted && !props.byName) return null;

  return (
    <div className="pt-1.5 text-left text-[9px] leading-4 text-muted-foreground">
      <div className="text-foreground/80" style={{ fontWeight: 700 }}>{props.title}</div>
      {formatted && (
        <div className="mt-0.5">
          <div>{formatted.date}</div>
          <div>{props.byName ? `${formatted.time} · ${props.byName}` : formatted.time}</div>
        </div>
      )}
      {!formatted && props.byName && <div className="mt-0.5">{props.byName}</div>}
    </div>
  );
}

const CHANGE_TABS: Array<{ label: string; value: ChangeRequestState | 'ALL' }> = [
  { label: '전체', value: 'ALL' },
  { label: '제출됨', value: 'SUBMITTED' },
  { label: '승인', value: 'APPROVED' },
  { label: '반려', value: 'REJECTED' },
  { label: '수정요청', value: 'REVISION_REQUESTED' },
];

const surfaceCardClassName = 'border-slate-200/90 bg-white shadow-sm shadow-slate-950/5';
const outlineActionButtonClassName = 'h-8 rounded-lg border-slate-300 bg-white text-[11px] text-slate-700 hover:bg-slate-50';
const tableHeadCellClassName = 'px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-slate-500';

export function PortalSubmissionsPage() {
  const navigate = useNavigate();
  const {
    activeProjectId,
    isLoading,
    portalUser,
    myProject,
    projects,
    changeRequests,
    weeklySubmissionStatuses,
  } = usePortalStore();
  const { getWeeksForProject, weeks } = useCashflowWeeks();

  const [changeTab, setChangeTab] = useState<ChangeRequestState | 'ALL'>('SUBMITTED');
  const [selectedWeekNo, setSelectedWeekNo] = useState(1);

  const todayIso = getSeoulTodayIso();
  const [yearMonth, setYearMonth] = useState(() => todayIso.slice(0, 7));
  const todayYearMonth = todayIso.slice(0, 7);
  const projectId = activeProjectId || myProject?.id || '';

  const myChanges = useMemo(() => {
    if (!projectId) return [];
    return changeRequests
      .filter((c) => c.projectId === projectId)
      .slice()
      .sort((a, b) => sortIsoDesc(a.requestedAt, b.requestedAt));
  }, [changeRequests, projectId]);

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const goPrevMonth = useCallback(() => setYearMonth((prev) => addMonthsToYearMonth(prev, -1)), []);
  const goNextMonth = useCallback(() => setYearMonth((prev) => addMonthsToYearMonth(prev, 1)), []);
  const currentWeekNo = useMemo(() => {
    const current = monthWeeks.find((w) => todayIso >= w.weekStart && todayIso <= w.weekEnd);
    return current?.weekNo || monthWeeks[0]?.weekNo || 1;
  }, [monthWeeks, todayIso]);
  useEffect(() => {
    setSelectedWeekNo(currentWeekNo);
  }, [currentWeekNo]);

  const myCashflowWeeks = useMemo(() => (projectId ? getWeeksForProject(projectId).filter((w) => w.yearMonth === yearMonth) : []), [getWeeksForProject, projectId, yearMonth]);

  const filteredChanges = useMemo(() => {
    if (changeTab === 'ALL') return myChanges;
    return myChanges.filter((c) => c.state === changeTab);
  }, [changeTab, myChanges]);

  const assignedProjects = useMemo(() => {
    if (!portalUser) return [];
    const ids = new Set([portalUser.projectId, ...(portalUser.projectIds || [])].filter(Boolean));
    return projects.filter((p) => ids.has(p.id));
  }, [projects, portalUser]);

  const selectedWeek = useMemo(() => monthWeeks.find((w) => w.weekNo === selectedWeekNo) || monthWeeks[0], [monthWeeks, selectedWeekNo]);

  const checklistWeekMap = useMemo(() => {
    const map = new Map<string, (typeof weeks)[number]>();
    const targetWeekNo = selectedWeek?.weekNo;
    if (!targetWeekNo) return map;
    weeks.forEach((week) => {
      if (week.yearMonth !== yearMonth || week.weekNo !== targetWeekNo) return;
      map.set(week.projectId, week);
    });
    return map;
  }, [selectedWeek, weeks, yearMonth]);

  const statusMap = useMemo(() => {
    const map = new Map<string, typeof weeklySubmissionStatuses[number]>();
    weeklySubmissionStatuses.forEach((s) => {
      map.set(`${s.projectId}-${s.yearMonth}-w${s.weekNo}`, s);
    });
    return map;
  }, [weeklySubmissionStatuses]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">제출 현황을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!portalUser || !myProject) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-[14px] text-muted-foreground">사업이 선택되지 않았습니다.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/portal/project-select')}>
          사업 선택하기
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[22px] border border-slate-200/90 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm shadow-slate-950/10">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">내 제출 현황</h1>
            <p className="mt-1 text-[11px] font-medium text-slate-500">{myProject.shortName || myProject.id}</p>
          </div>
        </div>
      </div>

      {/* Historical weekly input records */}
      <Card className={surfaceCardClassName}>
        <CardHeader className="border-b border-slate-200/80 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-950">
              <BarChart3 className="w-4 h-4 text-[#1f4a7d]" />
              주간 입력 기록 (조회용)
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={goPrevMonth}>
                <ChevronLeft className="w-3 h-3" /> 이전
              </Button>
              <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={goNextMonth}>
                다음 <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
            주차별 입력 이력은 조회만 가능하며, 최종 확정과 수정 잠금은 프로젝트별 월 결산에서 처리합니다.
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-3">
            <span className="text-[11px] font-semibold text-slate-600">{yearMonth}</span>
            <div className="flex flex-wrap gap-1.5">
              {monthWeeks.map((w) => (
                <Button
                  key={w.weekNo}
                  variant={selectedWeekNo === w.weekNo ? 'default' : 'outline'}
                  size="sm"
                  className={selectedWeekNo === w.weekNo
                    ? 'h-7 rounded-lg bg-slate-900 px-2.5 text-[10px] text-white hover:bg-slate-900/90'
                    : 'h-7 rounded-lg border-slate-300 bg-white px-2.5 text-[10px] text-slate-700 hover:bg-slate-50'}
                  onClick={() => setSelectedWeekNo(w.weekNo)}
                >
                  {w.label}
                </Button>
              ))}
            </div>
            {selectedWeek && (
              <span className="text-[10px] font-medium text-slate-500">
                기간 {selectedWeek.weekStart} ~ {selectedWeek.weekEnd}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-100/90">
                  <th className={`${tableHeadCellClassName} text-left`} style={{ minWidth: 180 }}>사업명</th>
                  <th className={`${tableHeadCellClassName} text-center`} style={{ minWidth: 180 }}>Projection 업데이트</th>
                  <th className={`${tableHeadCellClassName} text-center`} style={{ minWidth: 180 }}>사업비 입력</th>
                </tr>
              </thead>
              <tbody>
                {assignedProjects.map((p) => {
                  const key = `${p.id}-${yearMonth}-w${selectedWeek?.weekNo || 1}`;
                  const status = statusMap.get(key);
                  const weekSheet = checklistWeekMap.get(p.id);
                  const snapshot = resolveWeeklyAccountingSnapshot(status, weekSheet);
                  const projectionEdited = snapshot.projectionEdited;
                  const expenseEdited = snapshot.expenseEdited;
                  const projectionInputLabel = projectionEdited ? '입력됨' : '미입력';
                  const expenseInputLabel = expenseEdited ? '입력됨' : '미입력';
                  const projectionAudit = pickLatestAuditMeta({
                    editedAt: status?.projectionEditedAt,
                    editedByName: status?.projectionEditedByName,
                    updatedAt: status?.projectionUpdatedAt,
                    updatedByName: status?.projectionUpdatedByName,
                  });
                  const expenseAudit = pickLatestAuditMeta({
                    editedAt: status?.expenseEditedAt,
                    editedByName: status?.expenseEditedByName,
                    updatedAt: status?.expenseUpdatedAt,
                    updatedByName: status?.expenseUpdatedByName,
                    syncAt: status?.expenseSyncUpdatedAt,
                    syncByName: status?.expenseSyncUpdatedByName,
                  });
                  return (
                    <tr key={p.id} className="border-t border-slate-200/70 transition-colors hover:bg-slate-50/70">
                      <td className="px-3 py-3.5 align-top">
                        <div className="text-[12px] font-semibold text-slate-950">{p.name}</div>
                        <div className="mt-1 text-[10px] font-medium text-slate-500">{p.shortName || p.id}</div>
                      </td>
                      <td className="px-3 py-3.5 align-top text-center">
                        <div className="mx-auto flex max-w-[172px] flex-col items-stretch gap-2">
                          <div className="flex flex-wrap justify-center gap-1.5">
                            <Badge variant="outline" className={projectionEdited ? 'border-[#c8d7ea] bg-[#eef4fb] text-[#1f4a7d]' : 'border-slate-200 bg-slate-50 text-slate-600'}>
                              {projectionInputLabel}
                            </Badge>
                          </div>
                          {projectionAudit && <AuditMetaLine {...projectionAudit} />}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 align-top text-center">
                        <div className="mx-auto flex max-w-[172px] flex-col items-stretch gap-2">
                          <div className="flex flex-wrap justify-center gap-1.5">
                            <Badge variant="outline" className={expenseEdited ? 'border-[#c8d7ea] bg-[#eef4fb] text-[#1f4a7d]' : 'border-slate-200 bg-slate-50 text-slate-600'}>
                              {expenseInputLabel}
                            </Badge>
                          </div>
                          {expenseAudit && <AuditMetaLine {...expenseAudit} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {assignedProjects.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-[12px] text-slate-500">
                      표시할 사업이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Change Requests */}
      <Card className={surfaceCardClassName}>
        <CardHeader className="border-b border-slate-200/80 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-950">
              <Users className="w-4 h-4 text-[#1f4a7d]" />
              인력변경 신청
            </CardTitle>
            <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={() => navigate('/portal/change-requests')}>
              상세 보기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <Tabs value={changeTab} onValueChange={(v) => setChangeTab(v as any)}>
            <TabsList className="flex w-full flex-wrap justify-start rounded-xl bg-slate-100 p-1">
              {CHANGE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="rounded-lg text-[11px] text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={changeTab} className="mt-3">
              <div className="space-y-2">
                {filteredChanges.slice(0, 10).map((c) => (
                  <div key={c.id} className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-950/5 transition-colors hover:bg-slate-50/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-slate-950">{c.title}</p>
                        <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                          적용일 {c.effectiveDate} · 요청 {String(c.requestedAt || '').slice(0, 10)}
                        </p>
                      </div>
                      <Badge variant="outline" className="h-5 shrink-0 border-slate-200 bg-slate-50 px-1.5 text-[9px] text-slate-700">
                        {STATE_LABELS[c.state]}
                      </Badge>
                    </div>
                    {(c.state === 'REJECTED' || c.state === 'REVISION_REQUESTED') && c.reviewComment && (
                      <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50 px-2 py-2 text-[10px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200">
                        {c.state === 'REJECTED' ? '반려 사유: ' : '수정 요청: '}
                        {c.reviewComment}
                      </div>
                    )}
                  </div>
                ))}
                {filteredChanges.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4 text-center text-[12px] text-slate-500">
                    표시할 신청이 없습니다.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Historical weekly expense input */}
      <Card className={surfaceCardClassName}>
        <CardHeader className="border-b border-slate-200/80 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-950">
              <BarChart3 className="w-4 h-4 text-[#1f4a7d]" />
              사업비 입력(주간) 기록
            </CardTitle>
            <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={() => navigate('/portal/weekly-expenses')}>
              입력 열기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-3">
            <div className="text-[11px] font-semibold text-slate-600">
              {yearMonth} 기준
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={goPrevMonth}>
                <ChevronLeft className="w-3 h-3" /> 이전
              </Button>
              <Button variant="outline" size="sm" className={outlineActionButtonClassName} onClick={goNextMonth}>
                다음 <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-100/90">
                  <th className={`${tableHeadCellClassName} text-left`} style={{ minWidth: 160 }}>주차</th>
                  <th className={`${tableHeadCellClassName} text-center`} style={{ minWidth: 120 }}>상태</th>
                  <th className={`${tableHeadCellClassName} text-left`} style={{ minWidth: 220 }}>기간</th>
                </tr>
              </thead>
              <tbody>
                {monthWeeks.map((w) => {
                  const weekDoc = myCashflowWeeks.find((item) => item.weekNo === w.weekNo);
                  const statusDoc = statusMap.get(`${projectId}-${yearMonth}-w${w.weekNo}`);
                  const snapshot = resolveWeeklyAccountingSnapshot(statusDoc, weekDoc);
                  const pmSubmitted = snapshot.pmSubmitted;
                  const adminClosed = snapshot.adminClosed;
                  const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                  const status = adminClosed
                    ? { label: '기존 결산 이력', cls: 'border border-slate-200 bg-slate-100 text-slate-700' }
                    : pmSubmitted
                      ? { label: '기존 제출 이력', cls: 'border border-slate-200 bg-slate-100 text-slate-700' }
                      : snapshot.projectionDone || snapshot.expenseDone
                        ? { label: '입력 기록 있음', cls: 'border border-slate-200 bg-slate-100 text-slate-700' }
                      : { label: '입력 기록 없음', cls: 'border border-slate-200 bg-white text-slate-600' };

                  return (
                    <tr key={w.weekNo} className={`border-t border-slate-200/70 transition-colors hover:bg-slate-50/70 ${isThisWeek ? 'bg-[#eef4fb]' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-slate-950">{w.label}</span>
                        {isThisWeek && (
                          <Badge className="ml-2 h-4 border-0 bg-[#d9e7f6] px-1 text-[9px] text-[#1f4a7d]">이번 주</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] ${status.cls}`} style={{ fontWeight: 800 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {w.weekStart} ~ {w.weekEnd}
                      </td>
                    </tr>
                  );
                })}
                {monthWeeks.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-[12px] text-slate-500" colSpan={3}>
                      주차 정보가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
