import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  FolderKanban, ArrowLeft, ArrowRight, CheckCircle2,
  Building2, Calendar, Wallet, FileText,
  Users, Briefcase, ClipboardList, AlertTriangle,
  Zap, Send,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { usePortalStore } from '../../data/portal-store';
import {
  PROJECT_TYPE_LABELS, SETTLEMENT_TYPE_LABELS, ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  type ProjectType, type SettlementType, type AccountType, type Basis,
} from '../../data/types';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════════
// PortalProjectRegister — 포털 사용자의 사업 등록 제안
// 간소화된 사업 등록 폼 → PENDING 상태로 admin에게 전달
// ═══════════════════════════════════════════════════════════════

type Step = 'basic' | 'financial' | 'team' | 'review';

const STEPS: { key: Step; label: string; icon: typeof FolderKanban }[] = [
  { key: 'basic', label: '기본 정보', icon: FolderKanban },
  { key: 'financial', label: '재무 정보', icon: Wallet },
  { key: 'team', label: '팀 구성', icon: Users },
  { key: 'review', label: '검토 및 제출', icon: ClipboardList },
];

interface ProjectProposal {
  name: string;
  type: ProjectType;
  description: string;
  clientOrg: string;
  department: string;
  contractAmount: number;
  contractStart: string;
  contractEnd: string;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  paymentPlanDesc: string;
  managerName: string;
  teamName: string;
  teamMembers: string;
  participantCondition: string;
  note: string;
}

const initialProposal: ProjectProposal = {
  name: '',
  type: 'DEV_COOPERATION',
  description: '',
  clientOrg: '',
  department: '',
  contractAmount: 0,
  contractStart: '',
  contractEnd: '',
  settlementType: 'TYPE1',
  basis: 'SUPPLY_AMOUNT',
  accountType: 'DEDICATED',
  paymentPlanDesc: '',
  managerName: '',
  teamName: '',
  teamMembers: '',
  participantCondition: '',
  note: '',
};

