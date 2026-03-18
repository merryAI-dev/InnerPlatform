import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import type { HrLeave } from '../../data/hr-types';
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS } from '../../data/hr-types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

const STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

interface PortalHrLeavePageProps {
  leaves: HrLeave[];
  remainingAnnual: number;
  onRequestLeave: () => void;
}

export function PortalHrLeavePage({ leaves, remainingAnnual, onRequestLeave }: PortalHrLeavePageProps) {
  const [year] = useState(new Date().getFullYear());
  const yearLeaves = leaves.filter((l) => l.startDate.startsWith(String(year)));

  const usedDays = yearLeaves
    .filter((l) => l.status === 'APPROVED')
    .reduce((sum, l) => sum + l.days, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">연차 관리</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {year}년 잔여 연차: <span className="font-bold text-foreground">{remainingAnnual}일</span> (사용 {usedDays}일)
          </p>
        </div>
        <Button size="sm" onClick={onRequestLeave} className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          연차 신청
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-3 py-2 font-medium">유형</th>
              <th className="text-left px-3 py-2 font-medium">기간</th>
              <th className="text-center px-3 py-2 font-medium">일수</th>
              <th className="text-left px-3 py-2 font-medium">사유</th>
              <th className="text-center px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {yearLeaves.map((leave) => (
              <tr key={leave.id} className="border-b hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    {LEAVE_TYPE_LABELS[leave.type]}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {leave.startDate} ~ {leave.endDate}
                </td>
                <td className="px-3 py-2 text-center">{leave.days}일</td>
                <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                  {leave.reason || '-'}
                </td>
                <td className="px-3 py-2 text-center">
                  <Badge className={`text-[10px] ${STATUS_CLS[leave.status] || ''}`}>
                    {LEAVE_STATUS_LABELS[leave.status]}
                  </Badge>
                </td>
              </tr>
            ))}
            {yearLeaves.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {year}년 연차 사용 내역이 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
