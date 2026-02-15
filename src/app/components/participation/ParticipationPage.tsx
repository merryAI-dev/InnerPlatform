import { PageHeader } from '../layout/PageHeader';
import { useState, useMemo } from 'react';
import {
  Users, AlertTriangle, ShieldAlert, Shield,
  ChevronDown, ChevronUp, Search, Info,
  UserCheck, FileText, FolderKanban,
  AlertCircle, CheckCircle2, XCircle, Eye, Network,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../ui/dialog';
import { Separator } from '../ui/separator';
import { useAppStore } from '../../data/store';
import { SETTLEMENT_SYSTEM_SHORT } from '../../data/types';
import type { SettlementSystemCode, ParticipationEntry } from '../../data/types';
import {
  computeMemberSummaries,
  PART_PROJECTS,
  EMPLOYEES,
  getCrossVerifyRisk,
  CROSS_VERIFY_RULES,
} from '../../data/participation-data';
import type { MemberParticipationSummary } from '../../data/participation-data';

// ── Helpers ──

const riskColors = {
  SAFE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  WARNING: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  DANGER: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' },
};
const riskLabels = { SAFE: '안전', WARNING: '경고', DANGER: '위험' };

function RateBar({ rate, showLabel = true }: { rate: number; showLabel?: boolean }) {
  const pct = Math.min(rate, 200);
  const color = rate > 100 ? 'bg-rose-500' : rate > 80 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5 min-w-[90px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden relative">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct / 2, 100)}%` }} />
        {/* 100% marker */}
        <div className="absolute top-0 left-1/2 w-px h-full bg-gray-400 opacity-40" />
      </div>
      {showLabel && (
        <span className={`text-[11px] tabular-nums ${rate > 100 ? 'text-red-700' : rate > 80 ? 'text-amber-700' : 'text-muted-foreground'}`} style={{ fontWeight: 600, minWidth: 32, textAlign: 'right' }}>
          {rate}%
        </span>
      )}
    </div>
  );
}

const settlementColors: Record<string, string> = {
  E_NARA_DOUM: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ACCOUNTANT: 'bg-amber-50 text-amber-700 border-amber-200',
  PRIVATE: 'bg-slate-100 text-slate-500 border-slate-200',
  IRIS: 'bg-purple-50 text-purple-700 border-purple-200',
  RCMS: 'bg-violet-50 text-violet-700 border-violet-200',
  EZBARO: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  E_HIJO: 'bg-teal-50 text-teal-700 border-teal-200',
  EDUFINE: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  HAPPYEUM: 'bg-pink-50 text-pink-700 border-pink-200',
  AGRIX: 'bg-lime-50 text-lime-700 border-lime-200',
  NONE: 'bg-slate-100 text-slate-400 border-slate-200',
};

function SettlementBadge({ system }: { system: SettlementSystemCode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] border ${settlementColors[system] || settlementColors.NONE}`}>
      {SETTLEMENT_SYSTEM_SHORT[system]}
    </span>
  );
}

function PhaseChip({ phase }: { phase: string }) {
  const c = phase === '계약전' ? 'bg-amber-100 text-amber-800 border-amber-200'
    : phase.includes('변경') ? 'bg-purple-100 text-purple-700 border-purple-200'
    : 'bg-green-100 text-green-800 border-green-200';
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] border ${c}`}>{phase}</span>;
}

// ── Protocol Guide ──

