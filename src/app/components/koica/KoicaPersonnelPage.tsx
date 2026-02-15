import { useState, useMemo, type ReactNode } from 'react';
import {
  Users, Calculator, ArrowRightLeft,
  AlertTriangle, Info, TrendingUp, TrendingDown, Minus,
  UserPlus, UserMinus, Edit3, Building2, DollarSign, Hash,
  ClipboardList, Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { PageHeader } from '../layout/PageHeader';
import {
  KOICA_PROJECTS,
  formatKRW,
  calcMonthlyPay,
  calcTotal,
  computeGradeSummary,
  computeStaffDiff,
  computePersonSummary,
} from '../../data/koica-data';
import type {
  KoicaProject,
  KoicaStaffEntry,
  GradeConfig,
  GradeSummary,
  StaffDiff,
} from '../../data/koica-data';

// ── Helpers ──

function CalcTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    FIXED_RATE: 'bg-blue-100 text-blue-800 border-blue-200',
    ACTUAL_SALARY: 'bg-orange-100 text-orange-800 border-orange-200',
    DAY_RATE: 'bg-purple-100 text-purple-800 border-purple-200',
    NO_COST: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels: Record<string, string> = {
    FIXED_RATE: '정액',
    ACTUAL_SALARY: '실급여',
    DAY_RATE: '일당',
    NO_COST: '없음',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] border ${styles[type] || styles.NO_COST}`}>
      {labels[type] || type}
    </span>
  );
}

function DiffBadge({ type }: { type: StaffDiff['type'] }) {
  const styles: Record<string, string> = {
    added: 'bg-green-100 text-green-800 border-green-200',
    removed: 'bg-red-100 text-red-800 border-red-200',
    changed: 'bg-amber-100 text-amber-800 border-amber-200',
    unchanged: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  const labels: Record<string, string> = {
    added: '신규', removed: '제외', changed: '변경', unchanged: '유지',
  };
  const icons: Record<string, ReactNode> = {
    added: <UserPlus className="w-3 h-3" />,
    removed: <UserMinus className="w-3 h-3" />,
    changed: <Edit3 className="w-3 h-3" />,
    unchanged: <Minus className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] border ${styles[type]}`}>
      {icons[type]} {labels[type]}
    </span>
  );
}

// ── Grade Config Table ──

