import { TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import type { Transaction } from '../../data/types';
import { fmt } from '../../platform/settlement-grid-helpers';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface ProjectBudgetSummary {
  projectId: string;
  projectName: string;
  budgetTotal: number;
  spent: number;
}

interface FinanceDashboardProps {
  transactions: Transaction[];
  projectBudgets: ProjectBudgetSummary[];
  yearMonth?: string;
}

export function FinanceDashboard({ transactions, projectBudgets, yearMonth }: FinanceDashboardProps) {
  const label = yearMonth || new Date().toISOString().slice(0, 7);

  const monthTx = useMemo(
    () => transactions.filter((tx) => tx.dateTime?.startsWith(label)),
    [transactions, label],
  );

  const totalIncome = useMemo(
    () => monthTx.reduce((sum, tx) => sum + (tx.amounts?.depositAmount || 0), 0),
    [monthTx],
  );

  const totalExpense = useMemo(
    () => monthTx.reduce((sum, tx) => sum + (tx.amounts?.expenseAmount || 0), 0),
    [monthTx],
  );

  const net = totalIncome - totalExpense;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold">재무 현황 ({label})</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              수입
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{fmt(totalIncome)}원</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-red-500" />
              지출
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{fmt(totalExpense)}원</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-4 w-4 text-blue-500" />
              순이익
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(net)}원
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-3">프로젝트별 예산 소진율</h3>
        <div className="space-y-3">
          {projectBudgets.map((pb) => {
            const pct = pb.budgetTotal > 0 ? Math.round((pb.spent / pb.budgetTotal) * 100) : 0;
            const isOver = pct > 100;
            return (
              <div key={pb.projectId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate max-w-[60%]">{pb.projectName}</span>
                  <span className={`text-xs ${isOver ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}>
                    {fmt(pb.spent)} / {fmt(pb.budgetTotal)}원 ({pct}%)
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isOver ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {projectBudgets.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">예산 데이터가 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}