function ProtocolGuide() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50/40 to-violet-50/20 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Info className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <span className="text-[13px] text-indigo-900" style={{ fontWeight: 600 }}>4단계 프로토콜 가이드</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-7 w-7 p-0 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-100"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {expanded && (
        <CardContent className="pt-0 pb-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center" style={{ fontWeight: 700 }}>1</span>
                <span style={{ fontWeight: 600 }}>사업담당 조직 내 인원으로 서류인력 꾸리기</span>
              </div>
              <p className="text-muted-foreground ml-7">동일 조직(CIC/그룹) 내 인원의 참여율을 우선 배정</p>
            </div>
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center" style={{ fontWeight: 700 }}>2</span>
                <span style={{ fontWeight: 600 }}>참여율 부족 시 체크포인트</span>
              </div>
              <ul className="space-y-1 text-muted-foreground ml-7">
                <li><span className="text-foreground" style={{ fontWeight: 500 }}>동일 기관?</span> → 100% 초과 불가</li>
                <li><span className="text-foreground" style={{ fontWeight: 500 }}>시스템 정산?</span> → e나라도움 내 교차검증 주의</li>
                <li><span className="text-foreground" style={{ fontWeight: 500 }}>회계사정산?</span> → 동일 기관만 확인, 타 기관과 교차 낮음</li>
                <li><span className="text-foreground" style={{ fontWeight: 500 }}>민간사업?</span> → 교차검증 대상 아님</li>
              </ul>
            </div>
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center" style={{ fontWeight: 700 }}>3</span>
                <span style={{ fontWeight: 600 }}>타 조직 구성원 필요 시</span>
              </div>
              <ul className="space-y-1 text-muted-foreground ml-7">
                <li>아래 <span className="text-foreground" style={{ fontWeight: 500 }}>인원별 현황 탭</span>에서 가용 인력 선별</li>
                <li>CIC/그룹 대표 간 합의 → <span className="text-foreground" style={{ fontWeight: 500 }}>확정 즉시 기입</span></li>
              </ul>
            </div>
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center" style={{ fontWeight: 700 }}>4</span>
                <span style={{ fontWeight: 600 }}>기존인력 조정 필요 시</span>
              </div>
              <div className="ml-7 space-y-1">
                <p className="text-muted-foreground">참여율 반납/교체 → 조직장 간 협의 → 3번 반복</p>
                <p className="text-red-600" style={{ fontWeight: 500 }}>
                  <AlertTriangle className="w-3 h-3 inline mr-0.5" />서류 제출 전 확정 가능성 높은 사업은 미리 기입!
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </div>
  );
}

// ── Member Detail Dialog ──

