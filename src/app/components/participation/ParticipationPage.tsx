import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2, Pencil, Plus, Settings2, ShieldAlert, Users } from 'lucide-react';
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
import {
  fetchParticipationDashboardViaBff,
  isPlatformApiEnabled,
  saveParticipationRuleViaBff,
  type ParticipationDashboardRule,
  type ParticipationDashboardSnapshot,
} from '../../lib/platform-bff-client';

function RuleManager({ open, onOpenChange, snapshot, tenantId, user, onSaved }: {
  open: boolean; onOpenChange: (open: boolean) => void; snapshot: ParticipationDashboardSnapshot;
  tenantId: string; user: AuthUser; onSaved: () => void;
}) {
  const [editing, setEditing] = useState<ParticipationDashboardRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [alias, setAlias] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const start = (rule?: ParticipationDashboardRule) => { setEditing(rule || null); setAlias(rule?.alias || ''); setProjectIds(rule?.projectIds || []); setError(''); setFormOpen(true); };
  const toggle = (projectId: string) => setProjectIds((current) => current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]);
  const save = () => {
    if (saving) return;
    setSaving(true); setError('');
    void saveParticipationRuleViaBff({ tenantId, actor: user, id: editing?.id, alias, projectIds, idempotencyKey: `participation-rule-${crypto.randomUUID()}` })
      .then(() => { setFormOpen(false); onSaved(); })
      .catch(() => setError('규칙을 저장하지 못했습니다.'))
      .finally(() => setSaving(false));
  };
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) setFormOpen(false); onOpenChange(nextOpen); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>참여율 규칙 관리</DialogTitle><DialogDescription>규칙명과 포함할 프로젝트를 자유롭게 정합니다. 선택된 프로젝트만 해당 규칙의 12개월 참여율에 반영됩니다.</DialogDescription></DialogHeader>
      {!formOpen ? <div className="space-y-2">
        {snapshot.userRuleOptions.map((rule) => <div key={rule.id} className="flex items-center justify-between rounded-md border px-3 py-2"><div><p className="text-sm font-medium">{rule.alias}</p><p className="text-xs text-muted-foreground">프로젝트 {rule.projectCount}건</p></div><Button variant="outline" size="sm" onClick={() => start(rule)}><Pencil className="mr-1 h-3.5 w-3.5" />수정</Button></div>)}
        <Button variant="outline" className="w-full" onClick={() => start()}><Plus className="mr-1 h-4 w-4" />새 규칙 만들기</Button>
      </div> : <div className="space-y-4"><div><label className="text-xs font-medium">규칙명</label><Input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="예: 홍시궁 + e나라도움" maxLength={80} autoFocus /></div><div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">{snapshot.projects.map((project) => <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><Checkbox checked={projectIds.includes(project.id)} onCheckedChange={() => toggle(project.id)} /><span>{project.name}</span><span className="ml-auto text-xs text-muted-foreground">{project.clientOrg || '계약 대상 미지정'}</span></label>)}</div>{error && <p className="text-xs text-rose-600">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>목록</Button><Button disabled={!alias.trim() || saving} onClick={save}>{saving ? '저장 중' : '저장'}</Button></DialogFooter></div>}
    </DialogContent>
  </Dialog>;
}