export function PortalProjectRegister() {
  const navigate = useNavigate();
  const { portalUser } = usePortalStore();
  const [step, setStep] = useState<Step>('basic');
  const [form, setForm] = useState<ProjectProposal>({
    ...initialProposal,
    managerName: portalUser?.name || '',
  });
  const [submitted, setSubmitted] = useState(false);

  const currentStepIdx = STEPS.findIndex(s => s.key === step);
  const canProceed = () => {
    if (step === 'basic') return form.name && form.clientOrg && form.type;
    if (step === 'financial') return form.contractAmount > 0 && form.contractStart && form.contractEnd;
    if (step === 'team') return form.managerName;
    return true;
  };

  const handleSubmit = () => {
    setSubmitted(true);
    toast.success('사업 등록 제안이 관리자에게 전달되었습니다');
  };

  const fmtKRW = (n: number) => {
    if (!n) return '0';
    return n.toLocaleString('ko-KR');
  };

  const update = (key: keyof ProjectProposal, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
        >
          <CheckCircle2 className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-[18px] mb-2" style={{ fontWeight: 700 }}>사업 등록 제안 완료</h2>
        <p className="text-[13px] text-muted-foreground mb-1">
          <span style={{ fontWeight: 600 }}>"{form.name}"</span> 사업 등록 제안이 성공적으로 전달되었습니다.
        </p>
        <p className="text-[12px] text-muted-foreground mb-6">
          관리자가 검토 후 승인/반려 결과를 알려드립니다.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/portal')}>대시보드로</Button>
          <Button onClick={() => { setSubmitted(false); setForm({ ...initialProposal, managerName: portalUser?.name || '' }); setStep('basic'); }}>
            추가 등록
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 text-[12px] gap-1" onClick={() => navigate('/portal')}>
          <ArrowLeft className="w-3.5 h-3.5" /> 돌아가기
        </Button>
      </div>

      <div>
        <h1 className="text-[18px]" style={{ fontWeight: 700 }}>사업 등록 제안</h1>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          새로운 사업을 등록하려면 아래 정보를 입력해 주세요. 관리자 승인 후 포털에서 관리할 수 있습니다.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const isCurrent = s.key === step;
          const isDone = i < currentStepIdx;
          return (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <button
                onClick={() => {
                  if (i <= currentStepIdx) setStep(s.key);
                }}
                className={`
                  flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] w-full transition-colors
                  ${isCurrent ? 'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-800/40' :
                    isDone ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400' :
                    'bg-muted/30 text-muted-foreground'}
                `}
                style={{ fontWeight: isCurrent ? 600 : 400 }}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[9px] ${
                  isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground'
                }`} style={{ fontWeight: 700 }}>
                  {isDone ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 min-w-[16px] ${isDone ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-5">
          {step === 'basic' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <FolderKanban className="w-4 h-4 text-teal-600" />
                <h3 className="text-[14px]" style={{ fontWeight: 600 }}>기본 정보</h3>
              </div>

              <div>
                <Label className="text-[11px]">사업명 *</Label>
                <Input
                  value={form.name}
                  onChange={e => update('name', e.target.value)}
                  placeholder="예: KOICA 르완다 기술혁신 역량강화 사업"
                  className="h-9 text-[12px] mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">사업 유형 *</Label>
                  <Select value={form.type} onValueChange={v => update('type', v)}>
                    <SelectTrigger className="h-9 text-[12px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(PROJECT_TYPE_LABELS) as [ProjectType, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">발주기관 *</Label>
                  <Input
                    value={form.clientOrg}
                    onChange={e => update('clientOrg', e.target.value)}
                    placeholder="예: KOICA"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px]">담당조직</Label>
                <Input
                  value={form.department}
                  onChange={e => update('department', e.target.value)}
                  placeholder="예: 임팩트 이노베이션 그룹"
                  className="h-9 text-[12px] mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px]">사업 설명</Label>
                <Textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  placeholder="사업 목적, 주요 내용 등"
                  className="text-[12px] mt-1 min-h-[80px]"
                />
              </div>
            </div>
          )}

          {step === 'financial' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-teal-600" />
                <h3 className="text-[14px]" style={{ fontWeight: 600 }}>재무 정보</h3>
              </div>

              <div>
                <Label className="text-[11px]">총 사업비 (원) *</Label>
                <Input
                  type="number"
                  value={form.contractAmount || ''}
                  onChange={e => update('contractAmount', Number(e.target.value) || 0)}
                  placeholder="0"
                  className="h-9 text-[12px] mt-1"
                />
                {form.contractAmount > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{fmtKRW(form.contractAmount)}원</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">사업 시작일 *</Label>
                  <Input
                    type="date"
                    value={form.contractStart}
                    onChange={e => update('contractStart', e.target.value)}
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">사업 종료일 *</Label>
                  <Input
                    type="date"
                    value={form.contractEnd}
                    onChange={e => update('contractEnd', e.target.value)}
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">정산유형</Label>
                  <Select value={form.settlementType} onValueChange={v => update('settlementType', v)}>
                    <SelectTrigger className="h-9 text-[12px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SETTLEMENT_TYPE_LABELS) as [SettlementType, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">기준</Label>
                  <Select value={form.basis} onValueChange={v => update('basis', v)}>
                    <SelectTrigger className="h-9 text-[12px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(BASIS_LABELS) as [Basis, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">통장 유형</Label>
                  <Select value={form.accountType} onValueChange={v => update('accountType', v)}>
                    <SelectTrigger className="h-9 text-[12px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">입금계획</Label>
                  <Input
                    value={form.paymentPlanDesc}
                    onChange={e => update('paymentPlanDesc', e.target.value)}
                    placeholder="예: 선금80%, 잔금20%"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-teal-600" />
                <h3 className="text-[14px]" style={{ fontWeight: 600 }}>팀 구성</h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">PM (메인 담당자) *</Label>
                  <Input
                    value={form.managerName}
                    onChange={e => update('managerName', e.target.value)}
                    placeholder="메인 담당자명"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">팀명 (팀장)</Label>
                  <Input
                    value={form.teamName}
                    onChange={e => update('teamName', e.target.value)}
                    placeholder="예: 혁신팀 (홍길동)"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px]">팀원 구성</Label>
                <Textarea
                  value={form.teamMembers}
                  onChange={e => update('teamMembers', e.target.value)}
                  placeholder="투입 예정 인력 (이름, 역할 등)"
                  className="text-[12px] mt-1 min-h-[60px]"
                />
              </div>

              <div>
                <Label className="text-[11px]">참여기업 조건</Label>
                <Input
                  value={form.participantCondition}
                  onChange={e => update('participantCondition', e.target.value)}
                  placeholder="참여기업 자격 조건"
                  className="h-9 text-[12px] mt-1"
                />
              </div>

              <div>
                <Label className="text-[11px]">추가 메모</Label>
                <Textarea
                  value={form.note}
                  onChange={e => update('note', e.target.value)}
                  placeholder="관리자에게 전달할 사항"
                  className="text-[12px] mt-1 min-h-[60px]"
                />
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="w-4 h-4 text-teal-600" />
                <h3 className="text-[14px]" style={{ fontWeight: 600 }}>검토 및 제출</h3>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                제출 후에는 수정이 불가합니다. 정보를 다시 확인해 주세요.
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 기본 정보 */}
                <Card className="border-border/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[11px] flex items-center gap-1.5">
                      <FolderKanban className="w-3.5 h-3.5 text-teal-600" />
                      기본 정보
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <ReviewRow label="사업명" value={form.name} />
                    <ReviewRow label="유형" value={PROJECT_TYPE_LABELS[form.type]} />
                    <ReviewRow label="발주기관" value={form.clientOrg} />
                    <ReviewRow label="담당조직" value={form.department || '-'} />
                    {form.description && <ReviewRow label="설명" value={form.description} />}
                  </CardContent>
                </Card>

                {/* 재무 정보 */}
                <Card className="border-border/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[11px] flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-teal-600" />
                      재무 정보
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <ReviewRow label="총 사업비" value={`${fmtKRW(form.contractAmount)}원`} highlight />
                    <ReviewRow label="사업기간" value={`${form.contractStart} ~ ${form.contractEnd}`} />
                    <ReviewRow label="정산유형" value={SETTLEMENT_TYPE_LABELS[form.settlementType]} />
                    <ReviewRow label="기준" value={BASIS_LABELS[form.basis]} />
                    <ReviewRow label="통장유형" value={ACCOUNT_TYPE_LABELS[form.accountType]} />
                    {form.paymentPlanDesc && <ReviewRow label="입금계획" value={form.paymentPlanDesc} />}
                  </CardContent>
                </Card>

                {/* 팀 정보 */}
                <Card className="border-border/40 md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[11px] flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-teal-600" />
                      팀 구성
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <ReviewRow label="PM" value={form.managerName} />
                    {form.teamName && <ReviewRow label="팀명" value={form.teamName} />}
                    {form.teamMembers && <ReviewRow label="팀원" value={form.teamMembers} />}
                    {form.participantCondition && <ReviewRow label="참여조건" value={form.participantCondition} />}
                    {form.note && <ReviewRow label="메모" value={form.note} />}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-[12px] gap-1"
          disabled={currentStepIdx === 0}
          onClick={() => setStep(STEPS[currentStepIdx - 1].key)}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </Button>

        {step === 'review' ? (
          <Button
            size="sm"
            className="h-9 text-[12px] gap-1.5"
            style={{ background: 'linear-gradient(135deg, #0d9488, #059669)' }}
            onClick={handleSubmit}
          >
            <Send className="w-3.5 h-3.5" /> 관리자에게 제출
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-9 text-[12px] gap-1"
            disabled={!canProceed()}
            onClick={() => setStep(STEPS[currentStepIdx + 1].key)}
          >
            다음 <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-muted-foreground shrink-0 w-[70px]">{label}</span>
      <span className={highlight ? 'text-teal-600 dark:text-teal-400' : ''} style={{ fontWeight: highlight ? 600 : 500 }}>
        {value}
      </span>
    </div>
  );
}
