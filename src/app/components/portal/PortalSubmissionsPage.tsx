import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, BarChart3, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Loader2, Users } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { usePortalStore } from '../../data/portal-store';
import { STATE_LABELS, type ChangeRequestState } from '../../data/personnel-change-data';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { resolveWeeklyAccountingSnapshot, resolveWeeklyAccountingState } from '../../platform/weekly-accounting-state';

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
      ? { title: props.syncTitle || '최종 동기화 상태 반영', at: props.syncAt, byName: props.syncByName || '-' }
      : null,
    props.updatedAt
      ? { title: '최종 제출 반영', at: props.updatedAt, byName: props.updatedByName || '-' }
      : null,
    props.editedAt
      ? { title: '최종 수정 상태 반영', at: props.editedAt, byName: props.editedByName || '-' }
      : null,
  ].filter(Boolean) as Array<{ title: string; at: string; byName: string }>;

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
          <div>{formatted.time} · {props.byName || '-'}</div>
        </div>
      )}
      {!formatted && <div className="mt-0.5">{props.byName || '-'}</div>}
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

const editToggleGroupClassName =
  'w-full rounded-lg border border-emerald-200/70 bg-emerald-50/40 p-0.5 dark:border-emerald-900/50 dark:bg-emerald-950/10';

const editToggleItemClassName =
  'px-2 text-[10px] text-slate-600 hover:bg-emerald-500/8 hover:text-emerald-900 dark:text-slate-300 dark:hover:bg-emerald-400/12 dark:hover:text-emerald-100 data-[state=on]:border-emerald-300 data-[state=on]:bg-emerald-600/24 data-[state=on]:text-emerald-950 data-[state=on]:shadow-none dark:data-[state=on]:border-emerald-700/80 dark:data-[state=on]:bg-emerald-400/28 dark:data-[state=on]:text-emerald-50';

const pendingStatusButtonClassName =
  'h-7 rounded-full border-emerald-200/90 bg-emerald-50/80 px-2 text-[10px] text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/15 dark:text-emerald-200 dark:hover:bg-emerald-900/30';

const completedStatusButtonClassName =
  'h-7 rounded-full border-emerald-300 bg-emerald-600/16 px-2 text-[10px] text-emerald-900 hover:bg-emerald-600/20 dark:border-emerald-700/80 dark:bg-emerald-400/22 dark:text-emerald-50 dark:hover:bg-emerald-400/28';