function GradeConfigCard({ project }: { project: KoicaProject }) {
  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5 text-blue-800">
          <Calculator className="w-3.5 h-3.5" />
          전문가 등급별 단가 ({project.shortName})
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="flex flex-wrap gap-3">
          {project.gradeConfigs.map(gc => (
            <div key={gc.grade} className="flex items-center gap-2 bg-card rounded-lg px-3 py-1.5 border text-xs">
              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px]" style={{ fontWeight: 600 }}>
                {gc.label}
              </span>
              {gc.isActualSalary ? (
                <span className="text-orange-700" style={{ fontWeight: 500 }}>실급여</span>
              ) : (
                <span style={{ fontWeight: 600 }}>{formatKRW(gc.unitCost)}원</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-blue-700 mt-2 flex items-start gap-1">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          {project.calcNote}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Staff Table ──

function StaffTable({ staff, label, project, showCalc = true }: {
  staff: KoicaStaffEntry[];
  label: string;
  project: KoicaProject;
  showCalc?: boolean;
}) {
  const isNepal = project.calcType === 'DAY_RATE';
  const grandTotal = staff.reduce((s, e) => s + e.total, 0);
  const fixedStaff = staff.filter(s => s.calcType === 'FIXED_RATE');
  const fixedTotal = fixedStaff.reduce((s, e) => s + e.total, 0);

  if (staff.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground bg-muted/20">
        변경 투입 인력 데이터 없음 (현행 유지)
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>{label}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{staff.length}명</Badge>
          {fixedTotal > 0 && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">
              정액 합계: {formatKRW(fixedTotal)}원
            </Badge>
          )}
        </div>
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="min-w-[80px]">성명</TableHead>
              <TableHead className="min-w-[70px]">전문가 등급</TableHead>
              {isNepal ? (
                <>
                  <TableHead>역할</TableHead>
                  <TableHead className="text-right">국내일수</TableHead>
                  <TableHead className="text-right">국외일수</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-right min-w-[90px]">단가</TableHead>
                  <TableHead className="text-right min-w-[50px]">투입율</TableHead>
                  {showCalc && <TableHead className="text-right min-w-[90px]">배정월급여</TableHead>}
                  <TableHead className="text-right min-w-[50px]">참여개월</TableHead>
                </>
              )}
              <TableHead className="text-right min-w-[100px]">총계</TableHead>
              <TableHead className="min-w-[50px]">비고</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map(s => {
              const isFixed = s.calcType === 'FIXED_RATE';
              const isNoC = s.calcType === 'NO_COST';
              return (
                <TableRow key={s.id} className={isNoC ? 'opacity-50' : ''}>
                  <TableCell>
                    <span className="text-xs" style={{ fontWeight: 600 }}>{s.name}</span>
                  </TableCell>
                  <TableCell>
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px]" style={{ fontWeight: 500 }}>
                      {s.grade}
                    </span>
                  </TableCell>
                  {isNepal ? (
                    <>
                      <TableCell className="text-xs text-muted-foreground">{s.role || '-'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{s.domesticDays || '-'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{s.overseasDays || '-'}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="text-right text-xs tabular-nums">
                        {isFixed ? formatKRW(s.unitCost) : (isNoC ? '-' : <span className="text-orange-600">실급여</span>)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.rate > 0 ? (
                          <span className="text-xs tabular-nums" style={{ fontWeight: 600 }}>{s.rate}%</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      {showCalc && (
                        <TableCell className="text-right text-xs tabular-nums">
                          {isFixed && s.monthlyPay > 0 ? (
                            <span className="text-blue-700" style={{ fontWeight: 500 }}>
                              {formatKRW(s.monthlyPay)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-xs tabular-nums">
                        {s.months > 0 ? s.months : '-'}
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-right">
                    {s.total > 0 ? (
                      <span className="text-xs tabular-nums" style={{ fontWeight: 600 }}>
                        {formatKRW(s.total)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.note ? (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-[10px] text-amber-600 cursor-help truncate block max-w-[120px]">{s.note}</span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs max-w-[300px]">{s.note}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <CalcTypeBadge type={s.calcType} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Grand total */}
            <TableRow className="bg-muted/40 border-t-2">
              <TableCell className="text-xs" style={{ fontWeight: 700 }}>합계</TableCell>
              <TableCell />
              {isNepal ? (
                <>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </>
              ) : (
                <>
                  <TableCell />
                  <TableCell />
                  {showCalc && <TableCell />}
                  <TableCell />
                </>
              )}
              <TableCell className="text-right">
                <span className="text-xs tabular-nums" style={{ fontWeight: 700 }}>
                  {grandTotal > 0 ? formatKRW(grandTotal) : '-'}
                </span>
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Grade Summary Card ──

function GradeSummaryCard({ summaries, title }: { summaries: GradeSummary[]; title: string }) {
  if (summaries.length === 0) return null;
  const totalAmount = summaries.reduce((s, g) => s + g.totalAmount, 0);
  const totalStaff = summaries.reduce((s, g) => s + g.staffCount, 0);

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-indigo-600" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead>등급</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead className="text-center">인원</TableHead>
                <TableHead className="text-right">투입율 합</TableHead>
                <TableHead className="text-right">월급여 합</TableHead>
                <TableHead className="text-right">총계</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map(g => (
                <TableRow key={g.grade}>
                  <TableCell>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px]" style={{ fontWeight: 600 }}>
                      {g.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {g.isActualSalary ? <span className="text-orange-600">실급여</span> : formatKRW(g.unitCost)}
                  </TableCell>
                  <TableCell className="text-center text-xs">{g.staffCount}명</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{g.totalRate}%</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {g.totalMonthlyPay > 0 ? formatKRW(g.totalMonthlyPay) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums" style={{ fontWeight: 600 }}>
                    {g.totalAmount > 0 ? formatKRW(g.totalAmount) : '-'}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 border-t-2">
                <TableCell className="text-xs" style={{ fontWeight: 700 }}>합계</TableCell>
                <TableCell />
                <TableCell className="text-center text-xs" style={{ fontWeight: 600 }}>{totalStaff}명</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right text-xs tabular-nums" style={{ fontWeight: 700 }}>
                  {totalAmount > 0 ? formatKRW(totalAmount) : '-'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Diff View ──

function DiffView({ project }: { project: KoicaProject }) {
  const diffs = useMemo(
    () => computeStaffDiff(project.currentStaff, project.changedStaff),
    [project]
  );

  if (project.changedStaff.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground bg-muted/20">
        변경 사항 없음 (현행 유지)
      </div>
    );
  }

  const added = diffs.filter(d => d.type === 'added');
  const removed = diffs.filter(d => d.type === 'removed');
  const changed = diffs.filter(d => d.type === 'changed');
  const unchanged = diffs.filter(d => d.type === 'unchanged');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] gap-1">
          <UserPlus className="w-3 h-3" /> 신규 {added.length}명
        </Badge>
        <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] gap-1">
          <UserMinus className="w-3 h-3" /> 제외 {removed.length}명
        </Badge>
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] gap-1">
          <Edit3 className="w-3 h-3" /> 변경 {changed.length}명
        </Badge>
        <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[10px] gap-1">
          <Minus className="w-3 h-3" /> 유지 {unchanged.length}명
        </Badge>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-16">상태</TableHead>
              <TableHead className="min-w-[80px]">성명</TableHead>
              <TableHead>등급</TableHead>
              <TableHead className="text-right">현행 투입율</TableHead>
              <TableHead className="text-right">변경 투입율</TableHead>
              <TableHead className="text-right">현행 총계</TableHead>
              <TableHead className="text-right">변경 총계</TableHead>
              <TableHead className="min-w-[200px]">변경 내용</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...changed, ...added, ...removed, ...unchanged].map(d => {
              const c = d.currentEntry;
              const n = d.changedEntry;
              const rowBg = d.type === 'added' ? 'bg-green-50/50'
                : d.type === 'removed' ? 'bg-red-50/50'
                : d.type === 'changed' ? 'bg-amber-50/30' : '';
              return (
                <TableRow key={d.name} className={rowBg}>
                  <TableCell><DiffBadge type={d.type} /></TableCell>
                  <TableCell>
                    <span className="text-xs" style={{ fontWeight: 600 }}>{d.name}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {c && <span className="text-[10px] text-muted-foreground">{c.grade}</span>}
                      {c && n && c.grade !== n.grade && (
                        <>
                          <ArrowRightLeft className="w-3 h-3 text-amber-500" />
                          <span className="text-[10px] text-amber-700" style={{ fontWeight: 600 }}>{n.grade}</span>
                        </>
                      )}
                      {!c && n && <span className="text-[10px] text-green-700" style={{ fontWeight: 600 }}>{n.grade}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {c ? `${c.rate}%` : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {n ? (
                      <span className={`text-xs tabular-nums ${c && n.rate !== c.rate ? 'text-amber-700' : ''}`}
                        style={{ fontWeight: c && n.rate !== c.rate ? 700 : 400 }}>
                        {n.rate > 0 ? `${n.rate}%` : '-'}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {c && c.total > 0 ? formatKRW(c.total) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {n && n.total > 0 ? (
                      <span className={`text-xs tabular-nums ${c && n.total !== c.total ? 'text-amber-700' : ''}`}
                        style={{ fontWeight: c && n.total !== c.total ? 700 : 400 }}>
                        {formatKRW(n.total)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      {d.changes.map((ch, i) => (
                        <p key={i} className={`text-[10px] ${d.type === 'removed' ? 'text-red-600' : d.type === 'added' ? 'text-green-700' : 'text-amber-700'}`}>
                          {ch}
                        </p>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Calculator Widget ──

function GradeCalculator({ project }: { project: KoicaProject }) {
  const [selectedGrade, setSelectedGrade] = useState<GradeConfig | null>(
    project.gradeConfigs.find(g => !g.isActualSalary) || null
  );
  const [rate, setRate] = useState(50);
  const [months, setMonths] = useState(12);
  const [customUnit, setCustomUnit] = useState('');

  const unitCost = selectedGrade?.isActualSalary
    ? (parseInt(customUnit.replace(/,/g, '')) || 0)
    : (selectedGrade?.unitCost || 0);
  const monthlyPay = calcMonthlyPay(unitCost, rate);
  const total = calcTotal(monthlyPay, months);

  const fixedGrades = project.gradeConfigs.filter(g => !g.isActualSalary);

  return (
    <Card className="border-green-200 bg-green-50/20">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs flex items-center gap-1.5 text-green-800">
          <Calculator className="w-3.5 h-3.5" />
          인건비 자동 계산기 ({project.shortName})
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Grade Selection */}
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">전문가 등급</label>
            <div className="flex flex-wrap gap-1">
              {project.gradeConfigs.map(gc => (
                <button
                  key={gc.grade}
                  onClick={() => setSelectedGrade(gc)}
                  className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                    selectedGrade?.grade === gc.grade
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white border-gray-200 hover:border-green-400'
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {gc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Unit Cost */}
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">단가 (월)</label>
            {selectedGrade?.isActualSalary ? (
              <Input
                type="text"
                value={customUnit}
                onChange={e => setCustomUnit(e.target.value)}
                placeholder="실급여 입력"
                className="h-8 text-xs"
              />
            ) : (
              <div className="h-8 flex items-center text-sm tabular-nums" style={{ fontWeight: 600 }}>
                {formatKRW(unitCost)}원
              </div>
            )}
          </div>

          {/* Rate */}
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">투입율 (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={rate}
              onChange={e => setRate(Number(e.target.value))}
              className="h-8 text-xs"
            />
          </div>

          {/* Months */}
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">참여개월수</label>
            <Input
              type="number"
              min={0}
              max={60}
              value={months}
              onChange={e => setMonths(Number(e.target.value))}
              className="h-8 text-xs"
            />
          </div>

          {/* Results */}
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] text-muted-foreground block mb-1">계산 결과</label>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">배정월급여:</span>
                <span className="tabular-nums text-blue-700" style={{ fontWeight: 600 }}>
                  {formatKRW(monthlyPay)}원
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">총계:</span>
                <span className="tabular-nums text-green-800" style={{ fontWeight: 700 }}>
                  {formatKRW(total)}원
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Formula display */}
        <div className="mt-3 px-3 py-2 bg-card rounded-lg border text-xs flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">계산식:</span>
          <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[11px]">
            {formatKRW(unitCost)} x {rate}% = {formatKRW(monthlyPay)}
          </code>
          <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
          <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[11px]">
            {formatKRW(monthlyPay)} x {months}개월 = <span className="text-green-700" style={{ fontWeight: 600 }}>{formatKRW(total)}</span>
          </code>
        </div>

        {/* Quick reference for fixed grades */}
        {fixedGrades.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-muted-foreground mb-1">정액 등급 투입율별 월급여 참조표:</p>
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-1" style={{ fontWeight: 600 }}>등급\투입율</th>
                    {[10, 20, 30, 50, 70, 80, 90, 100].map(r => (
                      <th key={r} className="text-right p-1 tabular-nums" style={{ fontWeight: 600 }}>{r}%</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fixedGrades.map(gc => (
                    <tr key={gc.grade} className="border-b border-dashed">
                      <td className="p-1" style={{ fontWeight: 500 }}>{gc.label}</td>
                      {[10, 20, 30, 50, 70, 80, 90, 100].map(r => (
                        <td key={r} className="text-right p-1 tabular-nums text-muted-foreground">
                          {formatKRW(calcMonthlyPay(gc.unitCost, r))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Single Project View ──

function ProjectDetailView({ project }: { project: KoicaProject }) {
  const [showDiff, setShowDiff] = useState(false);

  const currentGradeSummary = useMemo(
    () => computeGradeSummary(project.currentStaff, project.gradeConfigs),
    [project]
  );
  const changedGradeSummary = useMemo(
    () => project.changedStaff.length > 0
      ? computeGradeSummary(project.changedStaff, project.gradeConfigs)
      : [],
    [project]
  );

  const currentTotal = project.currentStaff.reduce((s, e) => s + e.total, 0);
  const changedTotal = project.changedStaff.reduce((s, e) => s + e.total, 0);
  const diff = changedTotal - currentTotal;

  return (
    <div className="space-y-4">
      {/* Project header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            {project.shortName}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{project.name}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{project.period}</Badge>
            <Badge variant="outline" className="text-[10px]">종료: {project.endDate}</Badge>
            <CalcTypeBadge type={project.calcType} />
            {project.projectTotal && (
              <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-[10px]">
                인건비 총액: {formatKRW(project.projectTotal)}원
              </Badge>
            )}
          </div>
        </div>
        {project.changedStaff.length > 0 && (
          <Button
            variant={showDiff ? 'default' : 'outline'}
            size="sm"
            className="text-xs gap-1"
            onClick={() => setShowDiff(!showDiff)}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            변경 비교
          </Button>
        )}
      </div>

      {/* Notes */}
      {project.notes.length > 0 && (
        <div className="bg-amber-50/50 border border-amber-200 rounded-lg px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {project.notes.map((n, i) => (
                <p key={i} className="text-xs text-amber-800">{n}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Grade config */}
      <GradeConfigCard project={project} />

      {/* Calculator */}
      {project.calcType !== 'DAY_RATE' && (
        <GradeCalculator project={project} />
      )}

      {/* Diff view */}
      {showDiff && project.changedStaff.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm flex items-center gap-1.5 mb-3" style={{ fontWeight: 600 }}>
              <ArrowRightLeft className="w-4 h-4 text-amber-600" />
              현행 → 변경 비교
            </h4>
            <DiffView project={project} />
          </div>
          {/* Cost diff summary */}
          {(currentTotal > 0 || changedTotal > 0) && (
            <Card className={diff < 0 ? 'border-green-200 bg-green-50/20' : diff > 0 ? 'border-red-200 bg-red-50/20' : ''}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">정액 인건비 변경분 (자동계산 가능 부분):</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">현행 {formatKRW(currentTotal)}원</span>
                    <ArrowRightLeft className="w-3 h-3" />
                    <span className="text-xs tabular-nums" style={{ fontWeight: 600 }}>변경 {formatKRW(changedTotal)}원</span>
                    {diff !== 0 && (
                      <Badge className={`text-[10px] ${diff < 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {diff > 0 ? '+' : ''}{formatKRW(diff)}원
                        {diff < 0 ? <TrendingDown className="w-3 h-3 ml-0.5" /> : <TrendingUp className="w-3 h-3 ml-0.5" />}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Separator />

      {/* Staff tables */}
      <div className={project.changedStaff.length > 0 ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : ''}>
        <StaffTable staff={project.currentStaff} label={project.currentLabel} project={project} />
        {project.changedStaff.length > 0 && (
          <StaffTable staff={project.changedStaff} label={project.changedLabel} project={project} />
        )}
      </div>

      {/* Grade summaries */}
      <div className={changedGradeSummary.length > 0 ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : ''}>
        <GradeSummaryCard summaries={currentGradeSummary} title={`등급별 소계 (현행)`} />
        {changedGradeSummary.length > 0 && (
          <GradeSummaryCard summaries={changedGradeSummary} title={`등급별 소계 (변경)`} />
        )}
      </div>
    </div>
  );
}

// ── Person Cross-Project View ──

function PersonCrossView() {
  const persons = useMemo(() => computePersonSummary(), []);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return persons;
    const q = filter.toLowerCase();
    return persons.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.projects.some(pr => pr.projectShortName.toLowerCase().includes(q))
    );
  }, [persons, filter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="이름 또는 사업명 검색..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="max-w-sm h-8 text-xs"
        />
        <Badge variant="outline" className="text-[10px]">{filtered.length}명</Badge>
      </div>
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="min-w-[80px] sticky left-0 bg-muted/30 z-10">성명</TableHead>
              {KOICA_PROJECTS.map(p => (
                <TableHead key={p.id} className="text-center min-w-[90px]">
                  <div className="text-[10px] leading-tight">{p.shortName}</div>
                </TableHead>
              ))}
              <TableHead className="text-right min-w-[70px]">현행 합계</TableHead>
              <TableHead className="text-right min-w-[70px]">변경 합계</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(person => (
              <TableRow key={person.name}>
                <TableCell className="sticky left-0 bg-background z-10">
                  <span className="text-xs" style={{ fontWeight: 600 }}>{person.name}</span>
                </TableCell>
                {KOICA_PROJECTS.map(proj => {
                  const pp = person.projects.find(p => p.projectId === proj.id);
                  if (!pp) return <TableCell key={proj.id} className="text-center text-[10px] text-muted-foreground">-</TableCell>;
                  const hasChange = pp.changedRate > 0 && pp.changedRate !== pp.currentRate;
                  return (
                    <TableCell key={proj.id} className="text-center">
                      <div className="text-[11px] tabular-nums">
                        {pp.currentRate > 0 && (
                          <span className={hasChange ? 'text-muted-foreground line-through' : ''}>
                            {pp.currentRate}%
                          </span>
                        )}
                        {hasChange && (
                          <span className="text-amber-700 ml-0.5" style={{ fontWeight: 600 }}>
                            {pp.changedRate}%
                          </span>
                        )}
                        {pp.currentRate === 0 && pp.changedRate > 0 && (
                          <span className="text-green-700" style={{ fontWeight: 600 }}>
                            {pp.changedRate}%
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-muted-foreground">{pp.grade}</div>
                    </TableCell>
                  );
                })}
                <TableCell className="text-right">
                  <span className={`text-xs tabular-nums ${person.totalCurrentRate > 100 ? 'text-red-700' : ''}`}
                    style={{ fontWeight: 600 }}>
                    {person.totalCurrentRate}%
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={`text-xs tabular-nums ${person.totalChangedRate > 100 ? 'text-red-700' : ''}`}
                    style={{ fontWeight: 600 }}>
                    {person.totalChangedRate}%
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Overview Summary ──

function OverviewSummary() {
  const kpis = useMemo(() => {
    let totalCurrentStaff = 0;
    let totalChangedStaff = 0;
    let totalCurrentCost = 0;
    let totalChangedCost = 0;
    const uniqueCurrentNames = new Set<string>();
    const uniqueChangedNames = new Set<string>();

    for (const p of KOICA_PROJECTS) {
      totalCurrentStaff += p.currentStaff.length;
      totalChangedStaff += p.changedStaff.length;
      totalCurrentCost += p.currentStaff.reduce((s, e) => s + e.total, 0);
      totalChangedCost += p.changedStaff.reduce((s, e) => s + e.total, 0);
      p.currentStaff.forEach(s => uniqueCurrentNames.add(s.name));
      p.changedStaff.forEach(s => uniqueChangedNames.add(s.name));
    }

    return {
      projectCount: KOICA_PROJECTS.length,
      totalCurrentStaff,
      totalChangedStaff,
      uniqueCurrentCount: uniqueCurrentNames.size,
      uniqueChangedCount: uniqueChangedNames.size,
      totalCurrentCost,
      totalChangedCost,
      costDiff: totalChangedCost - totalCurrentCost,
    };
  }, []);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <Building2 className="w-3 h-3 text-indigo-600" />KOICA 사업
          </div>
          <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.projectCount}<span className="text-sm text-muted-foreground">건</span></p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <Users className="w-3 h-3 text-blue-600" />현행 투입
          </div>
          <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.totalCurrentStaff}<span className="text-sm text-muted-foreground">건</span></p>
          <p className="text-[10px] text-muted-foreground">{kpis.uniqueCurrentCount}명 (중복제외)</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <Users className="w-3 h-3 text-green-600" />변경 투입
          </div>
          <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.totalChangedStaff}<span className="text-sm text-muted-foreground">건</span></p>
          <p className="text-[10px] text-muted-foreground">{kpis.uniqueChangedCount}명 (중복제외)</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <DollarSign className="w-3 h-3 text-blue-600" />현행 정액 합계
          </div>
          <p className="text-sm tabular-nums" style={{ fontWeight: 600 }}>{formatKRW(kpis.totalCurrentCost)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <DollarSign className="w-3 h-3 text-green-600" />변경 정액 합계
          </div>
          <p className="text-sm tabular-nums" style={{ fontWeight: 600 }}>{formatKRW(kpis.totalChangedCost)}</p>
        </CardContent>
      </Card>
      <Card className={kpis.costDiff < 0 ? 'border-green-200' : kpis.costDiff > 0 ? 'border-red-200' : ''}>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            {kpis.costDiff < 0 ? <TrendingDown className="w-3 h-3 text-green-600" /> : <TrendingUp className="w-3 h-3 text-red-600" />}
            증감분
          </div>
          <p className={`text-sm tabular-nums ${kpis.costDiff < 0 ? 'text-green-700' : kpis.costDiff > 0 ? 'text-red-700' : ''}`}
            style={{ fontWeight: 600 }}>
            {kpis.costDiff > 0 ? '+' : ''}{formatKRW(kpis.costDiff)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-0.5">
            <Hash className="w-3 h-3" />정산 유형
          </div>
          <p className="text-[10px]">
            <span className="text-blue-700" style={{ fontWeight: 600 }}>정액정산</span> (CTS) +{' '}
            <span className="text-orange-700" style={{ fontWeight: 600 }}>실급여</span> (IBS) +{' '}
            <span className="text-purple-700" style={{ fontWeight: 600 }}>일당</span> (네팔)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export function KoicaPersonnelPage() {
  const [activeProject, setActiveProject] = useState(KOICA_PROJECTS[0].id);

  const selectedProject = useMemo(
    () => KOICA_PROJECTS.find(p => p.id === activeProject) || KOICA_PROJECTS[0],
    [activeProject]
  );

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader
          icon={ClipboardList}
          iconGradient="linear-gradient(135deg, #4338ca, #6366f1)"
          title="KOICA 사업 인력 배치"
          description="전문가 등급별 단가 자동 계산 | 현행 vs 변경 비교 | 정액정산·실급여·일당 구분"
          badge="2026년"
        />

        {/* Important note */}
        <Card className="border-blue-300 bg-blue-50/40">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p style={{ fontWeight: 600 }} className="text-blue-900">
                  CTS는 실인건비 기준 정산이 아니라 RFP에 기재된 급수별 고정액 기준으로 정액정산입니다.
                </p>
                <p className="text-blue-700">
                  서류상 인건비보다 실인건비가 적어도 관계없습니다. IBS 사업의 경우 상위 등급(2급/3급)은 고정 단가, 하위 등급(4급/5급)은 실급여 기준입니다.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Overview KPIs */}
        <OverviewSummary />

        {/* Main Tabs */}
        <Tabs defaultValue="project">
          <TabsList>
            <TabsTrigger value="project" className="gap-1">
              <Building2 className="w-3.5 h-3.5" /> 사업별 상세
            </TabsTrigger>
            <TabsTrigger value="person" className="gap-1">
              <Users className="w-3.5 h-3.5" /> 인원별 교차 현황
            </TabsTrigger>
          </TabsList>

          {/* ─── Project Detail View ─── */}
          <TabsContent value="project" className="mt-4 space-y-4">
            {/* Project selector */}
            <div className="flex flex-wrap gap-1.5">
              {KOICA_PROJECTS.map(p => {
                const isActive = p.id === activeProject;
                const hasChanges = p.changedStaff.length > 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveProject(p.id)}
                    className={`
                      px-3 py-1.5 rounded-lg text-xs border transition-all
                      ${isActive
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-indigo-400 hover:bg-indigo-50'
                      }
                    `}
                    style={{ fontWeight: isActive ? 600 : 400 }}
                  >
                    <div className="flex items-center gap-1.5">
                      {p.shortName}
                      {hasChanges && !isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <ProjectDetailView project={selectedProject} />
          </TabsContent>

          {/* ─── Person Cross-Project View ─── */}
          <TabsContent value="person" className="mt-4">
            <PersonCrossView />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}