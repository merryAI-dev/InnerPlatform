import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Loader2, Plus, Save, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { useOrganizationSettings } from '../../data/use-organization-settings';
import {
  optionsWithCurrentValue,
  type OrganizationGroup,
} from '../../data/organization-settings';
import {
  fetchPersonsViaBff,
  updatePersonProfileViaBff,
  type PersonRecord,
} from '../../lib/platform-bff-client';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';

/**
 * 조직 목록 편집.
 *
 * 조직 개편은 배포와 무관하게 일어난다. 그래서 목록은 관리자가 여기서 고친다.
 *
 * 두 가지를 지킨다.
 * - **지우지 않고 비활성화한다.** 쓰이던 이름이 목록에서 사라지면 그 조직 사람들의 소속이
 *   화면에서 뜻을 잃는다.
 * - **이름을 바꿔도 저장된 데이터는 자동으로 따라가지 않는다.** 대신 몇 명이 옛 이름을 쓰는지
 *   보여 주고, 관리자가 '함께 옮기기'를 고를 때만 옮긴다.
 */

interface RenamePlan {
  before: string;
  after: string;
  people: PersonRecord[];
  field: 'departmentTop' | 'departmentMid';
}

function countUsage(people: PersonRecord[], field: 'departmentTop' | 'departmentMid', label: string) {
  return people.filter((person) => String(person[field] || '').trim() === label).length;
}