function MemberDetailDialog({ member, open, onClose }: {
  member: MemberParticipationSummary | null; open: boolean; onClose: () => void;
}) {
  if (!member) return null;
  const rc = riskColors[member.riskLevel];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[760px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserCheck className="w-5 h-5" />
            {member.realName}
            {member.nickname && <span className="text-muted-foreground">({member.nickname})</span>}
            — 참여율 상세
          </DialogTitle>
          <DialogDescription>
            전체 {member.totalRate}% / {member.projectCount}개 사업 배정
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {/* Summary Bar */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge className={`${rc.bg} ${rc.text} border ${rc.border}`}>{riskLabels[member.riskLevel]}</Badge>
            <div className="flex items-center gap-3 text-xs">
              <span>e나라도움 <span style={{ fontWeight: 700 }} className={member.eNaraRate > 100 ? 'text-red-700' : ''}>{member.eNaraRate}%</span></span>
              <span>회계사정산 <span style={{ fontWeight: 700 }}>{member.accountantRate}%</span></span>
              {member.privateRate > 0 && <span>민간 <span style={{ fontWeight: 700 }}>{member.privateRate}%</span></span>}
            </div>
          </div>

          {/* Risk Alerts */}
          {member.riskDetails.length > 0 && (
            <div className="mt-3 space-y-1">
              {member.riskDetails.map((d, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  {d.includes('초과') || d.includes('환수') ? (
                    <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <span className={d.includes('초과') || d.includes('환수') ? 'text-red-700' : 'text-amber-700'} style={{ fontWeight: 500 }}>{d}</span>
                </div>
              ))}
            </div>
          )}

          {/* Agency breakdown */}
          <div className="mt-4 flex flex-wrap gap-3">
            {Object.entries(member.orgRates).sort(([,a],[,b]) => b - a).map(([org, rate]) => (
              <div key={org} className="text-xs border rounded-lg px-3 py-1.5 bg-card">
                <span className="text-muted-foreground">{org}</span>
                <span className={`ml-1.5 ${rate > 100 ? 'text-red-700' : ''}`} style={{ fontWeight: 700 }}>{rate}%</span>
              </div>
            ))}
          </div>

          <Separator className="my-3" />

          {/* Entries Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">사업명</TableHead>
                <TableHead>정산유형</TableHead>
                <TableHead>발주기관</TableHead>
                <TableHead className="text-right">참여율</TableHead>
                <TableHead>기간</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {member.entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs" style={{ fontWeight: 500 }}>{e.projectName}</TableCell>
                  <TableCell><SettlementBadge system={e.settlementSystem} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{e.clientOrg.split('/')[0]}</TableCell>
                  <TableCell className="text-right"><span className="text-xs" style={{ fontWeight: 600 }}>{e.rate}%</span></TableCell>
                  <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{e.periodStart}</TableCell>
                </TableRow>
              ))}
              {/* Total row */}
              <TableRow className="bg-muted/30">
                <TableCell className="text-xs" style={{ fontWeight: 700 }}>합계</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right">
                  <span className={`text-xs ${member.totalRate > 100 ? 'text-red-700' : ''}`} style={{ fontWeight: 700 }}>{member.totalRate}%</span>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Cross-Verification Matrix ──

function CrossVerificationInfo() {
  const systems: SettlementSystemCode[] = ['E_NARA_DOUM', 'ACCOUNTANT', 'IRIS', 'RCMS', 'EZBARO', 'E_HIJO', 'AGRIX'];
  const riskBg: Record<string, string> = { HIGH: 'bg-red-200 text-red-900', MEDIUM: 'bg-amber-200 text-amber-900', LOW: 'bg-gray-100 text-gray-500' };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Network className="w-4 h-4" />
            MYSC 사업 정산유형 분류
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">사업명</TableHead>
                  <TableHead>발주기관</TableHead>
                  <TableHead>정산유형</TableHead>
                  <TableHead>진행단계</TableHead>
                  <TableHead>기간</TableHead>
                  <TableHead className="text-center">참여자수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PART_PROJECTS.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs" style={{ fontWeight: 500 }}>{p.shortName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.clientOrg}</TableCell>
                    <TableCell><SettlementBadge system={p.settlement} /></TableCell>
                    <TableCell><PhaseChip phase={p.phase} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.periodDesc}</TableCell>
                    <TableCell className="text-center text-xs">-</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            교차검증 매트릭스 (정산 시스템 간 위험도)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="text-[10px] w-full">
              <thead>
                <tr>
                  <th className="p-1.5 text-left" />
                  {systems.map(s => (
                    <th key={s} className="p-1.5 text-center whitespace-nowrap" style={{ fontWeight: 600 }}>
                      {SETTLEMENT_SYSTEM_SHORT[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {systems.map(row => (
                  <tr key={row}>
                    <td className="p-1.5 whitespace-nowrap" style={{ fontWeight: 600 }}>{SETTLEMENT_SYSTEM_SHORT[row]}</td>
                    {systems.map(col => {
                      if (row === col) return <td key={col} className="p-1.5 text-center bg-gray-800 text-white text-[9px] rounded-sm">동일</td>;
                      const rule = getCrossVerifyRisk(row, col);
                      if (!rule) return <td key={col} className="p-1.5 text-center text-gray-300">-</td>;
                      return (
                        <TooltipProvider key={col}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <td className={`p-1.5 text-center cursor-help rounded-sm ${riskBg[rule.risk] || ''}`}>
                                {rule.risk === 'HIGH' ? '!!' : rule.risk === 'MEDIUM' ? '!' : '~'}
                              </td>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px] text-xs">
                              <p style={{ fontWeight: 600 }}>{SETTLEMENT_SYSTEM_SHORT[row]} ↔ {SETTLEMENT_SYSTEM_SHORT[col]}</p>
                              <p className="text-muted-foreground">{rule.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-red-200" /> HIGH — 실시간 교차</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-amber-200" /> MEDIUM — 주기적 연계</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-gray-100 border" /> LOW — 간접</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-gray-800" /> 동일 시스템</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
            <AlertTriangle className="w-4 h-4" />
            재정정보원 교차검증 포인트
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <p style={{ fontWeight: 600 }} className="mb-1">e나라도움 (SFDS)</p>
              <p className="text-muted-foreground">국고보조금 부정수급탐지시스템. R&D(IRIS/RCMS/이지바로), 지방재정(e호조), 교육(에듀파인), 복지(행복이음) 등 모든 정부 시스템과 교차검증.</p>
            </div>
            <div>
              <p style={{ fontWeight: 600 }} className="mb-1">회계사정산</p>
              <p className="text-muted-foreground">전문 회계법인이 정산. e나라도움 시스템과 직접 연동은 아니나, <span className="text-foreground" style={{ fontWeight: 500 }}>동일 발주기관(KOICA 등)</span>은 자체적으로 참여율을 확인할 수 있음.</p>
            </div>
            <div>
              <p style={{ fontWeight: 600 }} className="mb-1">민간사업</p>
              <p className="text-muted-foreground">정부 교차검증 대상 아님. 단, 전체 실제 근무시간 초과 시 내부 관리 필요.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──

export function ParticipationPage() {
  const { participationEntries } = useAppStore();
  const [searchText, setSearchText] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberParticipationSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'SAFE'>('ALL');

  const memberSummaries = useMemo(
    () => computeMemberSummaries(participationEntries),
    [participationEntries]
  );

  const filteredSummaries = useMemo(() => {
    let result = memberSummaries;
    if (riskFilter !== 'ALL') result = result.filter(m => m.riskLevel === riskFilter);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(m =>
        m.realName.toLowerCase().includes(q) ||
        m.nickname.toLowerCase().includes(q) ||
        m.entries.some(e => e.projectName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [memberSummaries, searchText, riskFilter]);

  // KPIs
  const kpis = useMemo(() => {
    const total = memberSummaries.length;
    const danger = memberSummaries.filter(m => m.riskLevel === 'DANGER').length;
    const warning = memberSummaries.filter(m => m.riskLevel === 'WARNING').length;
    const safe = memberSummaries.filter(m => m.riskLevel === 'SAFE').length;
    const totalEmployees = EMPLOYEES.length;
    const unassigned = totalEmployees - total;
    const avgRate = total > 0 ? Math.round(memberSummaries.reduce((s, m) => s + m.totalRate, 0) / total) : 0;
    const eNaraProjects = PART_PROJECTS.filter(p => p.settlement === 'E_NARA_DOUM').length;
    return { total, danger, warning, safe, totalEmployees, unassigned, avgRate, eNaraProjects };
  }, [memberSummaries]);

  // Project-centric view
  const projectEntries = useMemo(() => {
    return PART_PROJECTS.map(proj => {
      const entries = participationEntries.filter(e => e.projectId === proj.id);
      const totalRate = entries.reduce((s, e) => s + e.rate, 0);
      return { ...proj, entries, totalRate, memberCount: new Set(entries.map(e => e.memberId)).size };
    });
  }, [participationEntries]);

  const handleOpenDetail = (s: MemberParticipationSummary) => {
    setSelectedMember(s);
    setDetailOpen(true);
  };

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader
          icon={Shield}
          iconGradient="linear-gradient(135deg, #6366f1, #8b5cf6)"
          title="참여율 관리 (100-1)"
          description="2025-2026 KOICA 사업 통합관리 — 교차검증 가능 사업 참여율 합산 ≤ 100% 관리"
        />

        <ProtocolGuide />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-0.5">
                <Users className="w-3.5 h-3.5 text-blue-600" />배정 인원
              </div>
              <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.total}<span className="text-sm text-muted-foreground">/{kpis.totalEmployees}명</span></p>
              <p className="text-[10px] text-muted-foreground">평균 {kpis.avgRate}%</p>
            </CardContent>
          </Card>
          <Card className={kpis.danger > 0 ? 'border-red-200 bg-red-50/40' : ''}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <XCircle className="w-3.5 h-3.5 text-red-600" /><span className="text-red-700">위험</span>
              </div>
              <p className="text-xl text-red-700" style={{ fontWeight: 600 }}>{kpis.danger}명</p>
              <p className="text-[10px] text-red-600">e나라도움 or 동일기관 초과</p>
            </CardContent>
          </Card>
          <Card className={kpis.warning > 0 ? 'border-amber-200 bg-amber-50/40' : ''}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /><span className="text-amber-700">경고</span>
              </div>
              <p className="text-xl text-amber-700" style={{ fontWeight: 600 }}>{kpis.warning}명</p>
              <p className="text-[10px] text-amber-600">80~100% 구간</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /><span className="text-green-700">안전</span>
              </div>
              <p className="text-xl text-green-700" style={{ fontWeight: 600 }}>{kpis.safe}명</p>
              <p className="text-[10px] text-muted-foreground">여유 참여율</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <Shield className="w-3.5 h-3.5 text-blue-600" /><span>e나라도움 사업</span>
              </div>
              <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.eNaraProjects}건</p>
              <p className="text-[10px] text-muted-foreground">시스템 교차검증 대상</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <FolderKanban className="w-3.5 h-3.5" /><span>전체 사업</span>
              </div>
              <p className="text-xl" style={{ fontWeight: 600 }}>{PART_PROJECTS.length}건</p>
              <p className="text-[10px] text-muted-foreground">확정+입찰 포함</p>
            </CardContent>
          </Card>
        </div>

        {/* Danger Alert */}
        {kpis.danger > 0 && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-800" style={{ fontWeight: 600 }}>
                    환수 위험 인원 {kpis.danger}명 — 즉시 참여율 조정이 필요합니다
                  </p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                    {memberSummaries.filter(m => m.riskLevel === 'DANGER').map(m => (
                      <div key={m.memberId} className="flex items-center gap-2 text-xs cursor-pointer hover:underline" onClick={() => handleOpenDetail(m)}>
                        <span className="text-red-700" style={{ fontWeight: 600 }}>{m.realName}({m.nickname})</span>
                        <span className="text-red-600">전체 {m.totalRate}%</span>
                        {m.eNaraRate > 100 && <span className="text-red-500">e나라도움 {m.eNaraRate}%</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs defaultValue="member">
          <TabsList>
            <TabsTrigger value="member" className="gap-1"><Users className="w-3.5 h-3.5" /> 인원별 현황 (100-1)</TabsTrigger>
            <TabsTrigger value="project" className="gap-1"><FolderKanban className="w-3.5 h-3.5" /> 사업별 현황</TabsTrigger>
            <TabsTrigger value="matrix" className="gap-1"><Network className="w-3.5 h-3.5" /> 교차검증 매트릭스</TabsTrigger>
          </TabsList>

          {/* ─── Member View ─── */}
          <TabsContent value="member" className="mt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="이름 또는 사업명 검색…" value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-9 h-8 text-sm" />
              </div>
              <div className="flex items-center gap-1">
                {(['ALL', 'DANGER', 'WARNING', 'SAFE'] as const).map(f => (
                  <Button key={f} variant={riskFilter === f ? 'default' : 'outline'} size="sm" className="h-7 text-xs px-2.5"
                    onClick={() => setRiskFilter(f)}>
                    {f === 'ALL' ? '전체' : f === 'DANGER' ? `위험 ${kpis.danger}` : f === 'WARNING' ? `경고 ${kpis.warning}` : `안전 ${kpis.safe}`}
                  </Button>
                ))}
              </div>
              <Badge variant="outline" className="text-xs">{filteredSummaries.length}명</Badge>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-8" />
                    <TableHead className="min-w-[100px]">이름</TableHead>
                    <TableHead className="min-w-[120px]">전체 투입율</TableHead>
                    <TableHead className="min-w-[80px]">e나라도움</TableHead>
                    <TableHead className="min-w-[80px]">회계사정산</TableHead>
                    <TableHead className="min-w-[60px]">민간</TableHead>
                    <TableHead className="text-center">사업수</TableHead>
                    <TableHead className="min-w-[200px]">리스크</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummaries.map(m => {
                    const rc = riskColors[m.riskLevel];
                    return (
                      <TableRow key={m.memberId} className="cursor-pointer hover:bg-accent/40" onClick={() => handleOpenDetail(m)}>
                        <TableCell><div className={`w-2 h-2 rounded-full ${rc.dot}`} /></TableCell>
                        <TableCell>
                          <div>
                            <span className="text-xs" style={{ fontWeight: 600 }}>{m.realName}</span>
                            {m.nickname && <span className="text-[10px] text-muted-foreground ml-1">({m.nickname})</span>}
                          </div>
                        </TableCell>
                        <TableCell><RateBar rate={m.totalRate} /></TableCell>
                        <TableCell>
                          {m.eNaraRate > 0 ? (
                            <span className={`text-xs tabular-nums ${m.eNaraRate > 100 ? 'text-red-700' : m.eNaraRate > 80 ? 'text-amber-700' : ''}`} style={{ fontWeight: 600 }}>{m.eNaraRate}%</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.accountantRate > 0 ? (
                            <span className="text-xs tabular-nums" style={{ fontWeight: 500 }}>{m.accountantRate}%</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.privateRate > 0 ? (
                            <span className="text-xs tabular-nums text-muted-foreground">{m.privateRate}%</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs">{m.projectCount}</TableCell>
                        <TableCell>
                          {m.riskDetails.length > 0 ? (
                            <span className="text-[10px] text-red-600 line-clamp-1">{m.riskDetails[0]}</span>
                          ) : (
                            <span className="text-[10px] text-green-600">리스크 없음</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><Eye className="w-3.5 h-3.5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ─── Project View ─── */}
          <TabsContent value="project" className="mt-4 space-y-3">
            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="min-w-[160px]">사업명</TableHead>
                    <TableHead>정산유형</TableHead>
                    <TableHead>발주기관</TableHead>
                    <TableHead>단계</TableHead>
                    <TableHead className="text-center">인원</TableHead>
                    <TableHead className="min-w-[250px]">인원 배정 현황</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectEntries.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div>
                          <span className="text-xs" style={{ fontWeight: 600 }}>{p.shortName}</span>
                          <p className="text-[10px] text-muted-foreground">{p.periodDesc}</p>
                        </div>
                      </TableCell>
                      <TableCell><SettlementBadge system={p.settlement} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{p.clientOrg.split('/')[0]}</TableCell>
                      <TableCell><PhaseChip phase={p.phase} /></TableCell>
                      <TableCell className="text-center text-xs">{p.memberCount}명</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-0.5">
                          {p.entries.map(e => {
                            const name = e.memberName.includes('(') ? e.memberName.split('(')[1].replace(')', '') : e.memberName;
                            return (
                              <Tooltip key={e.id}>
                                <TooltipTrigger>
                                  <Badge variant="outline" className={`text-[10px] gap-0.5 ${e.isDocumentOnly ? 'border-dashed' : ''}`}>
                                    {name} {e.rate}%
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  {e.memberName}: {e.rate}% / {e.periodStart}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ─── Cross-Verification Matrix ─── */}
          <TabsContent value="matrix" className="mt-4">
            <CrossVerificationInfo />
          </TabsContent>
        </Tabs>

        <MemberDetailDialog member={selectedMember} open={detailOpen} onClose={() => setDetailOpen(false)} />
      </div>
    </TooltipProvider>
  );
}