export function PortalSubmissionsPage() {
  const navigate = useNavigate();
  const {
    isLoading,
    portalUser,
    myProject,
    projects,
    changeRequests,
    weeklySubmissionStatuses,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();
  const { getWeeksForProject, weeks } = useCashflowWeeks();

  const [changeTab, setChangeTab] = useState<ChangeRequestState | 'ALL'>('SUBMITTED');
  const [selectedWeekNo, setSelectedWeekNo] = useState(1);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    projectId: string;
    projectName: string;
    field: 'projection' | 'expense';
    nextValue: boolean;
  }>({
    open: false,
    projectId: '',
    projectName: '',
    field: 'projection',
    nextValue: true,
  });
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [editSavingKey, setEditSavingKey] = useState('');

  const todayIso = getSeoulTodayIso();
  const [yearMonth, setYearMonth] = useState(() => todayIso.slice(0, 7));
  const todayYearMonth = todayIso.slice(0, 7);
  const projectId = portalUser?.projectId || myProject?.id || '';

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
  const byWeekNo = useMemo(() => {
    const map = new Map<number, { pmSubmitted: boolean; adminClosed: boolean }>();
    for (const w of myCashflowWeeks) {
      map.set(w.weekNo, { pmSubmitted: Boolean(w.pmSubmitted), adminClosed: Boolean(w.adminClosed) });
    }
    return map;
  }, [myCashflowWeeks]);

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

  const weekDeadline = useMemo(() => {
    if (!selectedWeek?.weekStart) return '';
    const base = new Date(`${selectedWeek.weekStart}T00:00:00`);
    base.setDate(base.getDate() + 4);
    return base.toISOString().slice(0, 10);
  }, [selectedWeek]);

  const statusMap = useMemo(() => {
    const map = new Map<string, typeof weeklySubmissionStatuses[number]>();
    weeklySubmissionStatuses.forEach((s) => {
      map.set(`${s.projectId}-${s.yearMonth}-w${s.weekNo}`, s);
    });
    return map;
  }, [weeklySubmissionStatuses]);

  const openConfirm = useCallback((input: { projectId: string; projectName: string; field: 'projection' | 'expense'; nextValue: boolean }) => {
    setConfirmState({ open: true, ...input });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!confirmState.projectId || !selectedWeek) return;
    setConfirmSaving(true);
    try {
      await upsertWeeklySubmissionStatus({
        projectId: confirmState.projectId,
        yearMonth,
        weekNo: selectedWeek.weekNo,
        ...(confirmState.field === 'projection'
          ? { projectionUpdated: confirmState.nextValue }
          : { expenseUpdated: confirmState.nextValue }),
      });
      setConfirmState((prev) => ({ ...prev, open: false }));
    } catch (err) {
      // store already toasts; keep modal open so user can retry
    } finally {
      setConfirmSaving(false);
    }
  }, [confirmState, selectedWeek, upsertWeeklySubmissionStatus, yearMonth]);

  const handleEditedChange = useCallback(async (input: {
    projectId: string;
    field: 'projection' | 'expense';
    nextValue: boolean;
  }) => {
    if (!selectedWeek) return;
    const savingKey = `${input.projectId}:${input.field}`;
    setEditSavingKey(savingKey);
    try {
      await upsertWeeklySubmissionStatus({
        projectId: input.projectId,
        yearMonth,
        weekNo: selectedWeek.weekNo,
        ...(input.field === 'projection'
          ? { projectionEdited: input.nextValue }
          : { expenseEdited: input.nextValue }),
      });
    } catch (err) {
      // store already toasts
    } finally {
      setEditSavingKey((prev) => (prev === savingKey ? '' : prev));
    }
  }, [selectedWeek, upsertWeeklySubmissionStatus, yearMonth]);

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
        <Button variant="outline" className="mt-4" onClick={() => navigate('/portal/project-settings')}>
          사업 선택하기
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardList}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="내 제출 현황"
        description="제출한 항목의 진행 상태(제출/승인/반려)를 한 곳에서 확인합니다."
        badge={myProject.shortName || myProject.id}
        actions={(
          <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={() => navigate('/portal')}>
            <ExternalLink className="w-3.5 h-3.5" /> 대시보드로
          </Button>
        )}
      />

      {/* Weekly submission checklist */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              주간 제출 체크
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goPrevMonth}>
                <ChevronLeft className="w-3 h-3" /> 이전
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goNextMonth}>
                다음 <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{yearMonth}</span>
            <div className="flex flex-wrap gap-1.5">
              {monthWeeks.map((w) => (
                <Button
                  key={w.weekNo}
                  variant={selectedWeekNo === w.weekNo ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => setSelectedWeekNo(w.weekNo)}
                >
                  {w.label}
                </Button>
              ))}
            </div>
            {selectedWeek && (
              <span className="text-[10px] text-muted-foreground">
                기간 {selectedWeek.weekStart} ~ {selectedWeek.weekEnd} · 마감 {weekDeadline} 24:00
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center rounded-full bg-emerald-600/12 px-2 py-0.5 text-emerald-800 dark:text-emerald-200" style={{ fontWeight: 700 }}>
              수정 상태 직접 선택
            </span>
            <span className="inline-flex items-center rounded-full bg-green-600/12 px-2 py-0.5 text-green-800 dark:text-green-200" style={{ fontWeight: 700 }}>
              제출 상태 별도 체크
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 180 }}>사업명</th>
                  <th className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 180 }}>Projection 업데이트</th>
                  <th className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 180 }}>사업비 입력</th>
                </tr>
              </thead>
              <tbody>
                {assignedProjects.map((p) => {
                  const key = `${p.id}-${yearMonth}-w${selectedWeek?.weekNo || 1}`;
                  const status = statusMap.get(key);
                  const weekSheet = checklistWeekMap.get(p.id);
                  const snapshot = resolveWeeklyAccountingSnapshot(status, weekSheet);
                  const projectionDone = snapshot.projectionDone;
                  const expenseDone = snapshot.expenseDone;
                  const accountingState = resolveWeeklyAccountingState(status, weekSheet);
                  const projectionEdited = snapshot.projectionEdited;
                  const expenseEdited = snapshot.expenseEdited;
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
                    syncTitle: status?.expenseSyncState === 'review_required'
                      ? '최종 사람 확인 상태 반영'
                      : status?.expenseSyncState === 'sync_failed'
                        ? '최종 동기화 실패 반영'
                        : status?.expenseSyncState === 'synced'
                          ? '최종 동기화 완료 반영'
                          : status?.expenseSyncState === 'pending'
                            ? '최종 동기화 대기 반영'
                            : undefined,
                  });
                  return (
                    <tr key={p.id} className="border-t border-border/30">
                      <td className="px-3 py-3 align-top">
                        <div className="text-[12px]" style={{ fontWeight: 700 }}>{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">{p.shortName || p.id}</div>
                      </td>
                      <td className="px-3 py-3 align-top text-center">
                        <div className="mx-auto flex max-w-[172px] flex-col items-stretch gap-2">
                          <ToggleGroup
                            type="single"
                            value={projectionEdited ? 'edited' : 'not-edited'}
                            variant="outline"
                            size="sm"
                            className={editToggleGroupClassName}
                            onValueChange={(value) => {
                              if (!value) return;
                              handleEditedChange({
                                projectId: p.id,
                                field: 'projection',
                                nextValue: value === 'edited',
                              });
                            }}
                            disabled={editSavingKey === `${p.id}:projection`}
                          >
                            <ToggleGroupItem value="edited" className={editToggleItemClassName}>
                              수정 O
                            </ToggleGroupItem>
                            <ToggleGroupItem value="not-edited" className={editToggleItemClassName}>
                              수정 X
                            </ToggleGroupItem>
                          </ToggleGroup>
                          <Button
                            variant="outline"
                            size="sm"
                            className={projectionDone ? completedStatusButtonClassName : pendingStatusButtonClassName}
                            disabled={confirmSaving}
                            onClick={() => openConfirm({
                              projectId: p.id,
                              projectName: p.name,
                              field: 'projection',
                              nextValue: !projectionDone,
                            })}
                          >
                            {projectionDone ? '제출 완료' : '미완료'}
                          </Button>
                          {projectionAudit && <AuditMetaLine {...projectionAudit} />}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-center">
                        <div className="mx-auto flex max-w-[172px] flex-col items-stretch gap-2">
                          <ToggleGroup
                            type="single"
                            value={expenseEdited ? 'edited' : 'not-edited'}
                            variant="outline"
                            size="sm"
                            className={editToggleGroupClassName}
                            onValueChange={(value) => {
                              if (!value) return;
                              handleEditedChange({
                                projectId: p.id,
                                field: 'expense',
                                nextValue: value === 'edited',
                              });
                            }}
                            disabled={editSavingKey === `${p.id}:expense`}
                          >
                            <ToggleGroupItem value="edited" className={editToggleItemClassName}>
                              수정 O
                            </ToggleGroupItem>
                            <ToggleGroupItem value="not-edited" className={editToggleItemClassName}>
                              수정 X
                            </ToggleGroupItem>
                          </ToggleGroup>
                          <Button
                            variant="outline"
                            size="sm"
                            className={expenseDone ? completedStatusButtonClassName : pendingStatusButtonClassName}
                            disabled={confirmSaving}
                            onClick={() => openConfirm({
                              projectId: p.id,
                              projectName: p.name,
                              field: 'expense',
                              nextValue: !expenseDone,
                            })}
                          >
                            {expenseDone ? '제출 완료' : '미완료'}
                          </Button>
                          {expenseDone && (
                            <div className="space-y-1">
                              <Badge
                                variant="outline"
                                className={
                                  accountingState.expenseStatusTone === 'success'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : accountingState.expenseStatusTone === 'danger'
                                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                                      : 'border-amber-300 bg-amber-50 text-amber-700'
                                }
                              >
                                {accountingState.expenseStatusLabel}
                              </Badge>
                              <div className="text-[9px] leading-4 text-muted-foreground">
                                {accountingState.expenseStatusDescription}
                              </div>
                            </div>
                          )}
                          {expenseAudit && <AuditMetaLine {...expenseAudit} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {assignedProjects.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-[12px] text-muted-foreground">
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
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <Users className="w-4 h-4 text-violet-500" />
              인력변경 신청
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/change-requests')}>
              상세 보기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={changeTab} onValueChange={(v) => setChangeTab(v as any)}>
            <TabsList className="w-full flex flex-wrap justify-start">
              {CHANGE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-[11px]">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={changeTab} className="mt-3">
              <div className="space-y-2">
                {filteredChanges.slice(0, 10).map((c) => (
                  <div key={c.id} className="p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>{c.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          적용일 {c.effectiveDate} · 요청 {String(c.requestedAt || '').slice(0, 10)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">
                        {STATE_LABELS[c.state]}
                      </Badge>
                    </div>
                    {(c.state === 'REJECTED' || c.state === 'REVISION_REQUESTED') && c.reviewComment && (
                      <div className="mt-2 p-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-[10px] text-amber-800 dark:text-amber-200">
                        {c.state === 'REJECTED' ? '반려 사유: ' : '수정 요청: '}
                        {c.reviewComment}
                      </div>
                    )}
                  </div>
                ))}
                {filteredChanges.length === 0 && (
                  <div className="py-8 text-center text-[12px] text-muted-foreground">
                    해당 상태의 신청이 없습니다.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Weekly Expense Input */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-teal-600" />
              사업비 입력(주간) 작성/제출
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/weekly-expenses')}>
              입력 열기 <ExternalLink className="w-3 h-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[11px] text-muted-foreground">
              {yearMonth} 기준
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goPrevMonth}>
                <ChevronLeft className="w-3 h-3" /> 이전
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={goNextMonth}>
                다음 <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 160 }}>주차</th>
                  <th className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 120 }}>상태</th>
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 220 }}>기간</th>
                </tr>
              </thead>
              <tbody>
                {monthWeeks.map((w) => {
                  const weekDoc = myCashflowWeeks.find((item) => item.weekNo === w.weekNo);
                  const statusDoc = statusMap.get(`${projectId}-${yearMonth}-w${w.weekNo}`);
                  const snapshot = resolveWeeklyAccountingSnapshot(statusDoc, weekDoc);
                  const accountingState = resolveWeeklyAccountingState(statusDoc, weekDoc);
                  const pmSubmitted = snapshot.pmSubmitted;
                  const adminClosed = snapshot.adminClosed;
                  const isThisWeek = todayYearMonth === yearMonth && todayIso >= w.weekStart && todayIso <= w.weekEnd;
                  const status = adminClosed
                    ? { label: '결산완료', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
                    : accountingState.closeDialogKind === 'warning'
                      ? { label: accountingState.expenseStatusLabel, cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
                    : pmSubmitted
                      ? { label: '작성완료', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' }
                      : snapshot.projectionDone || snapshot.expenseDone
                        ? { label: '저장됨', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' }
                      : { label: '미작성', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' };

                  return (
                    <tr key={w.weekNo} className={`border-t border-border/30 ${isThisWeek ? 'bg-teal-50/30 dark:bg-teal-950/10' : ''}`}>
                      <td className="px-3 py-2">
                        <span style={{ fontWeight: 700 }}>{w.label}</span>
                        {isThisWeek && (
                          <Badge className="ml-2 h-4 px-1 text-[9px] bg-teal-500/15 text-teal-700 dark:text-teal-300 border-0">이번 주</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] ${status.cls}`} style={{ fontWeight: 800 }}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {w.weekStart} ~ {w.weekEnd}
                      </td>
                    </tr>
                  );
                })}
                {monthWeeks.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-[12px] text-muted-foreground" colSpan={3}>
                      주차 정보가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmState.open} onOpenChange={(open) => setConfirmState((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>주간 제출 상태를 변경할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmState.projectName} · {yearMonth} {selectedWeek?.label || ''} · {confirmState.field === 'projection' ? 'Projection' : '사업비 입력'}을
              {confirmState.nextValue ? ' 완료' : ' 미완료'}로 변경합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={confirmSaving}>
              {confirmSaving ? '저장 중...' : '확인'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
