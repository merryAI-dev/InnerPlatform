import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2, Pencil, ShieldAlert, Users } from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { useAuth, type AuthUser } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchParticipationDashboardViaBff,
  isPlatformApiEnabled,
  saveParticipationRuleAliasViaBff,
  type ParticipationDashboardRule,
  type ParticipationDashboardSnapshot,
} from '../../lib/platform-bff-client';

function RuleAliasEditor({ rule, tenantId, user, onSaved }: {
  rule: ParticipationDashboardRule;
  tenantId: string;
  user: AuthUser;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(rule.alias);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => setAlias(rule.alias), [rule.alias]);

  if (!editing) {
    return <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />{rule.isSaved ? '별칭 수정' : '규칙 생성'}</Button>;
  }

  return (
    <form className="flex items-center gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      setSaveError('');
      void saveParticipationRuleAliasViaBff({
        tenantId, actor: user, ruleId: rule.id, alias,
        idempotencyKey: `participation-rule-${crypto.randomUUID()}`,
      }).then(() => { setEditing(false); onSaved(); }).catch(() => setSaveError('규칙 별칭을 저장하지 못했습니다.')).finally(() => setSaving(false));
    }}>
      <Input aria-label={`${rule.alias} 별칭`} value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={80} className="h-7 w-48 text-xs" autoFocus />
      <Button type="submit" size="sm" className="h-7 text-xs" disabled={saving}>{saving ? '저장 중' : '저장'}</Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAlias(rule.alias); setSaveError(''); setEditing(false); }}>취소</Button>
      {saveError && <span className="text-xs text-rose-600">{saveError}</span>}
    </form>
  );
}

export function ParticipationPage() {
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [snapshot, setSnapshot] = useState<ParticipationDashboardSnapshot | null>(null);
  const [selectedYear, setSelectedYear] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!user || !isPlatformApiEnabled()) {
      setLoading(false);
      setError('참여율 대시보드 서버 연결을 사용할 수 없습니다.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void fetchParticipationDashboardViaBff({ tenantId: orgId, actor: user, year: selectedYear || undefined })
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setSelectedYear(next.selectedYear);
      })
      .catch(() => {
        if (!cancelled) setError('참여율 대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [orgId, refreshToken, selectedYear, user]);

  if (loading) {
    return <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 참여율 스냅샷을 불러오는 중입니다.</div>;
  }

  if (error || !snapshot) {
    return <Alert variant="destructive"><ShieldAlert className="h-4 w-4" /><AlertTitle>참여율 스냅샷을 표시할 수 없습니다</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)"
        title="참여인력 대시보드"
        description="프로젝트의 정산 시스템과 계약 대상으로 생성된 규칙별 12개월 참여율입니다. 모든 값과 경고는 서버 스냅샷 기준입니다."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3">
        <div className="text-xs text-muted-foreground">규칙 별칭과 월별 합산은 프로젝트 저장 파이프라인에서 관리됩니다.</div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          기준 연도
          <select value={snapshot.selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs">
            {snapshot.availableYears.map((year) => <option key={year} value={year}>{year}년</option>)}
          </select>
        </label>
      </div>

      {snapshot.rules.map((rule) => (
        <Card key={rule.id} className={rule.hasWarnings ? 'border-rose-300' : ''}>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">{rule.alias}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{rule.contractTarget} · {rule.settlementSystem} · 프로젝트 {rule.projectCount}건</p>
            </div>
            <div className="flex items-center gap-2">
              {rule.hasWarnings ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" />100% 초과 {rule.warningCount}건</Badge> : <Badge variant="outline">정상</Badge>}
              {user && <RuleAliasEditor rule={rule} tenantId={orgId} user={user} onSaved={() => setRefreshToken((value) => value + 1)} />}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHeader><TableRow className="bg-muted/30"><TableHead className="min-w-[120px]">인력</TableHead><TableHead className="min-w-[180px]">프로젝트</TableHead>{snapshot.months.map((month) => <TableHead key={month.yearMonth} className="min-w-[64px] text-center">{month.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{rule.members.map((member) => <TableRow key={member.memberId}><TableCell className="text-xs font-medium">{member.memberName}</TableCell><TableCell className="text-xs text-muted-foreground">{member.projectNames.join(' · ')}</TableCell>{member.months.map((month) => <TableCell key={month.yearMonth} className={`text-center text-xs tabular-nums ${month.isWarning ? 'bg-rose-50 font-semibold text-rose-700' : ''}`}>{month.rate}%</TableCell>)}</TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {!snapshot.hasRules && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-5 w-5" />프로젝트 참여인력 규칙이 아직 생성되지 않았습니다.</CardContent></Card>}
    </div>
  );
}