export function OrganizationSettingsTab() {
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { groups, isLoading, error, saveGroups } = useOrganizationSettings();
  const [draft, setDraft] = useState<OrganizationGroup[] | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [renamePlan, setRenamePlan] = useState<RenamePlan | null>(null);
  const [renaming, setRenaming] = useState(false);

  const rows = draft ?? groups;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(groups);

  useMemo(() => {
    if (peopleLoaded || !user?.uid) return;
    setPeopleLoaded(true);
    void fetchPersonsViaBff({ tenantId: orgId, actor: user })
      .then((response) => setPeople(response.items))
      .catch(() => { /* 사용 인원 수는 참고 정보다. 못 읽어도 편집은 막지 않는다. */ });
  }, [orgId, user, peopleLoaded]);

  const update = (next: OrganizationGroup[]) => setDraft(next);

  const renameGroup = (groupIndex: number, label: string) => {
    update(rows.map((group, index) => (index === groupIndex ? { ...group, label } : group)));
  };
  const renameTeam = (groupIndex: number, teamIndex: number, label: string) => {
    update(rows.map((group, index) => (index === groupIndex
      ? { ...group, teams: group.teams.map((team, tIndex) => (tIndex === teamIndex ? { ...team, label } : team)) }
      : group)));
  };
  const toggleGroupActive = (groupIndex: number) => {
    update(rows.map((group, index) => (index === groupIndex ? { ...group, active: !group.active } : group)));
  };
  const toggleTeamActive = (groupIndex: number, teamIndex: number) => {
    update(rows.map((group, index) => (index === groupIndex
      ? { ...group, teams: group.teams.map((team, tIndex) => (tIndex === teamIndex ? { ...team, active: !team.active } : team)) }
      : group)));
  };
  const addGroup = () => {
    update([...rows, { id: `group-${Date.now()}`, label: '새 조직', sortOrder: rows.length, active: true, teams: [] }]);
  };
  const addTeam = (groupIndex: number) => {
    update(rows.map((group, index) => (index === groupIndex
      ? { ...group, teams: [...group.teams, { id: `team-${Date.now()}`, label: '새 팀', sortOrder: group.teams.length, active: true }] }
      : group)));
    setExpanded((current) => new Set(current).add(rows[groupIndex].id));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveGroups(draft, user?.uid);
      setDraft(null);
      toast.success('조직 목록을 저장했습니다.');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '조직 목록을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  /** 옛 이름을 쓰던 사람들을 새 이름으로 옮긴다. 목록 저장과 별개 동작이라 따로 묻는다. */
  const applyRename = async () => {
    if (!renamePlan || !user) return;
    setRenaming(true);
    let moved = 0;
    try {
      for (const person of renamePlan.people) {
        await updatePersonProfileViaBff({
          tenantId: orgId,
          actor: user,
          personId: person.personId,
          profile: { [renamePlan.field]: renamePlan.after },
        });
        moved += 1;
      }
      const refreshed = await fetchPersonsViaBff({ tenantId: orgId, actor: user });
      setPeople(refreshed.items);
      toast.success(`${moved}명의 소속을 "${renamePlan.after}"로 옮겼습니다.`);
    } catch {
      toast.error(`${moved}명까지 옮기고 멈췄습니다. 남은 인원은 다시 시도해 주세요.`);
    } finally {
      setRenaming(false);
      setRenamePlan(null);
    }
  };

  const staleLabelsFor = (field: 'departmentTop' | 'departmentMid', known: string[]) => {
    const used = new Map<string, number>();
    for (const person of people) {
      const value = String(person[field] || '').trim();
      if (!value || known.includes(value)) continue;
      used.set(value, (used.get(value) || 0) + 1);
    }
    return [...used.entries()].sort((left, right) => right[1] - left[1]);
  };

  const knownGroupLabels = rows.map((group) => group.label);
  const knownTeamLabels = rows.flatMap((group) => group.teams.map((team) => team.label));
  const staleGroups = staleLabelsFor('departmentTop', knownGroupLabels);
  const staleTeams = staleLabelsFor('departmentMid', knownTeamLabels);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">조직 목록</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            인력 명부의 소속·팀 선택지입니다. 지우는 대신 숨기면 그 조직을 쓰던 사람의 소속이 그대로 남습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addGroup} disabled={saving}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 조직 추가
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-rose-700" role="alert">{error}</p> : null}
      {isLoading ? <p className="text-xs text-slate-500">조직 목록을 불러오는 중…</p> : null}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((group, groupIndex) => {
          const open = expanded.has(group.id);
          const groupUsage = countUsage(people, 'departmentTop', group.label);
          return (
            <div key={group.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button" className="text-slate-400 hover:text-slate-700"
                  aria-label={`${group.label} 팀 ${open ? '접기' : '펼치기'}`} aria-expanded={open}
                  onClick={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                    return next;
                  })}
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <Input
                  className="h-8 w-56 text-[13px]" value={group.label} disabled={saving}
                  aria-label={`조직 ${groupIndex + 1} 이름`}
                  onChange={(event) => renameGroup(groupIndex, event.target.value)}
                />
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Users className="h-3 w-3" /> {groupUsage}명
                </Badge>
                {!group.active ? <Badge variant="secondary" className="text-[10px]">숨김</Badge> : null}
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
                  disabled={saving} onClick={() => toggleGroupActive(groupIndex)}
                >
                  <EyeOff className="h-3 w-3" /> {group.active ? '숨기기' : '다시 표시'}
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]"
                  disabled={saving} onClick={() => addTeam(groupIndex)}
                >
                  <Plus className="h-3 w-3" /> 팀 추가
                </Button>
              </div>

              {open ? (
                <div className="mt-2 space-y-1.5 pl-8">
                  {group.teams.length === 0 ? (
                    <p className="text-[11px] text-slate-400">등록된 팀이 없습니다.</p>
                  ) : group.teams.map((team, teamIndex) => (
                    <div key={team.id} className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-8 w-56 text-[13px]" value={team.label} disabled={saving}
                        aria-label={`${group.label} 팀 ${teamIndex + 1} 이름`}
                        onChange={(event) => renameTeam(groupIndex, teamIndex, event.target.value)}
                      />
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Users className="h-3 w-3" /> {countUsage(people, 'departmentMid', team.label)}명
                      </Badge>
                      {!team.active ? <Badge variant="secondary" className="text-[10px]">숨김</Badge> : null}
                      <Button
                        variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
                        disabled={saving} onClick={() => toggleTeamActive(groupIndex, teamIndex)}
                      >
                        <EyeOff className="h-3 w-3" /> {team.active ? '숨기기' : '다시 표시'}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* 목록에 없는 이름을 쓰는 사람들. 개편·오타의 흔적이라 여기서 정리한다. */}
      {staleGroups.length > 0 || staleTeams.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="text-[12px] font-semibold text-slate-800">목록에 없는 소속을 쓰는 사람</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            표기가 갈렸거나 예전 조직입니다. 옮길 곳을 고르면 그 사람들의 소속을 함께 바꿉니다.
          </p>
          <div className="mt-2 space-y-1.5">
            {staleGroups.map(([label, count]) => (
              <StaleRow
                key={`top-${label}`} label={label} count={count} field="departmentTop"
                options={knownGroupLabels} disabled={renaming}
                onMove={(after) => setRenamePlan({
                  before: label, after, field: 'departmentTop',
                  people: people.filter((person) => String(person.departmentTop || '').trim() === label),
                })}
              />
            ))}
            {staleTeams.map(([label, count]) => (
              <StaleRow
                key={`mid-${label}`} label={label} count={count} field="departmentMid"
                options={knownTeamLabels} disabled={renaming}
                onMove={(after) => setRenamePlan({
                  before: label, after, field: 'departmentMid',
                  people: people.filter((person) => String(person.departmentMid || '').trim() === label),
                })}
              />
            ))}
          </div>
        </section>
      ) : null}

      <AlertDialog open={renamePlan !== null} onOpenChange={(open) => { if (!open && !renaming) setRenamePlan(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {renamePlan?.people.length}명의 소속을 옮길까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{renamePlan?.before}&quot; → &quot;{renamePlan?.after}&quot; 로 바꿉니다.
              인력 명부에 각각 기록으로 남고, 되돌리려면 같은 방법으로 다시 옮겨야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renaming}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void applyRename(); }} disabled={renaming}>
              {renaming ? '옮기는 중…' : '함께 옮기기'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StaleRow({
  label, count, options, disabled, onMove,
}: {
  label: string;
  count: number;
  field: 'departmentTop' | 'departmentMid';
  options: string[];
  disabled: boolean;
  onMove: (after: string) => void;
}) {
  const [target, setTarget] = useState('');
  const choices = optionsWithCurrentValue(options, '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-slate-800">{label}</span>
      <Badge variant="outline" className="gap-1 text-[10px]"><Users className="h-3 w-3" /> {count}명</Badge>
      <Label className="sr-only" htmlFor={`move-${label}`}>{label} 옮길 조직</Label>
      <select
        id={`move-${label}`}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-[12px]"
        value={target} disabled={disabled}
        onChange={(event) => setTarget(event.target.value)}
      >
        <option value="">옮길 곳 선택</option>
        {choices.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <Button
        variant="outline" size="sm" className="h-8 text-[11px]"
        disabled={disabled || !target} onClick={() => onMove(target)}
      >
        함께 옮기기
      </Button>
    </div>
  );
}
