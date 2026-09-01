import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Loader2, Plus, Save, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { useOrganizationSettings } from '../../data/use-organization-settings';
import { usePersonGradeSettings } from '../../data/use-person-grade-settings';
import {
  activeGradeLabels,
  formatGradeOptionLabel,
  type PersonGradeOption,
} from '../../data/person-grade-settings';
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

type RosterField = 'departmentTop' | 'departmentMid' | 'grade';

const FIELD_LABELS: Record<RosterField, string> = {
  departmentTop: '대분류',
  departmentMid: '중분류',
  grade: '직급',
};

interface RenamePlan {
  before: string;
  after: string;
  people: PersonRecord[];
  field: RosterField;
}

function countUsage(people: PersonRecord[], field: RosterField, label: string) {
  return people.filter((person) => String(person[field] || '').trim() === label).length;
}

export function OrganizationSettingsTab() {
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { groups, isLoading, error, saveGroups } = useOrganizationSettings();
  const { grades, saveGrades } = usePersonGradeSettings();
  const [draft, setDraft] = useState<OrganizationGroup[] | null>(null);
  const [gradeDraft, setGradeDraft] = useState<PersonGradeOption[] | null>(null);
  const [savingGrades, setSavingGrades] = useState(false);
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
      ? { ...group, teams: [...group.teams, { id: `team-${Date.now()}`, label: '새 중분류', sortOrder: group.teams.length, active: true }] }
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
      toast.success(`${moved}명의 ${FIELD_LABELS[renamePlan.field]}을 "${renamePlan.after}"로 바꿨습니다.`);
    } catch {
      toast.error(`${moved}명까지 옮기고 멈췄습니다. 남은 인원은 다시 시도해 주세요.`);
    } finally {
      setRenaming(false);
      setRenamePlan(null);
    }
  };

  const staleLabelsFor = (field: RosterField, known: string[]) => {
    const used = new Map<string, number>();
    for (const person of people) {
      const value = String(person[field] || '').trim();
      if (!value || known.includes(value)) continue;
      used.set(value, (used.get(value) || 0) + 1);
    }
    return [...used.entries()].sort((left, right) => right[1] - left[1]);
  };

  const gradeRows = gradeDraft ?? grades;
  const gradesDirty = gradeDraft !== null && JSON.stringify(gradeDraft) !== JSON.stringify(grades);

  const saveGradeList = async () => {
    if (!gradeDraft) return;
    setSavingGrades(true);
    try {
      await saveGrades(gradeDraft, user?.uid);
      setGradeDraft(null);
      toast.success('직급 목록을 저장했습니다.');
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : '직급 목록을 저장하지 못했습니다.');
    } finally {
      setSavingGrades(false);
    }
  };

  const knownGroupLabels = rows.map((group) => group.label);
  const knownTeamLabels = rows.flatMap((group) => group.teams.map((team) => team.label));
  const knownGradeLabels = gradeRows.map((grade) => grade.label);
  const staleGroups = staleLabelsFor('departmentTop', knownGroupLabels);
  const staleTeams = staleLabelsFor('departmentMid', knownTeamLabels);
  const staleGrades = staleLabelsFor('grade', knownGradeLabels);
  const mismatchCount = [...staleGroups, ...staleTeams, ...staleGrades]
    .reduce((total, [, count]) => total + count, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">조직 목록</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            인력 명부의 대분류·중분류(센터·실·CIC) 선택지입니다. 지우는 대신 숨기면 그 조직을 쓰던 사람의 소속이 그대로 남습니다.
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
                  aria-label={`${group.label} 중분류 ${open ? '접기' : '펼치기'}`} aria-expanded={open}
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
                  <Plus className="h-3 w-3" /> 중분류 추가
                </Button>
              </div>

              {open ? (
                <div className="mt-2 space-y-1.5 pl-8">
                  {group.teams.length === 0 ? (
                    <p className="text-[11px] text-slate-400">등록된 중분류가 없습니다.</p>
                  ) : group.teams.map((team, teamIndex) => (
                    <div key={team.id} className="flex flex-wrap items-center gap-2">
                      <Input
                        className="h-8 w-56 text-[13px]" value={team.label} disabled={saving}
                        aria-label={`${group.label} 중분류 ${teamIndex + 1} 이름`}
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

      {/* ── 직급 목록 ── */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[12px] font-semibold text-slate-800">직급 목록</h4>
            <p className="mt-0.5 text-[11px] text-slate-500">
              직책(팀장·센터장)과 다른 축입니다. 경영기획실(재경)·사내벤처는 별도 체계를 쓰므로 목록 밖 값도 저장됩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm" disabled={savingGrades}
              onClick={() => setGradeDraft([...gradeRows, {
                id: `grade-${Date.now()}`, label: '새 직급', sortOrder: gradeRows.length, active: true, equivalentTitles: [],
              }])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 직급 추가
            </Button>
            <Button size="sm" onClick={() => void saveGradeList()} disabled={!gradesDirty || savingGrades}>
              {savingGrades ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {savingGrades ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
        <div className="mt-2 space-y-1.5">
          {gradeRows.map((grade, gradeIndex) => (
            <div key={grade.id} className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-48 text-[13px]" value={grade.label} disabled={savingGrades}
                aria-label={`직급 ${gradeIndex + 1} 이름`}
                onChange={(event) => setGradeDraft(gradeRows.map((item, index) => (
                  index === gradeIndex ? { ...item, label: event.target.value } : item
                )))}
              />
              {grade.equivalentTitles.length > 0 ? (
                <span className="text-[11px] text-slate-500">({grade.equivalentTitles.join('·')})</span>
              ) : null}
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Users className="h-3 w-3" /> {countUsage(people, 'grade', grade.label)}명
              </Badge>
              {!grade.active ? <Badge variant="secondary" className="text-[10px]">숨김</Badge> : null}
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-500"
                disabled={savingGrades}
                onClick={() => setGradeDraft(gradeRows.map((item, index) => (
                  index === gradeIndex ? { ...item, active: !item.active } : item
                )))}
              >
                <EyeOff className="h-3 w-3" /> {grade.active ? '숨기기' : '다시 표시'}
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ── 지금 목록과 어긋난 값들. 개편·오타의 흔적이라 여기서 정리한다. ── */}
      {mismatchCount > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="flex items-center gap-2 text-[12px] font-semibold text-slate-800">
            목록에 없는 값을 쓰는 사람
            <Badge variant="outline" className="text-[10px]">{mismatchCount}명</Badge>
          </h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            표기가 갈렸거나 예전 값입니다. 옮길 곳을 고르면 그 사람들의 값을 함께 바꿉니다.
            별도 체계를 쓰는 값이라면 위 목록에 추가해 두면 더 이상 어긋난 것으로 보이지 않습니다.
          </p>
          <div className="mt-2 space-y-1.5">
            {[
              ...staleGroups.map(([label, count]) => ({ label, count, field: 'departmentTop' as RosterField, options: knownGroupLabels })),
              ...staleTeams.map(([label, count]) => ({ label, count, field: 'departmentMid' as RosterField, options: knownTeamLabels })),
              ...staleGrades.map(([label, count]) => ({ label, count, field: 'grade' as RosterField, options: knownGradeLabels })),
            ].map(({ label, count, field, options }) => (
              <StaleRow
                key={`${field}-${label}`} label={label} count={count} field={field}
                options={options} disabled={renaming}
                onMove={(after) => setRenamePlan({
                  before: label, after, field,
                  people: people.filter((person) => String(person[field] || '').trim() === label),
                })}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-[11px] text-slate-500">모든 인력의 대분류·중분류·직급이 지금 목록과 맞습니다.</p>
      )}

      <AlertDialog open={renamePlan !== null} onOpenChange={(open) => { if (!open && !renaming) setRenamePlan(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {renamePlan?.people.length}명의 {renamePlan ? FIELD_LABELS[renamePlan.field] : ''}을 바꿀까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{renamePlan?.before}&quot; → &quot;{renamePlan?.after}&quot; 로 바꿉니다.
              인력 명부에 각각 기록으로 남고, 되돌리려면 같은 방법으로 다시 바꿔야 합니다.
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
  label, count, field, options, disabled, onMove,
}: {
  label: string;
  count: number;
  field: RosterField;
  options: string[];
  disabled: boolean;
  onMove: (after: string) => void;
}) {
  const [target, setTarget] = useState('');
  const choices = optionsWithCurrentValue(options, '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" className="text-[10px]">{FIELD_LABELS[field]}</Badge>
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
