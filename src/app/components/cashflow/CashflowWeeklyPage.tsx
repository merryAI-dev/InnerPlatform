import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink, Flag, Check, Loader2, MessageSquareText } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import type { CashflowWeekSheet, CashflowWeekTotals } from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import { useCashflowEditLease } from './useCashflowEditLease';
import { EditLeaseDialogs } from '../editing/EditLeaseDialogs';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { toast } from 'sonner';

function fmtShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString('ko-KR');
}

function emptyTotals(): CashflowWeekTotals {
  return { totalIn: 0, totalOut: 0, net: 0 };
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { yearMonth, weeks, isLoading, goPrevMonth, goNextMonth, updateVarianceFlag } = useCashflowWeeks();
  const [varianceLeaseProjectId, setVarianceLeaseProjectId] = useState('');
  const varianceLease = useCashflowEditLease({
    tenantId: orgId,
    projectId: varianceLeaseProjectId,
    actor: {
      uid: user?.uid || 'admin-user',
      email: user?.email || '',
      role: user?.role || 'admin',
      idToken: user?.idToken,
      googleAccessToken: user?.googleAccessToken,
    },
  });

  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);

  const weekSheetMap = useMemo(() => {
    const map = new Map<string, CashflowWeekSheet>();
    for (const w of weeks.filter((x) => x.yearMonth === yearMonth)) {
      map.set(`${w.projectId}:${w.weekNo}`, w);
    }
    return map;
  }, [weeks, yearMonth]);

  const byProjectWeek = useMemo(() => {
    const map = new Map<string, { projectionUpdated: boolean; totals: CashflowWeekTotals }>();
    for (const w of weeks.filter((x) => x.yearMonth === yearMonth)) {
      const key = `${w.projectId}:${w.weekNo}`;
      map.set(key, {
        projectionUpdated: Boolean(w.projectionUpdated),
        totals: w.projectionTotals || emptyTotals(),
      });
    }
    return map;
  }, [weeks, yearMonth]);

  function openProject(projectId: string) {
    navigate(`/cashflow/projects/${projectId}?ym=${encodeURIComponent(yearMonth)}&view=projection`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="주간 프로젝션 작성 현황(전사)"
        description={`프로젝트별 주간 입력 현황 · ${yearMonth}`}
        actions={(
          <div className="flex items-center gap-2">
            <select
              aria-label="편차 수정 프로젝트"
              value={varianceLeaseProjectId}
              disabled={varianceLease.canEdit}
              onChange={(event) => setVarianceLeaseProjectId(event.target.value)}
              className="h-8 max-w-48 rounded-md border bg-background px-2 text-[11px]"
            >
              <option value="">프로젝트 선택</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              disabled={!varianceLeaseProjectId || !varianceLease.sessionId || varianceLease.busy || varianceLease.canEdit}
              onClick={() => void varianceLease.acquire()}
            >
              {varianceLease.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {varianceLease.canEdit ? '수정 중' : '수정 시작'}
            </Button>
            {varianceLease.canEdit ? (
              <>
                <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => void varianceLease.extend()}>
                  {varianceLease.remainingLabel} · 30분 연장
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => void varianceLease.release()}>
                  수정 종료
                </Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goPrevMonth}>
              <ChevronLeft className="w-3.5 h-3.5" /> 이전 달
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5" onClick={goNextMonth}>
              다음 달 <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="px-4 py-2 text-left" style={{ fontWeight: 700, minWidth: 220 }}>프로젝트</th>
                  <th className="px-3 py-2 text-left" style={{ fontWeight: 700, minWidth: 120 }}>담당자</th>
                  {monthWeeks.map((w) => (
                    <th key={w.weekNo} className="px-3 py-2 text-center" style={{ fontWeight: 700, minWidth: 140 }}>
                      <div>{w.label}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{w.weekStart}~{w.weekEnd}</div>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right" style={{ fontWeight: 700, minWidth: 120 }}>프로젝션 바로가기</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate" style={{ fontWeight: 600 }}>{p.name}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{p.department} · {p.clientOrg}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span style={{ fontWeight: 500 }}>{p.managerName}</span>
                    </td>
                    {monthWeeks.map((w) => {
                      const cellKey = `${p.id}:${w.weekNo}`;
                      const status = byProjectWeek.get(cellKey);
                      const sheet = weekSheetMap.get(cellKey);
                      const projectionUpdated = Boolean(status?.projectionUpdated);
                      const totals = status?.totals || emptyTotals();

                      const projectionChangeAlert = sheet?.projectionChangeAlert;
                      const hasProjectionChangeAlert = Boolean(projectionChangeAlert?.triggered);
                      const isMissingProjection = !projectionUpdated;

                      const chip = projectionUpdated
                          ? { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', label: 'Projection 저장' }
                          : { bg: 'bg-red-500/15', text: 'text-red-700 dark:text-red-300', label: '미작성' };

                      return (
                        <td
                          key={w.weekNo}
                          className={`px-3 py-2 text-center ${isMissingProjection ? 'bg-red-50 dark:bg-red-950/30' : ''}`}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] ${chip.bg} ${chip.text}`} style={{ fontWeight: 700 }}>
                              {chip.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              입금 {fmtShort(totals.totalIn)}
                            </span>
                            <span className="text-[10px] text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              출금 {fmtShort(totals.totalOut)}
                            </span>
                            {hasProjectionChangeAlert && projectionChangeAlert && (
                              <span className="text-[9px] text-amber-700 dark:text-amber-300" style={{ fontWeight: 600 }}>
                                D-7 1천만↑ {fmtShort(projectionChangeAlert.totalAbsDelta)}
                                {Number.isFinite(projectionChangeAlert.daysBeforeWeekStart) ? ` · D-${projectionChangeAlert.daysBeforeWeekStart}` : ''}
                              </span>
                            )}
                            <VarianceFlagButton
                              sheet={sheet}
                              canEdit={varianceLease.canEdit && varianceLeaseProjectId === p.id}
                              onUpdate={async (intent) => {
                                if (varianceLeaseProjectId !== p.id) throw new Error('해당 프로젝트 수정 세션을 먼저 시작해 주세요.');
                                const cashflowLease = await varianceLease.checkBeforeMutation();
                                await updateVarianceFlag({ ...intent, cashflowLease });
                              }}
                            />
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[11px] gap-1.5"
                        onClick={() => openProject(p.id)}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        프로젝션 열기
                      </Button>
                    </td>
                  </tr>
                ))}
                {projects.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={monthWeeks.length + 3}>
                      프로젝트가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {isLoading && (
            <div className="px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div>
          )}
          {!isLoading && (
            <div className="px-4 py-3 text-[10px] text-muted-foreground border-t border-border/40 flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-[9px] h-4 px-1.5">정의</Badge>
              주차 상태는 조회용 · 최종 확정과 수정 잠금은 프로젝트별 월 결산에서 처리 ·{' '}
              <span className="text-red-600">빨간색</span>=미작성 ·{' '}
              <span className="text-amber-700">D-7 1천만↑</span>=주차 시작 7일 이내 Projection 1천만원 이상 변경 ·{' '}
              <Flag className="inline w-2.5 h-2.5 text-red-500" /> 확인요청{' '}
              <MessageSquareText className="inline w-2.5 h-2.5 text-blue-500" /> 답변완료{' '}
              <Check className="inline w-2.5 h-2.5 text-slate-400" /> 해결
            </div>
          )}
        </CardContent>
      </Card>
      <EditLeaseDialogs
        warningOpen={varianceLease.warningOpen}
        expiredOpen={varianceLease.expiredOpen}
        conflictOpen={varianceLease.conflictOpen}
        holder={varianceLease.holder}
        busy={varianceLease.busy}
        onDismissWarning={varianceLease.dismissWarning}
        onExtend={() => { void varianceLease.extend(); }}
        onContinueReadOnly={varianceLease.continueReadOnly}
        onReacquire={() => { void varianceLease.acquire(); }}
        onTakeover={() => { void varianceLease.takeover(); }}
      />
    </div>
  );
}

// ── Variance Flag Button (Admin 전용) ──

const FLAG_COLORS: Record<string, { icon: string; bg: string }> = {
  OPEN: { icon: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/40' },
  REPLIED: { icon: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  RESOLVED: { icon: 'text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800/40' },
};

function VarianceFlagButton({
  sheet,
  canEdit,
  onUpdate,
}: {
  sheet: CashflowWeekSheet | undefined;
  canEdit: boolean;
  onUpdate: (input: { sheetId: string; action: 'FLAG' | 'REPLY' | 'RESOLVE'; content?: string }) => Promise<void>;
}) {
  const flag = sheet?.varianceFlag;
  const history = sheet?.varianceHistory || [];
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);

  const handleFlag = async () => {
    if (!reason.trim() || !sheet) return;
    try {
      await onUpdate({ sheetId: sheet.id, action: 'FLAG', content: reason.trim() });
      setReason('');
      setOpen(false);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '편차 확인 요청을 저장하지 못했습니다.'));
    }
  };

  const handleResolve = async () => {
    if (!sheet || !flag) return;
    try {
      await onUpdate({ sheetId: sheet.id, action: 'RESOLVE' });
      setOpen(false);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '편차 확인 완료를 저장하지 못했습니다.'));
    }
  };

  const flagStatus = flag?.status;
  const colors = flagStatus ? FLAG_COLORS[flagStatus] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded transition-colors ${
            colors
              ? `${colors.icon} ${colors.bg} hover:opacity-80`
              : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted'
          }`}
        >
          {!flagStatus && <Flag className="h-2.5 w-2.5" />}
          {flagStatus === 'OPEN' && <><Flag className="h-2.5 w-2.5" /> 확인요청</>}
          {flagStatus === 'REPLIED' && <><MessageSquareText className="h-2.5 w-2.5" /> 답변</>}
          {flagStatus === 'RESOLVED' && <><Check className="h-2.5 w-2.5" /> 해결</>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="center">
        <div className="p-3 space-y-2.5">
          <p className="text-[11px] font-bold">편차 확인</p>

          {/* History timeline */}
          {history.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1.5 border-l-2 border-muted pl-2.5">
              {history.map((evt) => (
                <div key={evt.id} className="text-[10px]">
                  <div className="flex items-center gap-1">
                    <span className={`font-semibold ${
                      evt.action === 'FLAG' ? 'text-red-600' :
                      evt.action === 'REPLY' ? 'text-blue-600' : 'text-slate-500'
                    }`}>
                      {evt.action === 'FLAG' ? '확인요청' : evt.action === 'REPLY' ? 'PM 답변' : '해결'}
                    </span>
                    <span className="text-muted-foreground">{evt.actor}</span>
                    <span className="text-muted-foreground ml-auto">{evt.timestamp.slice(5, 16)}</span>
                  </div>
                  <p className="text-foreground mt-0.5">{evt.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Current flag detail */}
          {flag && flag.status !== 'RESOLVED' && (
            <div className="rounded-md bg-muted/50 p-2 text-[10px] space-y-1">
              <div>
                <span className="font-semibold text-red-600">사유:</span>{' '}
                {flag.reason}
              </div>
              {flag.pmReply && (
                <div>
                  <span className="font-semibold text-blue-600">PM 답변:</span>{' '}
                  {flag.pmReply}
                  <span className="text-muted-foreground ml-1">
                    ({flag.pmRepliedBy}, {flag.pmRepliedAt?.slice(5, 16)})
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {!canEdit ? (
            <p className="rounded-md bg-muted/50 px-2 py-1.5 text-center text-[10px] text-muted-foreground">
              위에서 이 프로젝트의 수정 세션을 먼저 시작해 주세요.
            </p>
          ) : null}
          {!flag || flag.status === 'RESOLVED' ? (
            // No active flag → can create new one
            <div className="space-y-1.5">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="편차 확인 사유를 입력하세요..."
                className="w-full h-16 rounded-md border bg-background px-2 py-1.5 text-[11px] outline-none resize-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                className="w-full h-7 text-[11px] gap-1"
                onClick={() => void handleFlag()}
                disabled={!canEdit || !reason.trim()}
              >
                <Flag className="h-3 w-3" />
                확인요청 보내기
              </Button>
            </div>
          ) : flag.status === 'REPLIED' ? (
            // PM replied → admin can resolve
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-[11px] gap-1"
              onClick={() => void handleResolve()}
              disabled={!canEdit}
            >
              <Check className="h-3 w-3" />
              확인 완료 (해결)
            </Button>
          ) : (
            // OPEN — waiting for PM
            <p className="text-[10px] text-muted-foreground italic text-center py-1">
              PM 답변 대기중...
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
