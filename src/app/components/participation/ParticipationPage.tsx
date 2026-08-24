import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertTriangle, CalendarDays, ChevronRight, Loader2, Pencil, Plus, Settings2, ShieldAlert, Users } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { useAuth, type AuthUser } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { ParticipationSheetPreviewPanel } from './ParticipationSheetPreviewPanel';
import {
  fetchParticipationDashboardViaBff,
  isPlatformApiEnabled,
  saveParticipationRuleViaBff,
  type ParticipationDashboardMonth,
  type ParticipationDashboardRule,
  type ParticipationDashboardSnapshot,
} from '../../lib/platform-bff-client';

function ParticipationMonthValue({ month, detail = false }: { month: ParticipationDashboardMonth; detail?: boolean }) {
  return <TableCell className={`px-2 py-2 text-center tabular-nums ${detail ? 'text-[11px]' : 'text-xs'} ${month.isWarning ? 'bg-rose-50 font-semibold text-rose-700' : month.hasMissing ? 'bg-amber-50 text-amber-800' : month.isConfirmed ? 'font-semibold text-slate-800' : 'text-slate-300'}`}>{month.isConfirmed ? <span className="inline-flex flex-col"><span>{`${month.rate}%`}</span>{month.hasMissing ? <span className="text-[10px] font-medium">미입력 있음</span> : null}</span> : month.hasMissing ? '미입력' : '—'}</TableCell>;
}

function RuleManager({ open, onOpenChange, snapshot, tenantId, user, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; snapshot: ParticipationDashboardSnapshot;
  tenantId: string; user: AuthUser; onSaved: () => void;
}) {
  const [editing, setEditing] = useState<ParticipationDashboardRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [alias, setAlias] = useState('');
  const [clientOrgs, setClientOrgs] = useState<string[]>([]);
  const [settlementSystems, setSettlementSystems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const start = (rule?: ParticipationDashboardRule) => { setEditing(rule || null); setAlias(rule?.alias || ''); setClientOrgs(rule?.clientOrgs || []); setSettlementSystems(rule?.settlementSystems || []); setError(''); setFormOpen(true); };
  const toggle = (value: string, setValues: Dispatch<SetStateAction<string[]>>) => setValues((current) => current.includes(value) ? current.filter((item) => item !== value) : current.length < 4 ? [...current, value] : current);
  const save = () => {
    if (saving) return;
    setSaving(true); setError('');
    void saveParticipationRuleViaBff({ tenantId, actor: user, id: editing?.id, alias, clientOrgs, settlementSystems, idempotencyKey: `participation-rule-${crypto.randomUUID()}` })
      .then(() => { setFormOpen(false); onSaved(); })
      .catch(() => setError('규칙을 저장하지 못했습니다.'))
      .finally(() => setSaving(false));
  };
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) setFormOpen(false); onOpenChange(nextOpen); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>참여율 규칙 관리</DialogTitle><DialogDescription>규칙명과 계약 대상·정산 시스템을 조합합니다. 선택하지 않은 조건은 해당 구분을 제한하지 않습니다. 같은 조건 안에서는 여러 값을 함께 선택할 수 있습니다.</DialogDescription></DialogHeader>
      {!formOpen ? <div className="space-y-2">
        {snapshot.userRuleOptions.map((rule) => <div key={rule.id} className="flex items-center justify-between rounded-md border px-3 py-2"><div><p className="text-sm font-medium">{rule.alias}</p><p className="text-xs text-muted-foreground">계약 대상 {rule.clientOrgs.length}개 · 정산 시스템 {rule.settlementSystems.length}개</p></div><Button variant="outline" size="sm" onClick={() => start(rule)}><Pencil className="mr-1 h-3.5 w-3.5" />수정</Button></div>)}
        <Button variant="outline" className="w-full" onClick={() => start()}><Plus className="mr-1 h-4 w-4" />새 규칙 만들기</Button>
      </div> : <div className="space-y-4"><div><label className="text-xs font-medium">규칙명</label><Input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="예: 홍시궁 + e나라도움" maxLength={80} autoFocus /></div><div className="grid gap-3 md:grid-cols-2"><fieldset className="max-h-64 overflow-y-auto rounded-md border p-3"><legend className="px-1 text-xs font-medium">계약 대상 <span className="text-muted-foreground">({clientOrgs.length}/4)</span></legend>{snapshot.filterOptions.clientOrgs.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted"><Checkbox checked={clientOrgs.includes(value)} onCheckedChange={() => toggle(value, setClientOrgs)} /><span>{value}</span></label>)}</fieldset><fieldset className="max-h-64 overflow-y-auto rounded-md border p-3"><legend className="px-1 text-xs font-medium">정산 시스템 <span className="text-muted-foreground">({settlementSystems.length}/4)</span></legend>{snapshot.filterOptions.settlementSystems.map((system) => <label key={system.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted"><Checkbox checked={settlementSystems.includes(system.value)} onCheckedChange={() => toggle(system.value, setSettlementSystems)} /><span>{system.label} · {Number(system.projectCount) || 0}개</span></label>)}</fieldset></div>{error && <p className="text-xs text-rose-600">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>목록</Button><Button disabled={!alias.trim() || saving} onClick={save}>{saving ? '저장 중' : '저장'}</Button></DialogFooter></div>}
    </DialogContent>
  </Dialog>;
}

