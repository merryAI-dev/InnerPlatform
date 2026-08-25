import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { featureFlags } from '../../config/feature-flags';
import type { ProjectStaffing, ProjectStaffingSlot } from '../../data/types';
import { fetchPersonsViaBff, type PersonRecord } from '../../lib/platform-bff-client';
import type { ActorLike } from '../../lib/platform-bff-client';
import { Button } from '../ui/button';
import { MemberPicker } from '../ui/member-picker';
import type { OrgMemberPickerOption } from '../../data/project-team-member-options';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';

/** 미정(비워두기) 선택지의 uid. 인력 명부 personId 와 충돌하지 않는 예약값이다. */
const UNASSIGNED = '__unassigned__';
/** 정산지원 담당 후보. 운영 결정으로 고정된 두 사람이다 - 바뀌면 여기만 고친다. */
const SETTLEMENT_SUPPORT_CHOICES = ['도담', '써니'];

function personLabel(person: PersonRecord): string {
  const nickname = String(person.nickname || '').trim();
  const name = String(person.name || '').trim();
  const isPlaceholder = person.employments?.some((employment) => employment.type === 'PLACEHOLDER');
  const base = nickname && name ? `${nickname} · ${name}` : (nickname || name);
  return isPlaceholder ? `${base} (미정 자리)` : base;
}

function toSlot(people: PersonRecord[], personId: string): ProjectStaffingSlot | null {
  if (!personId || personId === UNASSIGNED) return null;
  const person = people.find((item) => item.personId === personId);
  if (!person) return null;
  return {
    personId,
    name: String(person.name || '').trim(),
    nickname: String(person.nickname || '').trim(),
  };
}

/**
 * 실제 투입인력 섹션. 참여율 시트와 독립인 책임 메타데이터를 인력 명부(persons) 기준으로
 * 지정한다. 슬롯을 비워두면 "미정" - 채용 전 자리를 허용한다.
 */
export function ProjectStaffingSection({
  orgId,
  actor,
  staffing,
  onChange,
  disabled = false,
}: {
  orgId: string;
  actor: (ActorLike & { idToken?: string }) | null;
  staffing: ProjectStaffing;
  onChange: (next: ProjectStaffing) => void;
  disabled?: boolean;
}) {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loadError, setLoadError] = useState('');
  const enabled = featureFlags.platformApiEnabled && Boolean(actor?.idToken);

  useEffect(() => {
    if (!enabled || !orgId || !actor) return;
    let cancelled = false;
    fetchPersonsViaBff({ tenantId: orgId, actor })
      .then((result) => { if (!cancelled) { setPeople(result.items); setLoadError(''); } })
      .catch(() => { if (!cancelled) setLoadError('인력 명부를 불러오지 못했습니다. 저장은 가능하고, 지정만 나중에 하면 됩니다.'); });
    return () => { cancelled = true; };
  }, [enabled, orgId, actor]);

  const options = useMemo<OrgMemberPickerOption[]>(() => {
    const rows = people.map((person) => ({
      uid: person.personId,
      name: String(person.name || ''),
      nickname: String(person.nickname || ''),
      email: '',
      label: personLabel(person),
      searchText: `${person.nickname || ''} ${person.name || ''}`.toLocaleLowerCase('ko-KR'),
    }));
    return [
      { uid: UNASSIGNED, name: '', nickname: '', email: '', label: '미정 (비워두기)', searchText: '미정' },
      ...rows,
    ];
  }, [people]);

  const patch = (partial: Partial<ProjectStaffing>) => onChange({ ...staffing, ...partial });
  // 아직 사람을 안 고른 "빈 운영매니저 줄" 수. 저장 모델(operators)에는 채워진 슬롯만 담기고,
  // 빈 줄은 화면 상태다 - 최소 한 줄은 항상 보여 준다.
  const [emptyOperatorSlots, setEmptyOperatorSlots] = useState(0);
  const operatorSlots: Array<ProjectStaffingSlot | null> = [
    ...staffing.operators,
    ...Array.from({ length: emptyOperatorSlots }, () => null),
  ];
  if (operatorSlots.length === 0) operatorSlots.push(null);

  const slotRow = (label: string, hint: string, slot: ProjectStaffingSlot | null, apply: (next: ProjectStaffingSlot | null) => void, trailing?: ReactNode) => (
    <div className="grid grid-cols-1 items-start gap-1 sm:grid-cols-[9.5rem_1fr_auto] sm:items-center sm:gap-3">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <MemberPicker
        className="max-w-sm"
        options={options}
        value={slot?.personId || ''}
        placeholder="인력 명부에서 선택 (미정 가능)"
        emptyLabel={loadError || '인력 명부를 불러오는 중입니다'}
        disabled={disabled || !enabled}
        onChange={(personId) => apply(toSlot(people, personId))}
      />
      {trailing || <span />}
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">실제 투입인력</p>
        <p className="text-xs text-slate-500">
          참여율 시트와 별개로, 이 사업의 책임 역할을 인력 명부 기준으로 지정합니다. 미정인 자리는 비워둘 수 있습니다.
        </p>
      </div>
      {loadError ? <p className="text-xs text-amber-700">{loadError}</p> : null}

      {slotRow('총괄책임자', '사업 최종 책임자', staffing.lead, (slot) => patch({ lead: slot }))}
      {slotRow('실무책임자', '실무 책임자 (PM)', staffing.pm, (slot) => patch({ pm: slot }))}

      {operatorSlots.map((slot, index) => slotRow(
        `운영매니저 ${index + 1}`,
        index === 0 ? '운영 매니저 (1인 이상)' : '추가 운영 매니저',
        slot,
        (next) => {
          const filled = [...staffing.operators];
          if (index < filled.length) {
            if (next) filled[index] = next;
            else filled.splice(index, 1);
          } else if (next) {
            filled.push(next);
            setEmptyOperatorSlots((count) => Math.max(0, count - 1));
          }
          patch({ operators: filled });
        },
        operatorSlots.length > 1 ? (
          <Button
            type="button" variant="outline" size="sm" className="h-8 px-2"
            disabled={disabled}
            onClick={() => {
              if (index < staffing.operators.length) {
                const filled = staffing.operators.filter((_, itemIndex) => itemIndex !== index);
                patch({ operators: filled });
              } else {
                setEmptyOperatorSlots((count) => Math.max(0, count - 1));
              }
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : undefined,
      ))}
      <Button
        type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
        disabled={disabled}
        onClick={() => setEmptyOperatorSlots((count) => count + 1)}
      >
        <Plus className="h-3.5 w-3.5" /> 운영매니저 추가
      </Button>

      <div className="grid grid-cols-1 items-start gap-1 sm:grid-cols-[9.5rem_1fr_auto] sm:items-center sm:gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">정산지원</p>
          <p className="text-xs text-slate-500">해당 시 도담/써니 중 선택</p>
        </div>
        <Select
          value={staffing.settlementSupport || 'NONE'}
          onValueChange={(value) => patch({ settlementSupport: value === 'NONE' ? '' : value })}
          disabled={disabled}
        >
          <SelectTrigger className="max-w-sm"><SelectValue placeholder="해당 없음" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">해당 없음</SelectItem>
            {SETTLEMENT_SUPPORT_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>{choice}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span />
      </div>
    </div>
  );
}