export function ParticipationPage() {
  const { user } = useAuth(); const { orgId } = useFirebase();
  const [snapshot, setSnapshot] = useState<ParticipationDashboardSnapshot | null>(null);
  const [selectedYear, setSelectedYear] = useState(''); const [selectedRuleId, setSelectedRuleId] = useState('all');
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [refreshToken, setRefreshToken] = useState(0); const [managerOpen, setManagerOpen] = useState(false);
  useEffect(() => { if (!user || !isPlatformApiEnabled()) { setLoading(false); setError('참여율 대시보드 서버 연결을 사용할 수 없습니다.'); return; } let cancelled = false; setLoading(true); setError(''); void fetchParticipationDashboardViaBff({ tenantId: orgId, actor: user, year: selectedYear || undefined, ruleId: selectedRuleId }).then((next) => { if (!cancelled) { setSnapshot(next); setSelectedYear(next.selectedYear); setSelectedRuleId(next.selectedRule.id); } }).catch(() => { if (!cancelled) setError('참여율 대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [orgId, refreshToken, selectedRuleId, selectedYear, user]);
  if (loading) return <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 참여율 스냅샷을 불러오는 중입니다.</div>;
  if (error || !snapshot) return <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>참여율 스냅샷을 표시할 수 없습니다</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  return <div className="space-y-5"><PageHeader icon={Users} iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)" title="참여인력 대시보드" description="전사 인력의 12개월 참여율입니다. 규칙을 선택하면 연결된 프로젝트만 서버 기준으로 반영됩니다." />
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-2.5"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-white"><CalendarDays className="h-4 w-4" /></div><div><h2 className="text-sm font-semibold text-slate-900">월별 서류 참여율</h2><p className="mt-0.5 text-xs text-slate-500">{snapshot.selectedRule.alias} · 프로젝트 {snapshot.selectedRule.projectCount}건 · 서버 집계</p></div></div><div className="flex flex-wrap items-center gap-2"><select value={snapshot.selectedRule.id} onChange={(event) => setSelectedRuleId(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium"><option value="all">전체 인력</option>{snapshot.userRuleOptions.map((rule) => <option key={rule.id} value={rule.id}>{rule.alias} · {rule.projectCount}건</option>)}</select><select value={snapshot.selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium">{snapshot.availableYears.map((year) => <option key={year} value={year}>{year}년</option>)}</select>{user && <Button variant="outline" size="sm" className="h-8" onClick={() => setManagerOpen(true)}><Settings2 className="mr-1 h-3.5 w-3.5" />규칙 관리</Button>}{snapshot.hasWarnings && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />100% 초과 {snapshot.warningCount}건</Badge>}</div></div>
      <div className="overflow-x-auto"><Table className="min-w-[1220px]"><TableHeader><TableRow className="border-slate-200 bg-slate-100 hover:bg-slate-100"><TableHead className="sticky left-0 z-10 min-w-[120px] bg-slate-100 text-xs font-semibold text-slate-700">이름</TableHead><TableHead className="sticky left-[120px] z-10 min-w-[160px] border-r border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700">프로젝트</TableHead>{snapshot.months.map((month) => <TableHead key={month.yearMonth} className="min-w-[70px] text-center text-xs font-semibold text-slate-700">{month.label}</TableHead>)}</TableRow></TableHeader><TableBody>{snapshot.members.map((member) => <TableRow key={member.memberId} className="group border-slate-100 hover:bg-slate-50/70"><TableCell className="sticky left-0 z-10 bg-white text-xs font-medium text-slate-800 group-hover:bg-slate-50">{member.memberName}</TableCell><TableCell className="sticky left-[120px] z-10 border-r border-slate-100 bg-white text-xs text-slate-600 group-hover:bg-slate-50">{member.projectLabel}</TableCell>{member.months.map((month) => <TableCell key={month.yearMonth} className={`px-2 py-2 text-center text-xs tabular-nums ${month.isWarning ? 'bg-rose-50 font-semibold text-rose-700' : month.rate ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>{month.rate ? `${month.rate}%` : '미입력'}</TableCell>)}</TableRow>)}</TableBody></Table></div>{snapshot.members.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">선택한 범위에 등록된 프로젝트 참여자가 없습니다.</div>}</section>
    {user && <RuleManager open={managerOpen} onOpenChange={setManagerOpen} snapshot={snapshot} tenantId={orgId} user={user} onSaved={() => { setManagerOpen(false); setRefreshToken((value) => value + 1); }} />}
  </div>;
}
