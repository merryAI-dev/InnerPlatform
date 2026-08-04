import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import type {
  ProjectInfoRebaseConflict,
  ProjectInfoRebaseResolution,
} from '../../lib/project-info-draft-client';

const FIELD_LABELS: Record<string, string> = {
  name: '프로젝트명',
  officialContractName: '공식 계약명',
  clientOrg: '계약 대상',
  department: '담당조직(CIC)',
  type: '프로젝트 유형',
  status: '프로젝트 진행 상태',
  phase: '프로젝트 구분',
  description: '프로젝트 주요 내용',
  projectPurpose: '프로젝트 목적',
  contractType: '계약서 유형',
  contractStart: '계약 시작일',
  contractEnd: '계약 종료일',
  currency: '통화',
  contractAmount: '계약금액',
  salesVatAmount: '총매출부가세',
  totalRevenueAmount: '총수익',
  totalActualCost: '총실비(원가)',
  supportAmount: '총지원금',
  financialYears: '연도별 재무',
  settlementType: '사업유형',
  basis: '정산 기준',
  accountType: '통장 유형',
  interestRefundPolicy: '이자 반납 여부',
  settlementSystem: '정산 시스템',
  laborSettlementBasis: '인건비 정산 기준',
  paymentPlan: '입금 계획',
  paymentExpectedMonths: '입금 예상월',
  advanceInterimBelow70Reason: '선금·중도금 70% 미만 사유',
  paymentPlanDesc: '입금 계획 메모',
  settlementGuide: '정산 안내',
  note: '특이사항',
  managerName: 'PM',
  executiveApproverName: '최종 결재자 (사업총괄)',
  teamName: '팀',
  teamMembersDetailed: '참여인력',
  participantCondition: '참여 조건',
  businessManagementGoogleFolderLink: '사업관리 구글폴더링크',
  groupwareName: '그룹웨어명',
};

function fieldLabel(field: string) {
  return FIELD_LABELS[field] || field;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '비어 있음';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'number') return value.toLocaleString('ko-KR');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length}개 항목`;
  return JSON.stringify(value);
}

export function ProjectInfoRebaseDialog({
  open,
  conflicts,
  autoMerged,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  conflicts: ProjectInfoRebaseConflict[];
  autoMerged: Array<{ field: string; value: unknown }>;
  busy: boolean;
  onConfirm: (resolutions: Record<string, ProjectInfoRebaseResolution>) => void;
  onCancel: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, ProjectInfoRebaseResolution>>({});

  useEffect(() => {
    if (open) setResolutions({});
  }, [open, conflicts]);

  const unresolvedCount = useMemo(
    () => conflicts.filter((conflict) => !resolutions[conflict.field]).length,
    [conflicts, resolutions],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>수정하는 동안 프로젝트가 변경되었습니다</DialogTitle>
          <DialogDescription>
            {conflicts.length > 0
              ? '아래 항목은 내가 수정한 값과 최신 프로젝트 값이 서로 다릅니다. 어느 값을 남길지 선택해 주세요.'
              : '변경된 내용은 모두 자동으로 반영할 수 있습니다. 확인 후 계속 진행해 주세요.'}
          </DialogDescription>
        </DialogHeader>

        {autoMerged.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-700">
            <p className="font-medium">자동으로 반영되는 항목 {autoMerged.length}건</p>
            <p className="mt-1 text-[11px] text-slate-500">
              내가 수정하지 않은 항목이라 최신 값을 그대로 가져옵니다.
            </p>
            <ul className="mt-2 grid gap-1">
              {autoMerged.map((entry) => (
                <li key={entry.field}>
                  {fieldLabel(entry.field)} · {displayValue(entry.value)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="max-h-[46vh] space-y-3 overflow-y-auto">
            {conflicts.map((conflict) => (
              <div key={conflict.field} className="rounded-lg border border-slate-200 px-4 py-3">
                <p className="text-[12px] font-medium text-slate-900">{fieldLabel(conflict.field)}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  수정 시작 시점: {displayValue(conflict.base)}
                </p>
                <RadioGroup
                  className="mt-2 grid gap-2"
                  value={resolutions[conflict.field] || ''}
                  onValueChange={(value) => setResolutions((previous) => ({
                    ...previous,
                    [conflict.field]: value as ProjectInfoRebaseResolution,
                  }))}
                >
                  <label className="flex items-start gap-2 text-[12px] text-slate-700">
                    <RadioGroupItem value="MINE" className="mt-0.5" />
                    <span>내가 입력한 값 · <strong>{displayValue(conflict.mine)}</strong></span>
                  </label>
                  <label className="flex items-start gap-2 text-[12px] text-slate-700">
                    <RadioGroupItem value="THEIRS" className="mt-0.5" />
                    <span>최신 프로젝트 값 · <strong>{displayValue(conflict.theirs)}</strong></span>
                  </label>
                </RadioGroup>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(resolutions)}
            disabled={busy || unresolvedCount > 0}
          >
            {busy
              ? '반영 중...'
              : unresolvedCount > 0
                ? `${unresolvedCount}건 선택 필요`
                : '선택한 내용으로 계속'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
