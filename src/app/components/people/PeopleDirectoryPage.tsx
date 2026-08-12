import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Briefcase, CalendarClock, Plus, RefreshCw, Search, UserPlus, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { featureFlags } from '../../config/feature-flags';
import { useAuth } from '../../data/auth-store';
import { useAppStore } from '../../data/store';
import { useFirebase } from '../../lib/firebase-context';
import {
  changePersonEmploymentViaBff,
  createPersonViaBff,
  fetchPersonsViaBff,
  type PersonRecord,
} from '../../lib/platform-bff-client';
import {
  deriveTenure,
  EMPLOYMENT_STATE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  resolveCurrentEmployment,
  resolveSeparationDate,
  type EmploymentState,
  type EmploymentType,
  type Person,
} from '../../platform/person-employment';
import { normalizeProjectTeamMembers } from '../../platform/project-team-members';
import { PageHeader } from '../layout/PageHeader';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { Separator } from '../ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const TYPE_TONE: Record<EmploymentType, string> = {
  FULL_TIME: 'border-slate-300 bg-white text-slate-700',
  INTERN: 'border-sky-200 bg-sky-50 text-sky-700',
  PARTNER: 'border-amber-200 bg-amber-50 text-amber-800',
  PLACEHOLDER: 'border-dashed border-slate-300 bg-slate-50 text-slate-500',
};

const STATE_TONE: Record<EmploymentState, string> = {
  WORKING: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ON_LEAVE: 'border-amber-200 bg-amber-50 text-amber-800',
  PARENTAL_LEAVE: 'border-amber-200 bg-amber-50 text-amber-800',
};

function formatDate(value: string | null): string {
  if (!value) return '진행 중';
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}

/** 프로젝트에 이름이 있는데 명부에 없는 사람 — 유령 배정. 이름으로만 맞춰볼 수 있다. */
function findUnregisteredAssignees(
  projects: ReturnType<typeof useAppStore>['projects'],
  people: PersonRecord[],
) {
  const known = new Set(people.map((person) => `${person.name}|${person.nickname}`.replace(/\s/g, '')));
  const knownNames = new Set(people.map((person) => person.name.replace(/\s/g, '')));
  const found = new Map<string, { name: string; nickname: string; projects: string[]; totalRate: number }>();

  projects.forEach((project) => {
    normalizeProjectTeamMembers(project.teamMembersDetailed).forEach((member) => {
      const name = String(member.memberName || '').trim();
      if (!name) return;
      const key = `${name}|${member.memberNickname || ''}`.replace(/\s/g, '');
      if (known.has(key) || knownNames.has(name.replace(/\s/g, ''))) return;
      const entry = found.get(key) || {
        name, nickname: member.memberNickname || '', projects: [], totalRate: 0,
      };
      entry.projects.push(project.shortName || project.name);
      entry.totalRate += member.participationRate || 0;
      found.set(key, entry);
    });
  });

  return [...found.values()].sort((a, b) => b.totalRate - a.totalRate);
}

interface EmploymentDraft {
  mode: 'change' | 'add';
  type: EmploymentType;
  state: EmploymentState;
  effectiveFrom: string;
  endDate: string;
  note: string;
}

function emptyDraft(mode: 'change' | 'add' = 'change'): EmploymentDraft {
  return { mode, type: 'PARTNER', state: 'WORKING', effectiveFrom: today(), endDate: '', note: '' };
}

