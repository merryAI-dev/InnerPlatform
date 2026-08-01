import { Loader2 } from 'lucide-react';
import type { CashflowFormulaMismatch } from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

const fieldLabels: Record<CashflowFormulaMismatch['field'], string> = {
  depositTotal: '입금 합계',
  withdrawalTotal: '출금 합계',
  balance: '잔액',
};

function periodLabel(issue: CashflowFormulaMismatch): string {
  if (issue.yearMonth && issue.weekNo) {
    const [year, month] = issue.yearMonth.split('-');
    return `${year}년 ${Number(month)}월 ${issue.weekNo}주차`;
  }
  return issue.year ? `${issue.year}년` : '연간 합계';
}

function amount(value: number | null): string {
  return value == null ? '미입력' : `${value.toLocaleString('ko-KR')}원`;
}

function expectedCalculation(issue: CashflowFormulaMismatch): string {
  if (issue.field === 'depositTotal') {
    return '해당 기간의 입금 항목을 모두 더한 값';
  }
  if (issue.field === 'withdrawalTotal') {
    return '해당 기간의 출금 항목을 모두 더한 값';
  }

  if (issue.year === 2024) {
    return '해당 기간의 입금 합계에서 출금 합계를 뺀 값';
  }
  return '직전 기간의 잔액에 이번 기간 입금 합계를 더하고 출금 합계를 뺀 값';
}

export function describeCashflowFormulaMismatch(issue: CashflowFormulaMismatch): {
  expected: string;
  current: string;
} {
  const cell = issue.sourceCell ? `${issue.sourceCell} 셀` : '이 칸';
  return {
    expected: `${cell}은 ${expectedCalculation(issue)}입니다. 시트에는 ${amount(issue.calculated)}이 표시되어야 합니다.`,
    current: issue.reported == null
      ? '현재 시트에는 이 값이 비어 있습니다.'
      : `현재 시트에는 ${amount(issue.reported)}이 표시되어 있습니다.`,
  };
}

export function CashflowFormulaMismatchDialog({
  issues,
  busy,
  onCancel,
  onConfirm,
}: {
  issues: CashflowFormulaMismatch[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const first = issues[0];
  return (
    <AlertDialog open={issues.length > 0}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-[520px]">
        <AlertDialogHeader>
          <AlertDialogTitle>시트 계산값을 확인해 주세요</AlertDialogTitle>
          <AlertDialogDescription className="leading-5">
            {first
              ? `${periodLabel(first)} ${first.mode === 'projection' ? 'Projection' : 'Actual'}의 ${fieldLabels[first.field]}가 공식 시트 양식의 계산 결과와 다릅니다.`
              : ''}
            {' '}아래 계산대로 시트를 고친 뒤 다시 불러오는 것을 권장합니다. 계속하면 시트의 원천 항목값을 가져오고, 입금 합계·출금 합계·잔액은 플랫폼 계산값으로 반영합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-slate-800">
          {issues.map((issue, index) => {
            const description = describeCashflowFormulaMismatch(issue);
            return (
            <div key={`${issue.year || issue.yearMonth}:${issue.mode}:${issue.weekNo || 0}:${issue.field}:${index}`}>
              <div className="font-semibold">{periodLabel(issue)} · {issue.mode === 'projection' ? 'Projection' : 'Actual'} · {fieldLabels[issue.field]}</div>
              <div className="mt-1 text-slate-700">{description.expected}</div>
              <div className="text-slate-600">{description.current}</div>
            </div>
            );
          })}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>취소</AlertDialogCancel>
          <Button type="button" className="bg-[#17324D] hover:bg-slate-800" disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            차이를 확인하고 원천값 반영
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
