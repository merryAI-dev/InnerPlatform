import {
  createSettlementSheetPolicy,
  SETTLEMENT_SHEET_POLICY_PRESET_DESCRIPTIONS,
  SETTLEMENT_SHEET_POLICY_PRESET_LABELS,
  type SettlementSheetPolicy,
  type SettlementSheetPolicyPreset,
} from '../../data/types';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';

function PolicySwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[12px]" style={{ fontWeight: 600 }}>{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function SettlementSheetPolicyFields({
  policy,
  onChange,
}: {
  policy: SettlementSheetPolicy;
  onChange: (next: SettlementSheetPolicy) => void;
}) {
  const update = <K extends keyof SettlementSheetPolicy>(key: K, value: SettlementSheetPolicy[K]) => {
    onChange({ ...policy, [key]: value });
  };

  const applyPreset = (preset: SettlementSheetPolicyPreset) => {
    onChange(createSettlementSheetPolicy(preset));
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">정산 시트 정책</Label>
        <Select value={policy.preset} onValueChange={(value) => applyPreset(value as SettlementSheetPolicyPreset)}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="정책 선택" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SETTLEMENT_SHEET_POLICY_PRESET_LABELS) as SettlementSheetPolicyPreset[]).map((preset) => (
              <SelectItem key={preset} value={preset}>
                {SETTLEMENT_SHEET_POLICY_PRESET_LABELS[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {SETTLEMENT_SHEET_POLICY_PRESET_DESCRIPTIONS[policy.preset]}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <PolicySwitchRow
          label="조정행 허용"
          description="잔액 보정이 필요한 사업이면 켜고, 고정 원장형이면 끕니다."
          checked={policy.allowAdjustmentRows}
          onCheckedChange={(checked) => update('allowAdjustmentRows', checked)}
        />
        <PolicySwitchRow
          label="행 삭제 허용"
          description="입력 실수 정정이 잦으면 켜고, 원장 보전이 더 중요하면 끕니다."
          checked={policy.allowRowDelete}
          onCheckedChange={(checked) => update('allowRowDelete', checked)}
        />
        <PolicySwitchRow
          label="통장잔액 자동 계산"
          description="입금·지출 흐름으로 통장잔액을 이어서 계산합니다."
          checked={policy.autoComputeBalance}
          onCheckedChange={(checked) => update('autoComputeBalance', checked)}
        />
        <PolicySwitchRow
          label="사업비 사용액 자동 계산"
          description="통장 입출금액이 있으면 사업비 사용액을 보조 계산합니다."
          checked={policy.autoComputeExpenseFromBank}
          onCheckedChange={(checked) => update('autoComputeExpenseFromBank', checked)}
        />
        <PolicySwitchRow
          label="통장 입출금액 자동 계산"
          description="사업비 사용액과 부가세가 있으면 통장 입출금액을 보조 계산합니다."
          checked={policy.autoComputeBankFromExpense}
          onCheckedChange={(checked) => update('autoComputeBankFromExpense', checked)}
        />
        <PolicySwitchRow
          label="거래처 입력 필수"
          description="모든 행에 지급처/거래처가 꼭 있어야 저장 가능하게 합니다."
          checked={policy.requireCounterparty}
          onCheckedChange={(checked) => update('requireCounterparty', checked)}
        />
        <PolicySwitchRow
          label="조정행 비고 필수"
          description="잔액 조정은 사유를 남겨야 저장되게 합니다."
          checked={policy.requireNoteForAdjustment}
          onCheckedChange={(checked) => update('requireNoteForAdjustment', checked)}
        />
        <PolicySwitchRow
          label="0 입력 유지"
          description="공란과 0을 다르게 취급해, 명시적으로 입력한 0을 그대로 유지합니다."
          checked={policy.preserveExplicitZero}
          onCheckedChange={(checked) => update('preserveExplicitZero', checked)}
        />
      </div>
    </div>
  );
}