function EmploymentForm({
  draft, onChange, disabled,
}: {
  draft: EmploymentDraft;
  onChange: (next: EmploymentDraft) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label className="text-[12px]">근로형태</Label>
        <Select
          value={draft.type}
          onValueChange={(value) => onChange({ ...draft, type: value as EmploymentType })}
          disabled={disabled}
        >
          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((type) => (
              <SelectItem key={type} value={type}>{EMPLOYMENT_TYPE_LABELS[type]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[12px]">재직상태</Label>
        <Select
          value={draft.state}
          onValueChange={(value) => onChange({ ...draft, state: value as EmploymentState })}
          disabled={disabled}
        >
          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(EMPLOYMENT_STATE_LABELS) as EmploymentState[]).map((state) => (
              <SelectItem key={state} value={state}>{EMPLOYMENT_STATE_LABELS[state]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[12px]">적용일</Label>
        <Input
          type="date" className="mt-1 h-9" value={draft.effectiveFrom} disabled={disabled}
          onChange={(event) => onChange({ ...draft, effectiveFrom: event.target.value })}
        />
        <p className="mt-1 text-[11px] text-slate-500">이 날부터 새 계약이 적용됩니다.</p>
      </div>
      <div>
        <Label className="text-[12px]">종료일 <span className="text-slate-400">(선택)</span></Label>
        <Input
          type="date" className="mt-1 h-9" value={draft.endDate} disabled={disabled}
          onChange={(event) => onChange({ ...draft, endDate: event.target.value })}
        />
        <p className="mt-1 text-[11px] text-slate-500">비워두면 진행 중인 계약이 됩니다.</p>
      </div>
      <div className="sm:col-span-2">
        <Label className="text-[12px]">사유 <span className="text-slate-400">(선택)</span></Label>
        <Input
          className="mt-1 h-9" value={draft.note} disabled={disabled}
          placeholder="예: 퇴사 후 파트너 전환"
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
        />
      </div>
    </div>
  );
}

export function PeopleDirectoryPage() {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const { projects } = useAppStore();

  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | EmploymentType | 'SEPARATED'>('ALL');
  const [selected, setSelected] = useState<PersonRecord | null>(null);
  const [draft, setDraft] = useState<EmploymentDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newPerson, setNewPerson] = useState({ name: '', nickname: '', departmentTop: '', title: '' });

  const enabled = featureFlags.platformApiEnabled && !!authUser?.idToken;
  const asOf = today();

  const load = async () => {
    if (!authUser || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPersonsViaBff({ tenantId: orgId, actor: authUser });
      setPeople(response.items);
    } catch (err: any) {
      setError(err?.message || '인력 명부를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [orgId, authUser?.uid, authUser?.idToken]);

  const rows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return people
      .map((person) => {
        const current = resolveCurrentEmployment(person as unknown as Person, asOf);
        return {
          person,
          current,
          separatedAt: current ? null : resolveSeparationDate(person as unknown as Person),
          tenure: deriveTenure(person.joinedAt, asOf),
        };
      })
      .filter((row) => {
        if (typeFilter === 'SEPARATED') return !row.current;
        if (typeFilter !== 'ALL' && row.current?.type !== typeFilter) return false;
        if (!query) return true;
        return [row.person.name, row.person.nickname, row.person.departmentTop, row.person.grade]
          .some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => a.person.name.localeCompare(b.person.name, 'ko'));
  }, [people, searchText, typeFilter, asOf]);

  const counts = useMemo(() => {
    const base = { FULL_TIME: 0, INTERN: 0, PARTNER: 0, PLACEHOLDER: 0, SEPARATED: 0 };
    people.forEach((person) => {
      const current = resolveCurrentEmployment(person as unknown as Person, asOf);
      if (!current) base.SEPARATED += 1;
      else base[current.type] += 1;
    });
    return base;
  }, [people, asOf]);

  const unregistered = useMemo(
    () => findUnregisteredAssignees(projects, people),
    [projects, people],
  );

  const openPerson = (person: PersonRecord) => {
    setSelected(person);
    setDraft(emptyDraft('change'));
  };

  const submitEmployment = async () => {
    if (!authUser || !selected) return;
    setSaving(true);
    try {
      const result = await changePersonEmploymentViaBff({
        tenantId: orgId,
        actor: authUser,
        personId: selected.personId,
        mode: draft.mode,
        type: draft.type,
        state: draft.state,
        effectiveFrom: draft.effectiveFrom,
        endDate: draft.endDate || null,
        note: draft.note || undefined,
      });
      const updated = { ...selected, employments: result.employments };
      setPeople((prev) => prev.map((item) => (item.personId === updated.personId ? updated : item)));
      setSelected(updated);
      setDraft(emptyDraft('change'));
      toast.success(`${selected.name}님의 계약을 ${draft.mode === 'add' ? '추가' : '변경'}했습니다.`);
    } catch (err: any) {
      toast.error(err?.message || '계약을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const submitNewPerson = async (employment: EmploymentDraft) => {
    if (!authUser) return;
    if (!newPerson.name.trim()) { toast.error('이름을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      await createPersonViaBff({
        tenantId: orgId,
        actor: authUser,
        person: {
          name: newPerson.name.trim(),
          nickname: newPerson.nickname.trim(),
          departmentTop: newPerson.departmentTop.trim(),
          title: newPerson.title.trim(),
          employment: {
            type: employment.type,
            state: employment.state,
            effectiveFrom: employment.effectiveFrom,
            endDate: employment.endDate || null,
            note: employment.note || undefined,
          },
        },
      });
      toast.success(`${newPerson.name}님을 명부에 등록했습니다.`);
      setAddOpen(false);
      setNewPerson({ name: '', nickname: '', departmentTop: '', title: '' });
      await load();
    } catch (err: any) {
      toast.error(err?.message || '인력을 등록하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) {
    return (
      <div className="space-y-5">
        <PageHeader
          icon={Users}
          iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)"
          title="인력 명부"
          description="재직자·인턴·파트너를 한 곳에서 관리합니다"
        />
        <Card><CardContent className="py-10 text-center text-sm text-slate-600">
          인력 명부는 플랫폼 서버에 연결된 환경에서만 사용할 수 있습니다.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)"
        title="인력 명부"
        description="재직자·인턴·파트너를 한 곳에서 관리합니다. 참여율과 정산 서류가 이 명부를 근거로 삼습니다."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-8 pl-9 text-sm" placeholder="이름·별명·소속 검색…"
            value={searchText} onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        {([
          ['ALL', `전체 ${people.length}`],
          ['FULL_TIME', `정규직 ${counts.FULL_TIME}`],
          ['INTERN', `인턴 ${counts.INTERN}`],
          ['PARTNER', `파트너 ${counts.PARTNER}`],
          ['PLACEHOLDER', `미채용 ${counts.PLACEHOLDER}`],
          ['SEPARATED', `계약 종료 ${counts.SEPARATED}`],
        ] as const).map(([value, label]) => (
          <Button
            key={value} size="sm" className="h-7 px-2.5 text-xs"
            variant={typeFilter === value ? 'default' : 'outline'}
            onClick={() => setTypeFilter(value as typeof typeFilter)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> 인력 등록
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="py-4 text-sm text-rose-800">{error}</CardContent>
        </Card>
      ) : null}

      {unregistered.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="py-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  사업에 배정됐지만 명부에 없는 인력 {unregistered.length}명
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  참여율은 차지하는데 근거가 되는 계약이 없습니다. 아래에서 등록하면 계약 기간 기준으로 참여율을 판정할 수 있습니다.
                </p>
                <div className="mt-3 space-y-1.5">
                  {unregistered.map((item) => (
                    <div key={`${item.name}-${item.nickname}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-amber-900">
                        {item.name}{item.nickname ? `(${item.nickname})` : ''}
                      </span>
                      <span className="tabular-nums text-amber-800">합계 {item.totalRate}%</span>
                      <span className="text-amber-700">{item.projects.join(' · ')}</span>
                      <Button
                        size="sm" variant="outline"
                        className="h-6 gap-1 border-amber-300 bg-white px-2 text-[11px] text-amber-900"
                        onClick={() => {
                          setNewPerson({ name: item.name, nickname: item.nickname, departmentTop: '', title: '' });
                          setAddOpen(true);
                        }}
                      >
                        <Plus className="h-3 w-3" /> 명부에 등록
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="min-w-[130px]">이름</TableHead>
              <TableHead className="min-w-[110px]">근로형태</TableHead>
              <TableHead className="min-w-[90px]">재직상태</TableHead>
              <TableHead className="min-w-[150px]">소속</TableHead>
              <TableHead className="min-w-[110px]">직급</TableHead>
              <TableHead className="min-w-[100px]">입사일</TableHead>
              <TableHead className="min-w-[100px]">근속</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  {loading ? '불러오는 중…' : '조건에 맞는 인력이 없습니다.'}
                </TableCell>
              </TableRow>
            ) : rows.map(({ person, current, separatedAt, tenure }) => (
              <TableRow
                key={person.personId}
                className="cursor-pointer hover:bg-accent/40"
                onClick={() => openPerson(person)}
              >
                <TableCell>
                  <span className="text-xs font-semibold">{person.name}</span>
                  {person.nickname ? <span className="ml-1 text-[10px] text-muted-foreground">({person.nickname})</span> : null}
                </TableCell>
                <TableCell>
                  {current ? (
                    <Badge variant="outline" className={`text-[10px] ${TYPE_TONE[current.type as EmploymentType]}`}>
                      {EMPLOYMENT_TYPE_LABELS[current.type as EmploymentType]}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-500">계약 종료</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {current ? (
                    <Badge variant="outline" className={`text-[10px] ${STATE_TONE[current.state as EmploymentState]}`}>
                      {EMPLOYMENT_STATE_LABELS[current.state as EmploymentState]}
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-slate-500">{separatedAt ? `${formatDate(separatedAt)} 종료` : '-'}</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {person.departmentTop || '-'}
                  {person.departmentMid ? <span className="text-slate-400"> · {person.departmentMid}</span> : null}
                </TableCell>
                <TableCell className="text-xs">{person.grade || person.title || '-'}</TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">{formatDate(person.joinedAt)}</TableCell>
                <TableCell className="text-xs tabular-nums">{tenure?.label || '-'}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]">계약 관리</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-slate-500">
        근속은 입사일과 오늘({asOf}) 기준으로 매번 다시 계산합니다. 계약 이력은 지우지 않고 쌓습니다 —
        지난 기간의 참여율이 왜 그 기준이었는지 설명할 근거가 남아야 하기 때문입니다.
      </p>

      {/* ── 계약 관리 ── */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-[680px] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4" />
              {selected?.name}{selected?.nickname ? `(${selected.nickname})` : ''} — 계약 관리
            </DialogTitle>
            <DialogDescription>
              {selected?.departmentTop || '소속 미지정'}
              {selected?.grade ? ` · ${selected.grade}` : ''}
              {selected?.joinedAt ? ` · 입사 ${formatDate(selected.joinedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 flex-1 overflow-y-auto px-6">
            <h4 className="text-[12px] font-semibold text-slate-700">계약 이력</h4>
            <div className="mt-2 space-y-1.5">
              {(selected?.employments || []).map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-white px-3 py-2 text-xs">
                  <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                  <span className="tabular-nums text-slate-700">
                    {formatDate(item.startDate)} ~ {formatDate(item.endDate)}
                  </span>
                  <Badge variant="outline" className={`text-[10px] ${TYPE_TONE[item.type as EmploymentType]}`}>
                    {EMPLOYMENT_TYPE_LABELS[item.type as EmploymentType]}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${STATE_TONE[item.state as EmploymentState]}`}>
                    {EMPLOYMENT_STATE_LABELS[item.state as EmploymentState]}
                  </Badge>
                  {item.note ? <span className="text-slate-500">{item.note}</span> : null}
                </div>
              ))}
              {(selected?.employments || []).length === 0 ? (
                <p className="text-xs text-slate-500">등록된 계약이 없습니다.</p>
              ) : null}
            </div>

            <Separator className="my-4" />

            <div className="flex items-center gap-2">
              <Button
                size="sm" className="h-7 px-2.5 text-xs"
                variant={draft.mode === 'change' ? 'default' : 'outline'}
                onClick={() => setDraft({ ...draft, mode: 'change' })}
              >
                계약 변경
              </Button>
              <Button
                size="sm" className="h-7 px-2.5 text-xs"
                variant={draft.mode === 'add' ? 'default' : 'outline'}
                onClick={() => setDraft({ ...draft, mode: 'add' })}
              >
                계약 추가
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {draft.mode === 'change'
                ? '적용일 직전에 지금 계약을 끝내고 새 계약을 잇습니다. 정규직에서 파트너로 넘어가는 경우가 여기입니다.'
                : '기존 계약을 그대로 두고 겹치지 않는 별도 구간을 끼워 넣습니다. 공백기를 두고 다시 합류하는 경우에 씁니다.'}
            </p>

            <div className="mt-3">
              <EmploymentForm draft={draft} onChange={setDraft} disabled={saving} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)} disabled={saving}>닫기</Button>
            <Button size="sm" onClick={() => void submitEmployment()} disabled={saving}>
              {saving ? '저장 중…' : draft.mode === 'add' ? '계약 추가' : '계약 변경'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 인력 등록 ── */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) setAddOpen(false); }}>
        <DialogContent className="max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="text-base">인력 등록</DialogTitle>
            <DialogDescription>
              재직자 명단(시트)에 없는 인력을 등록합니다. 파트너·외부 인력이나 아직 채용되지 않은 자리가 여기 해당합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[12px]">이름</Label>
              <Input
                className="mt-1 h-9" value={newPerson.name} disabled={saving}
                onChange={(event) => setNewPerson({ ...newPerson, name: event.target.value })}
              />
            </div>
            <div>
              <Label className="text-[12px]">별명 <span className="text-slate-400">(선택)</span></Label>
              <Input
                className="mt-1 h-9" value={newPerson.nickname} disabled={saving}
                onChange={(event) => setNewPerson({ ...newPerson, nickname: event.target.value })}
              />
            </div>
            <div>
              <Label className="text-[12px]">소속 <span className="text-slate-400">(선택)</span></Label>
              <Input
                className="mt-1 h-9" value={newPerson.departmentTop} disabled={saving}
                onChange={(event) => setNewPerson({ ...newPerson, departmentTop: event.target.value })}
              />
            </div>
            <div>
              <Label className="text-[12px]">직책 <span className="text-slate-400">(선택)</span></Label>
              <Input
                className="mt-1 h-9" value={newPerson.title} disabled={saving}
                onChange={(event) => setNewPerson({ ...newPerson, title: event.target.value })}
              />
            </div>
          </div>

          <Separator className="my-1" />
          <p className="text-[12px] font-semibold text-slate-700">첫 계약</p>
          <EmploymentForm draft={draft} onChange={setDraft} disabled={saving} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>취소</Button>
            <Button size="sm" onClick={() => void submitNewPerson(draft)} disabled={saving}>
              {saving ? '등록 중…' : '등록'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
