import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { HrEmployee } from '../../data/hr-types';
import { EMPLOYMENT_STATUS_LABELS, CONTRACT_TYPE_LABELS } from '../../data/hr-types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const STATUS_BADGE_CLS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  ON_LEAVE: 'bg-amber-100 text-amber-700',
  RESIGNED: 'bg-slate-100 text-slate-500',
  TERMINATED: 'bg-red-100 text-red-700',
};

interface HrEmployeeListPageProps {
  employees: HrEmployee[];
  onSelect: (employee: HrEmployee) => void;
  onAdd: () => void;
}

export function HrEmployeeListPage({ employees, onSelect, onAdd }: HrEmployeeListPageProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q)
        || e.email.toLowerCase().includes(q)
        || e.department.toLowerCase().includes(q)
        || e.position.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of employees) {
      map[e.employmentStatus] = (map[e.employmentStatus] || 0) + 1;
    }
    return map;
  }, [employees]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">직원 관리</h2>
          <div className="flex gap-2 mt-1">
            {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([key, label]) => (
              <span key={key} className="text-xs text-muted-foreground">
                {label} {counts[key] || 0}명
              </span>
            ))}
          </div>
        </div>
        <Button size="sm" onClick={onAdd} className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          직원 등록
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="이름, 이메일, 부서, 직위로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left px-3 py-2 font-medium">이름</th>
              <th className="text-left px-3 py-2 font-medium">부서</th>
              <th className="text-left px-3 py-2 font-medium">직위</th>
              <th className="text-left px-3 py-2 font-medium">계약유형</th>
              <th className="text-left px-3 py-2 font-medium">입사일</th>
              <th className="text-center px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr
                key={emp.id}
                className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => onSelect(emp)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{emp.name}</div>
                  <div className="text-xs text-muted-foreground">{emp.email}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{emp.department}</td>
                <td className="px-3 py-2 text-muted-foreground">{emp.position}</td>
                <td className="px-3 py-2 text-muted-foreground">{CONTRACT_TYPE_LABELS[emp.contractType]}</td>
                <td className="px-3 py-2 text-muted-foreground">{emp.joinDate}</td>
                <td className="px-3 py-2 text-center">
                  <Badge className={`text-[10px] ${STATUS_BADGE_CLS[emp.employmentStatus] || ''}`}>
                    {EMPLOYMENT_STATUS_LABELS[emp.employmentStatus]}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {search ? '검색 결과가 없습니다' : '등록된 직원이 없습니다'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