export function ParticipationPage() {
  const { user } = useAuth(); const { orgId } = useFirebase();
  const [snapshot, setSnapshot] = useState<ParticipationDashboardSnapshot | null>(null);
  const [selectedYear, setSelectedYear] = useState('2026'); const [selectedRuleId, setSelectedRuleId] = useState('all');
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [refreshToken, setRefreshToken] = useState(0); const [managerOpen, setManagerOpen] = useState(false);
  useEffect(() => { if (!user || !isPlatformApiEnabled()) { setLoading(false); setError('참여율 대시보드 서버 연결을 사용할 수 없습니다.'); return; } let cancelled = false; setLoading(true); setError(''); void fetchParticipationDashboardViaBff({ tenantId: orgId, actor: user, year: selectedYear || undefined, ruleId: selectedRuleId }).then((next) => { if (!cancelled) { setSnapshot(next); setSelectedYear(next.selectedYear); setSelectedRuleId(next.selectedRule.id); } }).catch(() => { if (!cancelled) setError('참여율 대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [orgId, refreshToken, selectedRuleId, selectedYear, user]);
  useEffect(() => { setExpandedMemberIds(new Set()); }, [selectedRuleId, selectedYear]);
  const toggleMember = (memberId: string) => setExpandedMemberIds((current) => {
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId); else next.add(memberId);
    return next;
  });
  if (loading) return <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 참여율 스냅샷을 불러오는 중입니다.</div>;
  if (error || !snapshot) return <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>참여율 스냅샷을 표시할 수 없습니다</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  return <div className="space-y-5"><PageHeader icon={Users} iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)" title="참여인력 대시보드" description="전사 인력의 12개월 참여율입니다. 규칙을 선택하면 계약 대상·정산 시스템 조건을 서버 기준으로 반영합니다." />
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-2.5"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-white"><CalendarDays className="h-4 w-4" /></div><div><h2 className="text-sm font-semibold text-slate-900">월별 서류 참여율</h2><p className="mt-0.5 text-xs text-slate-500">{snapshot.selectedRule.alias} · 서버 집계</p></div></div><div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-[11px] font-medium text-slate-500"><span>View</span><select aria-label="참여율 View" value={snapshot.selectedRule.id} onChange={(event) => setSelectedRuleId(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800"><option value="all">전체 인력</option>{snapshot.userRuleOptions.map((rule) => <option key={rule.id} value={rule.id}>{rule.alias}</option>)}</select></label><label className="grid gap-1 text-[11px] font-medium text-slate-500"><span>연도</span><select aria-label="참여율 연도" value={snapshot.selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800">{snapshot.availableYears.map((year) => <option key={year} value={year}>{year}년</option>)}</select></label>{user && <Button variant="outline" size="sm" className="h-8" onClick={() => setManagerOpen(true)}><Settings2 className="mr-1 h-3.5 w-3.5" />규칙 관리</Button>}{snapshot.hasWarnings && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />100% 초과 {snapshot.warningCount}건</Badge>}</div></div>
      <div className="overflow-x-auto"><Table className="min-w-[1160px]"><TableHeader><TableRow className="border-slate-200 bg-slate-100 hover:bg-slate-100"><TableHead className="sticky left-0 z-10 min-w-[150px] bg-slate-100 text-xs font-semibold text-slate-700">사람</TableHead><TableHead className="sticky left-[150px] z-10 min-w-[110px] border-r border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700">참여 사업</TableHead>{snapshot.months.map((month) => <TableHead key={month.yearMonth} className="min-w-[70px] text-center text-xs font-semibold text-slate-700">{month.label}</TableHead>)}</TableRow></TableHeader>{snapshot.members.map((member) => {
        const projects = member.projects || [];
        const canExpand = snapshot.selectedRule.id !== 'all' && projects.length > 0;
        const isExpanded = canExpand && expandedMemberIds.has(member.memberId);
        const projectLabel = projects.length > 1 ? `${projects[0].projectName} 외 ${projects.length - 1}개 · 총 ${projects.length}개` : projects[0]?.projectName;
        return <Fragment key={member.memberId}><TableBody><TableRow className="group border-slate-100 hover:bg-slate-50/70"><TableCell className="sticky left-0 z-10 bg-white text-xs font-medium text-slate-800 group-hover:bg-slate-50">{member.memberName}</TableCell><TableCell className="sticky left-[150px] z-10 border-r border-slate-100 bg-white text-xs text-slate-600 group-hover:bg-slate-50">{canExpand ? <button type="button" aria-label={`${member.memberName}의 프로젝트 ${projects.length}개 ${isExpanded ? '접기' : '펼치기'}`} aria-expanded={isExpanded} aria-controls={`participation-projects-${member.memberId}`} onClick={() => toggleMember(member.memberId)} className="flex w-full items-center gap-1 rounded-sm text-left font-medium text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"><ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" /><span>{projectLabel}</span></button> : <>프로젝트 {member.projectCount}개</>}</TableCell>{member.months.map((month) => <ParticipationMonthValue key={month.yearMonth} month={month} />)}</TableRow></TableBody>{canExpand ? <TableBody id={`participation-projects-${member.memberId}`} hidden={!isExpanded}>{projects.map((project) => <TableRow key={project.projectId} className="border-slate-100 bg-slate-50/40"><TableCell className="sticky left-0 z-10 bg-slate-50/80" aria-hidden="true" /><TableCell className="sticky left-[150px] z-10 border-r border-slate-100 bg-slate-50/80 py-2 pl-6 text-[11px] text-slate-600"><span className="flex items-start gap-1"><ChevronRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span>{project.projectName}</span></span></TableCell>{project.months.map((month) => <ParticipationMonthValue key={month.yearMonth} month={month} detail />)}</TableRow>)}</TableBody> : null}</Fragment>;
      })}</Table></div>{snapshot.members.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">선택한 범위에 등록된 프로젝트 참여자가 없습니다.</div>}</section>
    {snapshot.unlinkedEntryCount > 0 && <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>People 연결 대기 참여행 {snapshot.unlinkedEntryCount}건</AlertTitle><AlertDescription>People ID가 없는 과거 참여행은 사람별 합계에 포함하지 않았습니다.</AlertDescription></Alert>}
    {/* 시트가 채워지는 동안 플랫폼에서 확인할 수 있어야 한다. 읽기 전용이라 값은 바뀌지 않는다. */}
    {user && <ParticipationSheetPreviewPanel tenantId={orgId} user={user} projects={snapshot.projects || []} />}
    {user && <RuleManager open={managerOpen} onOpenChange={setManagerOpen} snapshot={snapshot} tenantId={orgId} user={user} onSaved={() => { setManagerOpen(false); setRefreshToken((value) => value + 1); }} />}
  </div>;
}
