import { useCallback, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Copy, ArrowRight } from 'lucide-react';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import {
  CASHFLOW_SHEET_LINE_LABELS,
  type CashflowSheetLineId,
  type CashflowWeekSheet,
} from '../../data/types';
import { getMonthMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { getSeoulTodayIso } from '../../platform/business-days';

// ── Constants ──

const IN_LINES: CashflowSheetLineId[] = [
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
];

const OUT_LINES: CashflowSheetLineId[] = [
  'DIRECT_COST_OUT',
  'INPUT_VAT_OUT',
  'MYSC_LABOR_OUT',
  'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT',
  'BANK_INTEREST_OUT',
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── Helpers ──

function getCurrentWeek(): { yearMonth: string; weekNo: number; week: MonthMondayWeek } | null {
  const today = getSeoulTodayIso();
  const ym = today.slice(0, 7);
  const weeks = getMonthMondayWeeks(ym);
  const todayStr = today.slice(0, 10);

  for (const w of weeks) {
    if (todayStr >= w.weekStart && todayStr <= w.weekEnd) {
      return { yearMonth: ym, weekNo: w.weekNo, week: w };
    }
  }

  // Fallback: last week of the month
  if (weeks.length > 0) {
    const last = weeks[weeks.length - 1];
    return { yearMonth: ym, weekNo: last.weekNo, week: last };
  }

  return null;
}

function hasProjectionData(sheet: CashflowWeekSheet | undefined): boolean {
  if (!sheet?.projection) return false;
  return Object.values(sheet.projection).some((v) => typeof v === 'number' && v !== 0);
}

// ── Component ──

interface ProjectionGateProps {
  projectId: string;
  children: React.ReactNode;
}

export function ProjectionGate({ projectId, children }: ProjectionGateProps) {
  const { weeks, upsertWeekAmounts } = useCashflowWeeks();
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentWeekInfo = useMemo(() => getCurrentWeek(), []);

  // Find existing sheet for this week
  const currentSheet = useMemo(() => {
    if (!currentWeekInfo) return undefined;
    return weeks.find(
      (w) =>
        w.projectId === projectId &&
        w.yearMonth === currentWeekInfo.yearMonth &&
        w.weekNo === currentWeekInfo.weekNo,
    );
  }, [weeks, projectId, currentWeekInfo]);

  // Find previous week's sheet (for "copy" feature)
  const prevSheet = useMemo(() => {
    if (!currentWeekInfo) return undefined;
    const { yearMonth, weekNo } = currentWeekInfo;
    // Try previous weekNo first
    if (weekNo > 1) {
      return weeks.find(
        (w) => w.projectId === projectId && w.yearMonth === yearMonth && w.weekNo === weekNo - 1,
      );
    }
    // If weekNo is 1, look at last week of previous month
    const [yyyy, mm] = yearMonth.split('-').map(Number);
    const prevMonth = mm === 1 ? 12 : mm - 1;
    const prevYear = mm === 1 ? yyyy - 1 : yyyy;
    const prevYm = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    const prevWeeks = getMonthMondayWeeks(prevYm);
    if (prevWeeks.length === 0) return undefined;
    const lastWeekNo = prevWeeks[prevWeeks.length - 1].weekNo;
    return weeks.find(
      (w) => w.projectId === projectId && w.yearMonth === prevYm && w.weekNo === lastWeekNo,
    );
  }, [weeks, projectId, currentWeekInfo]);

  // Local amounts state
  const [amounts, setAmounts] = useState<Partial<Record<CashflowSheetLineId, number>>>(() => {
    if (currentSheet?.projection) return { ...currentSheet.projection };
    return {};
  });

  // Auto-skip if projection already exists
  const alreadyHasProjection = hasProjectionData(currentSheet);
  if (alreadyHasProjection || confirmed) {
    return <>{children}</>;
  }

  if (!currentWeekInfo) {
    return <>{children}</>;
  }

  const { week } = currentWeekInfo;

  const handleAmountChange = (lineId: CashflowSheetLineId, value: string) => {
    const num = parseInt(value.replace(/[^0-9-]/g, ''), 10);
    setAmounts((prev) => ({
      ...prev,
      [lineId]: Number.isFinite(num) ? num : 0,
    }));
  };

  const handleCopyPrev = () => {
    if (!prevSheet?.projection) return;
    setAmounts({ ...prevSheet.projection });
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await upsertWeekAmounts({
        projectId,
        yearMonth: currentWeekInfo.yearMonth,
        weekNo: currentWeekInfo.weekNo,
        mode: 'projection',
        amounts,
      });
      setConfirmed(true);
    } catch (err) {
      console.error('[ProjectionGate] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const inTotal = IN_LINES.reduce((sum, id) => sum + (amounts[id] || 0), 0);
  const outTotal = OUT_LINES.reduce((sum, id) => sum + (amounts[id] || 0), 0);

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="border rounded-xl p-5 space-y-4 bg-card">
        <div className="space-y-1">
          <h3 className="text-sm font-bold">이번 주 예상 캐시플로 확인</h3>
          <p className="text-[11px] text-muted-foreground">
            {week.label} ({week.weekStart} ~ {week.weekEnd})
          </p>
          <p className="text-[10px] text-muted-foreground">
            사업비 입력 전, 이번 주 예상 입출금을 확인해 주세요.
          </p>
        </div>

        {/* IN lines */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-[9px] h-4 px-1.5 bg-blue-500">입금</Badge>
            <span className="text-[10px] text-muted-foreground ml-auto">
              소계: {fmt(inTotal)}원
            </span>
          </div>
          {IN_LINES.map((lineId) => (
            <LineInput
              key={lineId}
              lineId={lineId}
              value={amounts[lineId] || 0}
              onChange={(val) => handleAmountChange(lineId, val)}
            />
          ))}
        </div>

        {/* OUT lines */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="text-[9px] h-4 px-1.5">출금</Badge>
            <span className="text-[10px] text-muted-foreground ml-auto">
              소계: {fmt(outTotal)}원
            </span>
          </div>
          {OUT_LINES.map((lineId) => (
            <LineInput
              key={lineId}
              lineId={lineId}
              value={amounts[lineId] || 0}
              onChange={(val) => handleAmountChange(lineId, val)}
            />
          ))}
        </div>

        {/* Net */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-[11px] font-semibold">순 캐시플로</span>
          <span className={`text-sm font-bold tabular-nums ${inTotal - outTotal >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            {fmt(inTotal - outTotal)}원
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyPrev}
            disabled={!prevSheet?.projection}
            className="text-[11px]"
          >
            <Copy className="h-3.5 w-3.5 mr-1" />
            지난 주 복사
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmed(true)}
            className="text-[11px]"
          >
            건너뛰기
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={saving}
            className="text-[11px]"
          >
            {saving ? '저장 중...' : '확인하고 사업비 입력으로'}
            {!saving && <ArrowRight className="h-3.5 w-3.5 ml-1" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Line Input ──

function LineInput({
  lineId,
  value,
  onChange,
}: {
  lineId: CashflowSheetLineId;
  value: number;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-foreground min-w-[160px] truncate">
        {CASHFLOW_SHEET_LINE_LABELS[lineId]}
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value === 0 ? '' : fmt(value)}
        placeholder="0"
        className="flex-1 h-7 rounded-md border bg-background px-2 text-right text-[11px] tabular-nums outline-none focus:ring-1 focus:ring-ring"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
