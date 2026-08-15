import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, History, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import type {
  CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  CashflowPeriodPolicyIssue,
  CashflowPeriodPolicyProjectItem,
  CashflowPeriodPolicyResponse,
  CashflowPeriodPolicyTone,
} from '../../lib/cashflow-period-policy-client';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const STATUS_CLASS = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  caution: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
} as const;

const STATUS_DOT = {
  positive: 'bg-emerald-500',
  caution: 'bg-amber-500',
  critical: 'bg-rose-500',
} as const;

export function StatusBadge({ status, label, tone }: {
  status: string;
  label: string;
  tone: CashflowPeriodPolicyTone;
}) {
  return (
    <Badge variant="outline" className={`gap-1.5 ${STATUS_CLASS[tone]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[tone]}`} />
      <span>{label}</span>
      <span className="font-mono text-[9px] opacity-70">{status}</span>
    </Badge>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`section-${title.replaceAll(' ', '-')}`}>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/30 pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h2 id={`section-${title.replaceAll(' ', '-')}`} className="text-sm leading-none">{title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">{children}</CardContent>
      </Card>
    </section>
  );
}

function ExecutiveApproverEditor({
  item,
  snapshot,
  saving,
  onUpdate,
}: {
  item: CashflowPeriodPolicyProjectItem;
  snapshot: CashflowPeriodPolicyResponse;
  saving: boolean;
  onUpdate: (item: CashflowPeriodPolicyProjectItem, uid: string, reason: string) => Promise<void>;
}) {
  const [uid, setUid] = useState('');
  const [reason, setReason] = useState('');
  const inputId = `executive-approver-${item.project.id}`;

  useEffect(() => {
    setUid('');
    setReason('');
  }, [item.executiveApprover.uid, item.project.id]);

  return (
    <form
      className="min-w-[320px] space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!item.executiveApprover.changeAction.enabled) return;
        void onUpdate(item, uid, reason);
      }}
    >
      <label htmlFor={inputId} className="block text-xs font-medium">조직장 People UID</label>
      <div className="flex gap-2">
        <select
          id={inputId}
          value={uid}
          onChange={(event) => setUid(event.target.value)}
          disabled={saving || !item.executiveApprover.changeAction.enabled}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">후보 선택</option>
          {snapshot.executiveApproverCandidates.items.map((candidate) => (
            <option key={`${candidate.uid}:${candidate.personId}`} value={candidate.uid}>
              {candidate.displayName} · {candidate.uid}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={saving || !item.executiveApprover.changeAction.enabled || !uid.trim() || !reason.trim()}>{saving ? '연결 중' : '연결'}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={snapshot.executiveApproverCandidates.status} label={snapshot.executiveApproverCandidates.statusLabel} tone={snapshot.executiveApproverCandidates.tone} />
      </div>
      <label className="block text-xs text-muted-foreground">
        변경 사유
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="People UID 연결 근거"
          disabled={saving || !item.executiveApprover.changeAction.enabled}
          required
          maxLength={500}
          className="mt-1 h-8 text-xs"
        />
      </label>
      {item.executiveApprover.changeAction.guide ? (
        <p className="text-[11px] text-muted-foreground">{item.executiveApprover.changeAction.guide}</p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{item.executiveApprover.expectedVersionLabel}</p>
    </form>
  );
}

function PolicyPermissionsSection({
  snapshot,
  savingProjectId,
  onUpdateExecutiveApprover,
}: {
  snapshot: CashflowPeriodPolicyResponse;
  savingProjectId: string;
  onUpdateExecutiveApprover: (item: CashflowPeriodPolicyProjectItem, uid: string, reason: string) => Promise<void>;
}) {
  return (
    <SectionCard title="정책 / 권한" description="슈퍼관리자와 프로젝트별 조직장 People UID 연결을 서버 권한 기준으로 표시합니다." icon={ShieldCheck}>
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold">상위 슈퍼관리자</h3>
            <StatusBadge status={snapshot.superadmins.status} label={snapshot.superadmins.statusLabel} tone={snapshot.superadmins.tone} />
          </div>
          <Button asChild type="button" size="sm" variant="outline"><Link to="/users">권한 관리</Link></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {snapshot.superadmins.items.map((admin) => (
            <div key={`${admin.uid}:${admin.personId}`} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <div className="font-medium">{admin.displayName}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">{admin.uid}</div>
              <div className="mt-1"><StatusBadge status={admin.identityStatus} label={admin.identityStatusLabel} tone={admin.identityTone} /></div>
            </div>
          ))}
          {snapshot.superadmins.items.length === 0 ? <p className="text-xs text-muted-foreground">{snapshot.superadmins.statusLabel}</p> : null}
        </div>
      </div>
      <Table className="min-w-[980px]">
        <TableHeader><TableRow><TableHead>프로젝트</TableHead><TableHead>조직장 연결 상태</TableHead><TableHead>현재 연결</TableHead><TableHead>field-only 변경</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.items.map((item) => (
          <TableRow key={`permission:${item.project.id}`}>
            <TableCell><div className="font-medium">{item.project.name}</div><div className="font-mono text-[10px] text-muted-foreground">{item.project.id}</div></TableCell>
            <TableCell><StatusBadge status={item.executiveApprover.status} label={item.executiveApprover.statusLabel} tone={item.executiveApprover.tone} /></TableCell>
            <TableCell><div>{item.executiveApprover.displayName}</div><div className="font-mono text-[10px] text-muted-foreground">{item.executiveApprover.uid}</div><div className="font-mono text-[10px] text-muted-foreground">{item.executiveApprover.personId}</div></TableCell>
            <TableCell><ExecutiveApproverEditor item={item} snapshot={snapshot} saving={savingProjectId === item.project.id} onUpdate={onUpdateExecutiveApprover} /></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </SectionCard>
  );
}

function RecoveryEditor({
  item,
  recovering,
  resetting,
  onRecover,
  onReset,
}: {
  item: CashflowPeriodPolicyProjectItem;
  recovering: boolean;
  resetting: boolean;
  onRecover: (item: CashflowPeriodPolicyProjectItem, reason: string) => Promise<void>;
  onReset: (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  ) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetCycleId, setResetCycleId] = useState<string | null>(
    item.recovery.resetToReclose.expectedEvidence?.monthlyCloseId || null,
  );
  const resetEvidence = item.recovery.resetToReclose.expectedEvidence
    || item.recovery.resetToReclose.cycleCandidates.find((candidate) => (
      candidate.expectedEvidence.monthlyCloseId === resetCycleId
    ))?.expectedEvidence
    || null;
  const reasonId = `close-head-recovery-reason-${item.project.id}`;
  const confirmationId = `close-head-recovery-confirm-${item.project.id}`;
  const resetReasonId = `close-reset-reason-${item.project.id}`;
  const resetConfirmationId = `close-reset-confirm-${item.project.id}`;

  useEffect(() => {
    setReason('');
    setConfirmed(false);
  }, [item.project.id, item.recovery.status]);

  useEffect(() => {
    setResetReason('');
    setResetConfirmed(false);
    setResetCycleId(item.recovery.resetToReclose.expectedEvidence?.monthlyCloseId || null);
  }, [
    item.project.id,
    item.recovery.resetToReclose.status,
    item.recovery.resetToReclose.expectedEvidence?.monthlyCloseId,
  ]);

  return (
    <div className="min-w-[340px] space-y-2">
      <StatusBadge status={item.recovery.status} label={item.recovery.statusLabel} tone={item.recovery.tone} />
      <p className="text-xs text-muted-foreground">{item.recovery.guide}</p>
      {item.recovery.warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {item.recovery.warning}
        </p>
      ) : null}
      {item.recovery.reasons.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="복구 판정 근거">
          {item.recovery.reasons.map((reasonCode) => (
            <li key={`${item.project.id}:${reasonCode}`}>
              <code className="rounded bg-muted px-1.5 py-1 text-[10px] text-muted-foreground">{reasonCode}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {item.recovery.nextAction ? (
        <Button asChild type="button" size="sm" variant="outline">
          <Link to={item.recovery.nextAction.href}>{item.recovery.nextAction.label}</Link>
        </Button>
      ) : null}
      {item.recovery.actionAllowed && item.recovery.expectedEvidence ? (
        <form
          className="space-y-2 rounded-md border border-border bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onRecover(item, reason);
          }}
        >
          <label htmlFor={reasonId} className="block text-xs font-medium">
            복구 사유
            <Input
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="복구가 필요한 업무 근거"
              disabled={recovering}
              required
              maxLength={500}
              className="mt-1 h-8 text-xs"
            />
          </label>
          <label htmlFor={confirmationId} className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              id={confirmationId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={recovering}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>되돌리기 어려운 복구이며 변경 전·후 전체 값이 append-only 감사 사본으로 보존됨을 확인했습니다.</span>
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={recovering || !reason.trim() || !confirmed}
          >
            {recovering ? '복구 중' : '권한 복구 실행'}
          </Button>
        </form>
      ) : null}
      <div className="space-y-2 border-t border-border pt-3">
        <StatusBadge
          status={item.recovery.resetToReclose.status}
          label={item.recovery.resetToReclose.statusLabel}
          tone={item.recovery.resetToReclose.tone}
        />
        <p className="text-xs text-muted-foreground">{item.recovery.resetToReclose.guide}</p>
        {item.recovery.resetToReclose.warning ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
            {item.recovery.resetToReclose.warning}
          </p>
        ) : null}
        {item.recovery.resetToReclose.selectionAllowed ? (
          <fieldset className="space-y-1.5 rounded-md border border-border bg-background p-2">
            <legend className="px-1 text-xs font-medium">서버 확인 재결산 회차</legend>
            {item.recovery.resetToReclose.cycleCandidates.map((candidate) => (
              <label key={`${item.project.id}:reset:${candidate.yearMonth}`} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name={`reset-cycle-${item.project.id}`}
                  checked={candidate.expectedEvidence.monthlyCloseId === resetCycleId}
                  onChange={() => setResetCycleId(candidate.expectedEvidence.monthlyCloseId)}
                  disabled={resetting || recovering}
                />
                <span>{candidate.yearMonthLabel}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {(item.recovery.resetToReclose.actionAllowed || item.recovery.resetToReclose.selectionAllowed) ? (
          <form
            className="space-y-2 rounded-md border border-rose-200 bg-rose-50/30 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (resetEvidence) void onReset(item, resetReason, resetEvidence);
            }}
          >
            <label htmlFor={resetReasonId} className="block text-xs font-medium">
              재결산 준비 사유
              <Input
                id={resetReasonId}
                value={resetReason}
                onChange={(event) => setResetReason(event.target.value)}
                placeholder="격리가 필요한 업무 근거"
                disabled={resetting || recovering}
                required
                maxLength={500}
                className="mt-1 h-8 text-xs"
              />
            </label>
            <label htmlFor={resetConfirmationId} className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                id={resetConfirmationId}
                type="checkbox"
                checked={resetConfirmed}
                onChange={(event) => setResetConfirmed(event.target.checked)}
                disabled={resetting || recovering}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span>되돌리기 어려운 격리 작업이며 전체 before 값이 append-only 감사 사본으로 보존됨을 확인했습니다.</span>
            </label>
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={resetting || recovering || !resetReason.trim() || !resetConfirmed || !resetEvidence}
            >
              {resetting ? '재결산 준비 중' : '재결산 준비 실행'}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function AuthoritySectionWithRecovery({
  snapshot,
  recoveringProjectId,
  resettingProjectId,
  onRecoverCumulativeCloseHead,
  onResetCumulativeCloseToReclose,
}: {
  snapshot: CashflowPeriodPolicyResponse;
  recoveringProjectId: string;
  resettingProjectId: string;
  onRecoverCumulativeCloseHead: (item: CashflowPeriodPolicyProjectItem, reason: string) => Promise<void>;
  onResetCumulativeCloseToReclose: (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  ) => Promise<void>;
}) {
  return (
    <SectionCard title="월결산 authority" description="누적 마감 경계는 authority head가 제공한 값을 그대로 표시합니다." icon={CheckCircle2}>
      <Table className="min-w-[1320px]"><TableHeader><TableRow><TableHead>프로젝트</TableHead><TableHead>상태</TableHead><TableHead>닫힌 범위</TableHead><TableHead>Revision</TableHead><TableHead>Root hash</TableHead><TableHead>마감 시각</TableHead><TableHead>ERP 복구</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.items.map((item) => <TableRow key={`authority:${item.project.id}`}><TableCell>{item.project.name}</TableCell><TableCell><StatusBadge status={item.authority.status} label={item.authority.statusLabel} tone={item.authority.tone} /></TableCell><TableCell>{item.authority.closedThroughLabel}<span className="sr-only">{item.authority.closedThrough}</span></TableCell><TableCell>{item.authority.revisionLabel}</TableCell><TableCell className="max-w-[220px] break-all font-mono text-xs">{item.authority.rootHashLabel}<span className="sr-only">{item.authority.rootHash}</span></TableCell><TableCell>{item.authority.closedAtLabel}<span className="sr-only">{item.authority.closedAt}</span></TableCell><TableCell><RecoveryEditor item={item} recovering={recoveringProjectId === item.project.id} resetting={resettingProjectId === item.project.id} onRecover={onRecoverCumulativeCloseHead} onReset={onResetCumulativeCloseToReclose} /></TableCell></TableRow>)}</TableBody>
      </Table>
    </SectionCard>
  );
}

function RunSection({ snapshot }: { snapshot: CashflowPeriodPolicyResponse }) {
  return (
    <SectionCard title="월결산 run / error" description="회차 실행 기록은 authority 상태와 분리해 표시합니다." icon={Clock3}>
      <Table className="min-w-[900px]"><TableHeader><TableRow><TableHead>프로젝트</TableHead><TableHead>실행 상태</TableHead><TableHead>회차</TableHead><TableHead>Revision</TableHead><TableHead>처리자</TableHead><TableHead>처리 시각</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.items.map((item) => <TableRow key={`run:${item.project.id}`}><TableCell>{item.project.name}</TableCell><TableCell><StatusBadge status={item.latestRun.status} label={item.latestRun.statusLabel} tone={item.latestRun.tone} /></TableCell><TableCell>{item.latestRun.yearMonthLabel}<span className="sr-only">{item.latestRun.yearMonth}</span></TableCell><TableCell>{item.latestRun.revisionLabel}</TableCell><TableCell>{item.latestRun.closedByLabel}<div className="font-mono text-[10px] text-muted-foreground">{item.latestRun.closedByUid}</div></TableCell><TableCell>{item.latestRun.closedAtLabel}<span className="sr-only">{item.latestRun.closedAt}</span></TableCell></TableRow>)}</TableBody>
      </Table>
    </SectionCard>
  );
}

function SheetSection({ snapshot }: { snapshot: CashflowPeriodPolicyResponse }) {
  return (
    <SectionCard title="Sheet grain / source revision QA" description="연 결산과 주차 결산 grain, source/target revision을 서버 QA 결과 그대로 나눠 표시합니다." icon={Database}>
      <div className="divide-y divide-border">{snapshot.items.map((item) => (
        <article key={`sheet:${item.project.id}`} className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{item.project.name}</h3><StatusBadge status={item.sheet.status} label={item.sheet.statusLabel} tone={item.sheet.tone} /></div>
          <dl className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
            <div><dt className="text-muted-foreground">주차 grain</dt><dd className="mt-1 font-medium">{item.sheet.weeklyYearLabel}</dd></div>
            <div><dt className="text-muted-foreground">연 grain</dt><dd className="mt-1 font-medium">{item.sheet.annualYearsLabel}</dd></div>
            <div><dt className="text-muted-foreground">Revision QA</dt><dd className="mt-1"><StatusBadge status={item.sheet.revisionStatus} label={item.sheet.revisionStatusLabel} tone={item.sheet.revisionTone} /></dd></div>
            <div><dt className="text-muted-foreground">캡처 시각</dt><dd className="mt-1 font-medium">{item.sheet.capturedAtLabel}</dd><dd className="sr-only">{item.sheet.capturedAt}</dd></div>
          </dl>
          <dl className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 text-xs md:grid-cols-2">
            <div><dt className="text-muted-foreground">Source revision</dt><dd className="mt-1 break-all font-mono">{item.sheet.sourceRevisionLabel}</dd><dd className="sr-only">{item.sheet.sourceRevision}</dd></div>
            <div><dt className="text-muted-foreground">Applied source revision</dt><dd className="mt-1 break-all font-mono">{item.sheet.appliedSourceRevisionLabel}</dd><dd className="sr-only">{item.sheet.appliedSourceRevision}</dd></div>
            <div><dt className="text-muted-foreground">Target revision at fetch</dt><dd className="mt-1 break-all font-mono">{item.sheet.targetRevisionAtFetchLabel}</dd><dd className="sr-only">{item.sheet.targetRevisionAtFetch}</dd></div>
            <div><dt className="text-muted-foreground">Applied target revision</dt><dd className="mt-1 break-all font-mono">{item.sheet.appliedTargetRevisionLabel}</dd><dd className="sr-only">{item.sheet.appliedTargetRevision}</dd></div>
          </dl>
        </article>
      ))}</div>
    </SectionCard>
  );
}

function VarianceSection({ snapshot }: { snapshot: CashflowPeriodPolicyResponse }) {
  return (
    <SectionCard title="Projection ↔ Actual 편차" description="편차와 coverage는 서버 제공값만 표시하며 화면에서 합산하지 않습니다." icon={History}>
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold">전사 편차 요약</h3>
          <StatusBadge status={snapshot.forecastVariance.status} label={snapshot.forecastVariance.statusLabel} tone={snapshot.forecastVariance.tone} />
          <span className="text-xs text-muted-foreground">{snapshot.forecastVariance.coverageLabel}</span>
        </div>
        <Table className="min-w-[620px]">
          <TableHeader><TableRow><TableHead>지표</TableHead><TableHead>Projection</TableHead><TableHead>Actual</TableHead><TableHead>편차</TableHead></TableRow></TableHeader>
          <TableBody>{snapshot.forecastVariance.totals.metrics.map((metric) => (
            <TableRow key={`enterprise-variance:${metric.key}`}><TableCell>{metric.label}</TableCell><TableCell>{metric.baselineLabel}</TableCell><TableCell>{metric.actualLabel}</TableCell><TableCell>{metric.varianceLabel}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <div className="divide-y divide-border">{snapshot.items.map((item) => (
        <article key={`variance:${item.project.id}`} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.project.name}</h3>
            <StatusBadge status={item.forecastVariance.status} label={item.forecastVariance.statusLabel} tone={item.forecastVariance.tone} />
            <span className="text-xs text-muted-foreground">{item.forecastVariance.coverageLabel}</span>
          </div>
          {item.forecastVariance.rows.map((row, rowIndex) => (
            <div key={`${item.project.id}:${row.yearMonth}:${row.weekNo}:${rowIndex}`} className="space-y-2 rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">{row.weekLabel}</span>
                <StatusBadge status={row.status} label={row.statusLabel} tone={row.tone} />
                {row.reasonLabel ? <span className="text-xs text-muted-foreground">{row.reasonLabel}</span> : null}
                {row.reason ? <code className="text-[10px] text-muted-foreground">{row.reason}</code> : null}
              </div>
              {row.metrics.length === 0 ? (
                <p className="text-xs text-muted-foreground">{row.reasonLabel || row.statusLabel}</p>
              ) : (
                <Table className="min-w-[620px]">
                  <TableHeader><TableRow><TableHead>지표</TableHead><TableHead>Projection</TableHead><TableHead>Actual</TableHead><TableHead>편차</TableHead></TableRow></TableHeader>
                  <TableBody>{row.metrics.map((metric) => (
                    <TableRow key={`${rowIndex}:${metric.key}`}><TableCell>{metric.label}</TableCell><TableCell>{metric.baselineLabel}</TableCell><TableCell>{metric.actualLabel}</TableCell><TableCell>{metric.varianceLabel}</TableCell></TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </div>
          ))}
          {item.forecastVariance.rows.length === 0 ? <p className="text-xs text-muted-foreground">{item.forecastVariance.coverageLabel}</p> : null}
        </article>
      ))}</div>
    </SectionCard>
  );
}

function IssueRows({ issues, prefix }: { issues: CashflowPeriodPolicyIssue[]; prefix: string }) {
  if (issues.length === 0) return <p className="text-xs text-muted-foreground">등록된 issue가 없습니다.</p>;
  return <ul className="space-y-2">{issues.map((issue) => <li key={`${prefix}:${issue.code}`} className="rounded-md border border-border bg-background p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={issue.severity} label={issue.severity} tone={issue.severityTone} /><span className="font-semibold">{issue.label}</span><code className="text-[10px] text-muted-foreground">{issue.code}</code></div><p className="mt-2 text-muted-foreground">{issue.detail}</p></li>)}</ul>;
}

function IssuesSection({ snapshot }: { snapshot: CashflowPeriodPolicyResponse }) {
  return (
    <SectionCard title="Issues / UNAVAILABLE" description="누락과 조회 실패를 숨기지 않고 서버 issue 및 UNAVAILABLE 상태 그대로 표시합니다." icon={AlertTriangle}>
      <div className="space-y-4 p-4"><div><h3 className="mb-2 text-xs font-semibold">전사 issue</h3><IssueRows issues={snapshot.issues} prefix="global" /></div>{snapshot.items.map((item) => <div key={`issues:${item.project.id}`}><h3 className="mb-2 text-xs font-semibold">{item.project.name}</h3><IssueRows issues={item.issues} prefix={item.project.id} /></div>)}</div>
    </SectionCard>
  );
}

function AuditSection({ snapshot }: { snapshot: CashflowPeriodPolicyResponse }) {
  return (
    <SectionCard title="Audit" description="JVM이 append-only로 기록한 닫힌 월 수정 증거만 읽기 전용으로 표시합니다." icon={History}>
      <div className="border-b border-border p-4">
        <StatusBadge status={snapshot.amendments.status} label={snapshot.amendments.statusLabel} tone={snapshot.amendments.tone} />
      </div>
      <Table className="min-w-[1180px]"><TableHeader><TableRow><TableHead>프로젝트</TableHead><TableHead>대상 월</TableHead><TableHead>수정 사유</TableHead><TableHead>Close revision</TableHead><TableHead>Sheet revision</TableHead><TableHead>처리자</TableHead><TableHead>생성 시각</TableHead></TableRow></TableHeader>
        <TableBody>{snapshot.amendments.rows.length === 0 ? (
          <TableRow><TableCell colSpan={7}><StatusBadge status={snapshot.amendments.status} label={snapshot.amendments.statusLabel} tone={snapshot.amendments.tone} /></TableCell></TableRow>
        ) : snapshot.amendments.rows.map((row) => (
          <TableRow key={`amendment:${row.id}:${row.projectId}:${row.yearMonth}:${row.createdAt}`}>
            <TableCell><div className="font-medium">{row.projectName}</div><div className="font-mono text-[10px] text-muted-foreground">{row.projectId}</div></TableCell>
            <TableCell>{row.yearMonthLabel}<div className="font-mono text-[10px] text-muted-foreground">{row.yearMonth}</div></TableCell>
            <TableCell className="max-w-[260px] whitespace-normal">{row.reasonLabel}</TableCell>
            <TableCell><div>{row.closeRevisionLabel} → {row.resultingCloseRevisionLabel}</div><div className="mt-1 max-w-[220px] break-all font-mono text-[10px] text-muted-foreground">{row.closeSnapshotHashLabel}</div></TableCell>
            <TableCell className="space-y-1 font-mono text-[10px]"><div>source {row.sourceRevisionLabel}</div><div>target {row.targetRevisionLabel}</div><div>result {row.resultingTargetRevisionLabel}</div></TableCell>
            <TableCell><div>{row.actorLabel}</div><div className="font-mono text-[10px] text-muted-foreground">{row.actorUid}</div></TableCell>
            <TableCell><div>{row.createdAtLabel}</div><div className="font-mono text-[10px] text-muted-foreground">{row.createdAt}</div></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </SectionCard>
  );
}

export function CashflowPeriodPolicySections({
  snapshot,
  savingProjectId,
  recoveringProjectId,
  resettingProjectId,
  onUpdateExecutiveApprover,
  onRecoverCumulativeCloseHead,
  onResetCumulativeCloseToReclose,
}: {
  snapshot: CashflowPeriodPolicyResponse;
  savingProjectId: string;
  recoveringProjectId: string;
  resettingProjectId: string;
  onUpdateExecutiveApprover: (item: CashflowPeriodPolicyProjectItem, uid: string, reason: string) => Promise<void>;
  onRecoverCumulativeCloseHead: (item: CashflowPeriodPolicyProjectItem, reason: string) => Promise<void>;
  onResetCumulativeCloseToReclose: (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <PolicyPermissionsSection snapshot={snapshot} savingProjectId={savingProjectId} onUpdateExecutiveApprover={onUpdateExecutiveApprover} />
      <AuthoritySectionWithRecovery
        snapshot={snapshot}
        recoveringProjectId={recoveringProjectId}
        resettingProjectId={resettingProjectId}
        onRecoverCumulativeCloseHead={onRecoverCumulativeCloseHead}
        onResetCumulativeCloseToReclose={onResetCumulativeCloseToReclose}
      />
      <RunSection snapshot={snapshot} />
      <SheetSection snapshot={snapshot} />
      <VarianceSection snapshot={snapshot} />
      <IssuesSection snapshot={snapshot} />
      <AuditSection snapshot={snapshot} />
    </div>
  );
}
