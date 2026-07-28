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
    return `${year.slice(-2)}-${Number(month)}-${issue.weekNo}`;
  }
  return issue.year ? `${issue.year}년` : '연간 합계';
}

function amount(value: number | null): string {
  return value == null ? '미입력' : `${value.toLocaleString('ko-KR')}원`;
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
          <AlertDialogTitle>시트 합계 수식이 다릅니다</AlertDialogTitle>
          <AlertDialogDescription className="leading-5">
            {first
              ? `${periodLabel(first)} ${first.mode === 'projection' ? 'Projection' : 'Actual'}의 ${fieldLabels[first.field]}가 시트 행 금액의 합과 다릅니다.`
              : ''}
            {' '}시트의 합계 수식을 고친 뒤 다시 불러오는 것을 권장합니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-slate-800">
          {issues.slice(0, 5).map((issue, index) => (
            <div key={`${issue.year || issue.yearMonth}:${issue.mode}:${issue.weekNo || 0}:${issue.field}:${index}`}>
              <div className="font-semibold">
                {periodLabel(issue)} · {issue.mode === 'projection' ? 'Projection' : 'Actual'} · {fieldLabels[issue.field]}
              </div>
              <div className="text-slate-600">
                시트 {amount(issue.reported)} · 다시 계산 {amount(issue.calculated)}
                {issue.sourceCell ? ` · ${issue.sourceCell} 셀` : ''}
              </div>
            </div>
          ))}
          {issues.length > 5 && <div className="font-semibold">외 {issues.length - 5}건</div>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>취소</AlertDialogCancel>
          <Button type="button" className="bg-[#17324D] hover:bg-slate-800" disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            그래도 현재 시트값 반영
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
