import { PageHeader } from '../layout/PageHeader';
import { useState, useMemo } from 'react';
import {
  Users, AlertTriangle, ShieldAlert, Shield,
  Search,
  UserCheck, FolderKanban, Download,
  AlertCircle, CheckCircle2, XCircle, Eye, Network, Info, Building2,
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
  buildParticipationRiskReport,
  PARTICIPATION_RISK_RULESET,
  getCrossVerifyRisk,
} from '../../data/participation-data';
import type { MemberParticipationSummary } from '../../data/participation-data';
import { buildAllProjectTeamParticipationEntries } from '../../platform/project-team-participation';

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
  E_NARA_DOUM: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  ACCOUNTANT: 'bg-amber-50 text-amber-700 border-amber-200',
  PRIVATE: 'bg-slate-100 text-slate-500 border-slate-200',
  IRIS: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  RCMS: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  EZBARO: 'bg-rose-50 text-rose-700 border-rose-200',
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
    : phase.includes('변경') ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
    : 'bg-green-100 text-green-800 border-green-200';
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] border ${c}`}>{phase}</span>;
}

interface ProjectParticipationView {
  id: string;
  shortName: string;
  clientOrg: string;
  settlement: SettlementSystemCode;
  phase: string;
  periodDesc: string;
  entries: ParticipationEntry[];
  totalRate: number;
  memberCount: number;
}

interface ClassificationLane {
  key: 'ENARA' | 'KOICA' | 'ACCOUNTANT' | 'PRIVATE';
  label: string;
  helper: string;
  projects: ProjectParticipationView[];
  projectCount: number;
  memberCount: number;
  totalRate: number;
  riskCount: number;
}

const classificationLaneMeta: Record<ClassificationLane['key'], Pick<ClassificationLane, 'label' | 'helper'>> = {
  ENARA: {
    label: 'e나라도움',
    helper: '전용계좌·Type5 기준',
  },
  KOICA: {
    label: 'KOICA',
    helper: '동일 기관 누적 확인',
  },
  ACCOUNTANT: {
    label: '회계사정산',
    helper: '전문 회계법인 정산',
  },
  PRIVATE: {
    label: '민간/기타',
    helper: '교차검증 참고',
  },
};

function getClassificationLaneKey(project: ProjectParticipationView): ClassificationLane['key'] {
  if (project.settlement === 'E_NARA_DOUM') return 'ENARA';
  if (project.clientOrg.includes('KOICA')) return 'KOICA';
  if (project.settlement === 'ACCOUNTANT') return 'ACCOUNTANT';
  return 'PRIVATE';
}

function laneToneClass(key: ClassificationLane['key']) {
  switch (key) {
    case 'ENARA':
      return 'border-sky-200 bg-sky-50/70 text-sky-800';
    case 'KOICA':
      return 'border-emerald-200 bg-emerald-50/70 text-emerald-800';
    case 'ACCOUNTANT':
      return 'border-amber-200 bg-amber-50/70 text-amber-800';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

function participationSourceLabel(entry: ParticipationEntry) {
  return entry.source === 'PROJECT_TEAM_SYNC' ? '프로젝트 팀 연동' : '공식 참여율';
}

// ── Member Detail Dialog ──

function MemberDetailDialog({ member, formalMember, open, onClose }: {
  member: MemberParticipationSummary | null;
  formalMember: MemberParticipationSummary | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!member) return null;
  const formalRiskLevel = formalMember?.riskLevel || 'SAFE';
  const formalRiskDetails = formalMember?.riskDetails || [];
  const rc = riskColors[formalRiskLevel];

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
            표시 합계 {member.totalRate}% / {member.projectCount}개 프로젝트 배정
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {/* Summary Bar */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge className={`${rc.bg} ${rc.text} border ${rc.border}`}>{riskLabels[formalRiskLevel]}</Badge>
            <div className="flex items-center gap-3 text-xs">
              <span>공식 e나라도움 <span style={{ fontWeight: 700 }} className={(formalMember?.eNaraRate || 0) > 100 ? 'text-red-700' : ''}>{formalMember?.eNaraRate || 0}%</span></span>
              <span>공식 회계사정산 <span style={{ fontWeight: 700 }}>{formalMember?.accountantRate || 0}%</span></span>
              {(formalMember?.privateRate || 0) > 0 && <span>공식 민간 <span style={{ fontWeight: 700 }}>{formalMember?.privateRate || 0}%</span></span>}
              {member.entries.some((entry) => entry.source === 'PROJECT_TEAM_SYNC') ? (
                <span className="text-sky-700">프로젝트 팀 연동 포함</span>
              ) : null}
            </div>
          </div>

          {/* Risk Alerts */}
          {formalRiskDetails.length > 0 && (
            <div className="mt-3 space-y-1">
              {formalRiskDetails.map((d, i) => (
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
                <TableHead className="min-w-[140px]">프로젝트명</TableHead>
                <TableHead>출처</TableHead>
                <TableHead>정산유형</TableHead>
                <TableHead>계약 대상</TableHead>
                <TableHead className="text-right">참여율</TableHead>
                <TableHead>기간</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {member.entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs" style={{ fontWeight: 500 }}>{e.projectName}</TableCell>
                  <TableCell>
                    <Badge variant={e.source === 'PROJECT_TEAM_SYNC' ? 'secondary' : 'outline'} className="text-[10px]">
                      {participationSourceLabel(e)}
                    </Badge>
                  </TableCell>
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

function CrossVerificationInfo({ projects }: { projects: ProjectParticipationView[] }) {
  const systems: SettlementSystemCode[] = ['E_NARA_DOUM', 'ACCOUNTANT', 'IRIS', 'RCMS', 'EZBARO', 'E_HIJO', 'AGRIX'];
  const riskBg: Record<string, string> = { HIGH: 'bg-red-200 text-red-900', MEDIUM: 'bg-amber-200 text-amber-900', LOW: 'bg-gray-100 text-gray-500' };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Network className="w-4 h-4" />
            MYSC 프로젝트 정산유형 분류
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">프로젝트명</TableHead>
                  <TableHead>계약 대상</TableHead>
                  <TableHead>정산유형</TableHead>
                  <TableHead>진행단계</TableHead>
                  <TableHead>기간</TableHead>
                  <TableHead className="text-center">참여자수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs" style={{ fontWeight: 500 }}>{p.shortName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.clientOrg}</TableCell>
                    <TableCell><SettlementBadge system={p.settlement} /></TableCell>
                    <TableCell><PhaseChip phase={p.phase} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.periodDesc}</TableCell>
                    <TableCell className="text-center text-xs">{p.memberCount}</TableCell>
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
              <p className="text-muted-foreground">전문 회계법인이 정산. e나라도움 시스템과 직접 연동은 아니나, <span className="text-foreground" style={{ fontWeight: 500 }}>동일 기관(KOICA 등)</span>은 자체적으로 참여율을 확인할 수 있음.</p>
            </div>
            <div>
              <p style={{ fontWeight: 600 }} className="mb-1">민간형</p>
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
  const { participationEntries, projects, members } = useAppStore();
  const [searchText, setSearchText] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberParticipationSummary | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'SAFE'>('ALL');

  const displayParticipationEntries = useMemo(
    () => buildAllProjectTeamParticipationEntries(projects, participationEntries),
    [participationEntries, projects]
  );

  const formalParticipationEntries = useMemo(
    () => participationEntries.filter((entry) => entry.source !== 'PROJECT_TEAM_SYNC'),
    [participationEntries],
  );

  const memberSummaries = useMemo(
    () => computeMemberSummaries(displayParticipationEntries),
    [displayParticipationEntries]
  );

  const formalMemberSummaries = useMemo(
    () => computeMemberSummaries(formalParticipationEntries),
    [formalParticipationEntries],
  );

  const formalSummaryMap = useMemo(() => {
    return new Map(formalMemberSummaries.map((member) => [member.memberId, member]));
  }, [formalMemberSummaries]);

  const filteredSummaries = useMemo(() => {
    let result = memberSummaries;
    if (riskFilter !== 'ALL') {
      result = result.filter((member) => formalSummaryMap.get(member.memberId)?.riskLevel === riskFilter);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(m =>
        m.realName.toLowerCase().includes(q) ||
        m.nickname.toLowerCase().includes(q) ||
        m.entries.some(e => e.projectName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [formalSummaryMap, memberSummaries, searchText, riskFilter]);

  // Project-centric view
  const projectEntries = useMemo<ProjectParticipationView[]>(() => {
    const byProject = new Map<string, ParticipationEntry[]>();
    displayParticipationEntries.forEach((entry) => {
      const list = byProject.get(entry.projectId) || [];
      list.push(entry);
      byProject.set(entry.projectId, list);
    });

    const rows = Array.from(byProject.entries()).map(([projectId, entries]) => {
      const totalRate = entries.reduce((s, e) => s + e.rate, 0);
      const first = entries[0];
      const mappedProject = projects.find((p) => p.id === projectId);
      const periodTokens = Array.from(new Set(entries.map((e) => e.periodStart).filter(Boolean)));
      const periodDesc = periodTokens.slice(0, 2).join(', ') || '-';

      return {
        id: projectId,
        shortName: mappedProject?.name || first?.projectName || projectId,
        clientOrg: mappedProject?.clientOrg || first?.clientOrg || '',
        settlement: first?.settlementSystem || 'NONE',
        phase: mappedProject?.status === 'CONTRACT_PENDING'
          ? '계약전'
          : mappedProject?.status === 'IN_PROGRESS'
            ? '진행중'
            : '완료',
        periodDesc,
        entries,
        totalRate,
        memberCount: new Set(entries.map((e) => e.memberId)).size,
      };
    });

    return rows.sort((a, b) => b.memberCount - a.memberCount);
  }, [displayParticipationEntries, projects]);

  const classificationLanes = useMemo<ClassificationLane[]>(() => {
    const map = new Map<ClassificationLane['key'], ProjectParticipationView[]>();
    projectEntries.forEach((project) => {
      const key = getClassificationLaneKey(project);
      const list = map.get(key) || [];
      list.push(project);
      map.set(key, list);
    });

    return (['ENARA', 'KOICA', 'ACCOUNTANT', 'PRIVATE'] as const).map((key) => {
      const laneProjects = map.get(key) || [];
      const entries = laneProjects.flatMap((project) => project.entries);
      return {
        key,
        ...classificationLaneMeta[key],
        projects: laneProjects,
        projectCount: laneProjects.length,
        memberCount: new Set(entries.map((entry) => entry.memberId)).size,
        totalRate: entries.reduce((sum, entry) => sum + entry.rate, 0),
        riskCount: laneProjects.filter((project) => project.totalRate > 100).length,
      };
    });
  }, [projectEntries]);

  // KPIs
  const kpis = useMemo(() => {
    const total = memberSummaries.length;
    const danger = formalMemberSummaries.filter(m => m.riskLevel === 'DANGER').length;
    const warning = formalMemberSummaries.filter(m => m.riskLevel === 'WARNING').length;
    const safe = formalMemberSummaries.filter(m => m.riskLevel === 'SAFE').length;
    const totalEmployees = Math.max(total, members.length);
    const avgRate = total > 0 ? Math.round(memberSummaries.reduce((s, m) => s + m.totalRate, 0) / total) : 0;
    const eNaraProjects = projectEntries.filter((p) => p.settlement === 'E_NARA_DOUM').length;
    const koicaProjects = projectEntries.filter((p) => p.clientOrg.includes('KOICA')).length;
    return { total, danger, warning, safe, totalEmployees, avgRate, eNaraProjects, koicaProjects };
  }, [formalMemberSummaries, memberSummaries, members.length, projectEntries]);

  const handleOpenDetail = (s: MemberParticipationSummary) => {
    setSelectedMember(s);
    setDetailOpen(true);
  };

  const handleDownloadRiskJson = () => {
    const report = buildParticipationRiskReport(formalParticipationEntries);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `participation-risk-report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Header */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b bg-slate-50/80 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0176d3] text-white">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Participation Object</p>
                <h1 className="text-[18px] font-semibold text-slate-950">참여율 관리 (100-1)</h1>
                <p className="text-[12px] text-slate-500">e나라도움·KOICA·회계사정산 기준으로 누적 참여율을 확인합니다</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50">규칙 검증</Badge>
              <span className="text-[11px] text-slate-500">AI 추론 미사용 · ruleset {PARTICIPATION_RISK_RULESET.version}</span>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleDownloadRiskJson}>
                <Download className="w-3.5 h-3.5" />
                공식 JSON
              </Button>
            </div>
          </div>
        </div>

        <PageHeader
          icon={Building2}
          iconGradient="linear-gradient(135deg, #0176d3 0%, #2e844a 100%)"
          title="원천 구분"
          description="원래 프로젝트 분류를 먼저 보고, 인원별 상세로 내려갑니다"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {classificationLanes.map((lane) => (
            <div key={lane.key} className={`rounded-lg border px-3 py-3 ${laneToneClass(lane.key)}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold">{lane.label}</p>
                  <p className="text-[10px] opacity-75">{lane.helper}</p>
                </div>
                <Badge variant="outline" className="h-5 bg-white/70 px-1.5 text-[10px]">
                  {lane.projectCount}건
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <p className="text-[9px] opacity-70">인원</p>
                  <p className="font-semibold tabular-nums">{lane.memberCount}명</p>
                </div>
                <div>
                  <p className="text-[9px] opacity-70">누적</p>
                  <p className="font-semibold tabular-nums">{lane.totalRate}%</p>
                </div>
                <div>
                  <p className="text-[9px] opacity-70">검토</p>
                  <p className={`font-semibold tabular-nums ${lane.riskCount > 0 ? 'text-rose-700' : ''}`}>{lane.riskCount}건</p>
                </div>
              </div>
              <div className="mt-3 flex min-h-5 flex-wrap gap-1">
                {lane.projects.slice(0, 3).map((project) => (
                  <span key={project.id} className="rounded border border-white/70 bg-white/70 px-1.5 py-0.5 text-[9px] text-slate-700">
                    {project.shortName}
                  </span>
                ))}
                {lane.projects.length > 3 ? (
                  <span className="px-1 py-0.5 text-[9px] opacity-70">+{lane.projects.length - 3}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

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
              <p className="text-[10px] text-red-600">공식 참여율 기준</p>
            </CardContent>
          </Card>
          <Card className={kpis.warning > 0 ? 'border-amber-200 bg-amber-50/40' : ''}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /><span className="text-amber-700">경고</span>
              </div>
              <p className="text-xl text-amber-700" style={{ fontWeight: 600 }}>{kpis.warning}명</p>
              <p className="text-[10px] text-amber-600">공식 참여율 기준</p>
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
                <Shield className="w-3.5 h-3.5 text-blue-600" /><span>e나라도움 프로젝트</span>
              </div>
              <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.eNaraProjects}건</p>
              <p className="text-[10px] text-muted-foreground">시스템 교차검증 대상</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-1.5 text-xs mb-0.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" /><span>KOICA 프로젝트</span>
              </div>
              <p className="text-xl" style={{ fontWeight: 600 }}>{kpis.koicaProjects}건</p>
              <p className="text-[10px] text-muted-foreground">동일 기관 확인</p>
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
                    {formalMemberSummaries.filter(m => m.riskLevel === 'DANGER').map(m => (
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
            <TabsTrigger value="project" className="gap-1"><FolderKanban className="w-3.5 h-3.5" /> 프로젝트별 현황</TabsTrigger>
            <TabsTrigger value="matrix" className="gap-1"><Network className="w-3.5 h-3.5" /> 교차검증 매트릭스</TabsTrigger>
          </TabsList>

          {/* ─── Member View ─── */}
          <TabsContent value="member" className="mt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="이름 또는 프로젝트명 검색…" value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-9 h-8 text-sm" />
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
                    <TableHead className="min-w-[120px]">전체 참여율</TableHead>
                    <TableHead className="min-w-[80px]">e나라도움</TableHead>
                    <TableHead className="min-w-[80px]">회계사정산</TableHead>
                    <TableHead className="min-w-[60px]">민간</TableHead>
                    <TableHead className="text-center">프로젝트 수</TableHead>
                    <TableHead className="min-w-[200px]">리스크</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSummaries.map(m => {
                    const formalSummary = formalSummaryMap.get(m.memberId);
                    const riskLevel = formalSummary?.riskLevel || 'SAFE';
                    const riskDetails = formalSummary?.riskDetails || [];
                    const rc = riskColors[riskLevel];
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
                          {riskDetails.length > 0 ? (
                            <span className="text-[10px] text-red-600 line-clamp-1">{riskDetails[0]}</span>
                          ) : m.entries.some((entry) => entry.source === 'PROJECT_TEAM_SYNC') ? (
                            <span className="text-[10px] text-sky-700">팀 연동 포함</span>
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
                    <TableHead className="min-w-[160px]">프로젝트명</TableHead>
                    <TableHead>원천 구분</TableHead>
                    <TableHead>정산유형</TableHead>
                    <TableHead>계약 대상</TableHead>
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
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {classificationLaneMeta[getClassificationLaneKey(p)].label}
                        </Badge>
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
                                  <Badge
                                    variant={e.source === 'PROJECT_TEAM_SYNC' ? 'secondary' : 'outline'}
                                    className={`text-[10px] gap-0.5 ${e.isDocumentOnly ? 'border-dashed' : ''}`}
                                  >
                                    {name} {e.rate}%
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">
                                  {e.memberName}: {e.rate}% / {e.periodStart}
                                  {' / '}{participationSourceLabel(e)}
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
            <CrossVerificationInfo projects={projectEntries} />
          </TabsContent>
        </Tabs>

        <MemberDetailDialog
          member={selectedMember}
          formalMember={selectedMember ? formalSummaryMap.get(selectedMember.memberId) || null : null}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}
