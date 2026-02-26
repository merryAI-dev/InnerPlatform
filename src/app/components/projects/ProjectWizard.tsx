import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft, ChevronRight,
  CreditCard,
  FileText,
  Save,
  Shield,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAppStore } from '../../data/store';
import type {
  AccountType,
  Basis,
  Project,
  ProjectPhase,
  ProjectStatus,
  ProjectType,
  SettlementType,
} from '../../data/types';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS
} from '../../data/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';
import { Separator } from '../ui/separator';

// ── Step Definitions ──

const STEPS = [
  { id: 'basic', label: '기본 정보', icon: Building2, desc: '사업명, 유형, 발주기관' },
  { id: 'contract', label: '계약/일정', icon: FileText, desc: '계약서, 기간, 상태' },
  { id: 'account', label: '통장/정산', icon: Banknote, desc: '통장구분, 정산유형' },
  { id: 'team', label: '팀/담당자', icon: Users, desc: '팀, 메인 담당자' },
  { id: 'finance', label: '재무 정보', icon: Calculator, desc: '사업비, 수익률' },
  { id: 'payment', label: '입금 계획', icon: CreditCard, desc: '계약금, 중도금, 잔금' },
  { id: 'review', label: '검증 & 확정', icon: Shield, desc: '체크리스트, 제출' },
] as const;

type StepId = typeof STEPS[number]['id'];

// ── Form Data Interface ──

interface WizardFormData {
  // Step 1: Basic
  name: string;
  type: ProjectType;
  department: string;
  clientOrg: string;
  groupwareName: string;
  description: string;
  // Step 2: Contract
  status: ProjectStatus;
  contractType: string;
  contractStart: string;
  contractEnd: string;
  participantCondition: string;
  // Step 3: Account
  accountType: AccountType;
  settlementType: SettlementType;
  basis: Basis;
  // Step 4: Team
  teamName: string;
  managerName: string;
  managerId: string;
  // Step 5: Finance
  contractAmount: number;
  budgetCurrentYear: number;
  taxInvoiceAmount: number;
  profitRate: number;
  profitAmount: number;
  // Step 6: Payment
  paymentContract: number;
  paymentInterim: number;
  paymentFinal: number;
  paymentPlanDesc: string;
  finalPaymentNote: string;
}

const INITIAL_DATA: WizardFormData = {
  name: '', type: 'DEV_COOPERATION', department: '', clientOrg: '', groupwareName: '', description: '',
  status: 'CONTRACT_PENDING', contractType: '계약서(날인)', contractStart: '', contractEnd: '', participantCondition: '',
  accountType: 'NONE', settlementType: 'TYPE1', basis: 'SUPPLY_AMOUNT',
  teamName: '', managerName: '', managerId: '',
  contractAmount: 0, budgetCurrentYear: 0, taxInvoiceAmount: 0, profitRate: 0, profitAmount: 0,
  paymentContract: 0, paymentInterim: 0, paymentFinal: 0, paymentPlanDesc: '', finalPaymentNote: '',
};

const DEPARTMENTS = [
  'L-개발협력센터', 'L-글로벌센터', 'L-디자인팀',
  'C-스템CIC', 'C-모모CIC', 'C-썬CIC',
  'I-공간플랫폼센터', 'I-투자센터',
];

const CONTRACT_TYPES = ['계약서(날인)', '발주기관 전자시스템', '기타'];

// ── Wizard Component ──

interface ProjectWizardProps {
  editProject?: Project;  // for editing existing
  initialPhase?: ProjectPhase;
}

export function ProjectWizard({ editProject, initialPhase = 'PROSPECT' }: ProjectWizardProps) {
  const navigate = useNavigate();
  const { addProject, updateProject, members } = useAppStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [targetPhase, setTargetPhase] = useState<ProjectPhase>(editProject?.phase || initialPhase);
  const [formData, setFormData] = useState<WizardFormData>(() => {
    if (editProject) {
      return {
        name: editProject.name,
        type: editProject.type,
        department: editProject.department,
        clientOrg: editProject.clientOrg,
        groupwareName: editProject.groupwareName,
        description: editProject.description || '',
        status: editProject.status,
        contractType: editProject.contractType,
        contractStart: editProject.contractStart,
        contractEnd: editProject.contractEnd,
        participantCondition: editProject.participantCondition,
        accountType: editProject.accountType,
        settlementType: editProject.settlementType,
        basis: editProject.basis,
        teamName: editProject.teamName,
        managerName: editProject.managerName,
        managerId: editProject.managerId,
        contractAmount: editProject.contractAmount,
        budgetCurrentYear: editProject.budgetCurrentYear,
        taxInvoiceAmount: editProject.taxInvoiceAmount,
        profitRate: editProject.profitRate,
        profitAmount: editProject.profitAmount,
        paymentContract: editProject.paymentPlan.contract,
        paymentInterim: editProject.paymentPlan.interim,
        paymentFinal: editProject.paymentPlan.final,
        paymentPlanDesc: editProject.paymentPlanDesc,
        finalPaymentNote: editProject.finalPaymentNote,
      };
    }
    return INITIAL_DATA;
  });

  const update = useCallback((field: keyof WizardFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateNum = useCallback((field: keyof WizardFormData, value: string) => {
    const num = parseFloat(value.replace(/,/g, '')) || 0;
    setFormData(prev => ({ ...prev, [field]: num }));
  }, []);

  // Auto-calculate profit amount when rate or contract changes
  const calculatedProfit = useMemo(() => {
    return Math.round(formData.contractAmount * formData.profitRate);
  }, [formData.contractAmount, formData.profitRate]);

  // Validation checks
  const validationChecks = useMemo(() => {
    const checks = [
      { id: 'name', label: '사업명', passed: !!formData.name.trim(), required: true },
      { id: 'dept', label: '담당조직', passed: !!formData.department, required: true },
      { id: 'client', label: '발주기관', passed: !!formData.clientOrg.trim(), required: targetPhase === 'CONFIRMED' },
      { id: 'account', label: '통장 구분', passed: formData.accountType !== 'NONE', required: targetPhase === 'CONFIRMED' },
      { id: 'groupware', label: '그룹웨어 등록명', passed: !!formData.groupwareName.trim(), required: targetPhase === 'CONFIRMED' },
      { id: 'manager', label: '메인 담당자', passed: !!formData.managerName.trim(), required: targetPhase === 'CONFIRMED' },
      { id: 'contractAmount', label: '총 계약금액', passed: formData.contractAmount > 0 || formData.status === 'CONTRACT_PENDING', required: targetPhase === 'CONFIRMED' },
      { id: 'paymentPlan', label: '입금 계획', passed: !!formData.paymentPlanDesc.trim() || formData.status === 'CONTRACT_PENDING', required: targetPhase === 'CONFIRMED' },
    ];
    return checks;
  }, [formData, targetPhase]);

  const requiredChecks = validationChecks.filter(c => c.required);
  const passedRequired = requiredChecks.filter(c => c.passed).length;
  const canConfirm = requiredChecks.every(c => c.passed);
  const overallScore = requiredChecks.length > 0 ? Math.round((passedRequired / requiredChecks.length) * 100) : 0;

  // Submit
  const handleSubmit = useCallback((phase: ProjectPhase) => {
    const now = new Date().toISOString();
    const slug = formData.name
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);

    const projectData: Project = {
      id: editProject?.id || `p${Date.now()}`,
      slug: editProject?.slug || slug,
      orgId: 'org001',
      name: formData.name,
      status: formData.status,
      type: formData.type,
      phase: phase,
      contractAmount: formData.contractAmount,
      contractStart: formData.contractStart,
      contractEnd: formData.contractEnd,
      settlementType: formData.settlementType,
      basis: formData.basis,
      accountType: formData.accountType,
      paymentPlan: {
        contract: formData.paymentContract,
        interim: formData.paymentInterim,
        final: formData.paymentFinal,
      },
      paymentPlanDesc: formData.paymentPlanDesc,
      clientOrg: formData.clientOrg,
      groupwareName: formData.groupwareName,
      participantCondition: formData.participantCondition,
      contractType: formData.contractType,
      department: formData.department,
      teamName: formData.teamName,
      managerId: formData.managerId,
      managerName: formData.managerName,
      budgetCurrentYear: formData.budgetCurrentYear,
      taxInvoiceAmount: formData.taxInvoiceAmount,
      profitRate: formData.profitRate,
      profitAmount: formData.profitAmount || calculatedProfit,
      isSettled: false,
      finalPaymentNote: formData.finalPaymentNote,
      confirmerName: '',
      lastCheckedAt: '',
      cashflowDiffNote: '',
      description: formData.description,
      createdAt: editProject?.createdAt || now,
      updatedAt: now,
    };

    if (editProject) {
      updateProject(editProject.id, projectData);
      toast.success(phase === 'CONFIRMED' ? '사업이 확정되었습니다' : '사업 정보가 저장되었습니다');
    } else {
      addProject(projectData);
      toast.success(phase === 'CONFIRMED' ? '확정 사업이 등록되었습니다' : '예정 사업이 등록되었습니다');
    }
    navigate('/projects');
  }, [formData, calculatedProfit, editProject, addProject, updateProject, navigate]);

  // Format number input
  const fmtInput = (n: number) => n > 0 ? n.toLocaleString('ko-KR') : '';
  const fmtKRW = (n: number) => n.toLocaleString('ko-KR') + '원';

  // ── Render Steps ──

  const renderStep = () => {
    switch (STEPS[currentStep].id) {
      case 'basic':
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>사업명 *</Label>
              <Input
                value={formData.name}
                onChange={e => update('name', e.target.value)}
                placeholder="예: KOICA 이노포트 사업 (2023~2025)"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>사업유형 *</Label>
                <select
                  value={formData.type}
                  onChange={e => update('type', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>담당조직 *</Label>
                <select
                  value={formData.department}
                  onChange={e => update('department', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">선택하세요</option>
                  {DEPARTMENTS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>발주기관 (계약기관)</Label>
                <Input
                  value={formData.clientOrg}
                  onChange={e => update('clientOrg', e.target.value)}
                  placeholder="예: KOICA, 아름다운재단"
                />
              </div>
              <div className="space-y-2">
                <Label>그룹웨어 프로젝트등록명</Label>
                <Input
                  value={formData.groupwareName}
                  onChange={e => update('groupwareName', e.target.value)}
                  placeholder="예: IBS그린임팩트펀드"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>사업 설명</Label>
              <textarea
                value={formData.description}
                onChange={e => update('description', e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="사업 개요를 입력하세요"
              />
            </div>
          </div>
        );

      case 'contract':
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>사업진행상태</Label>
                <select
                  value={formData.status}
                  onChange={e => update('status', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">계약 전인 경우 "계약전"으로 설정</p>
              </div>
              <div className="space-y-2">
                <Label>계약서 유형</Label>
                <select
                  value={formData.contractType}
                  onChange={e => update('contractType', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {CONTRACT_TYPES.map(ct => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>계약 시작일</Label>
                <Input
                  type="date"
                  value={formData.contractStart}
                  onChange={e => update('contractStart', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>계약 종료일</Label>
                <Input
                  type="date"
                  value={formData.contractEnd}
                  onChange={e => update('contractEnd', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>참여기업 조건 (AC 해당 시)</Label>
              <Input
                value={formData.participantCondition}
                onChange={e => update('participantCondition', e.target.value)}
                placeholder="예: 업력 10년 이내 국내 스타트업"
              />
            </div>
            {formData.status === 'CONTRACT_PENDING' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800">
                  <span style={{ fontWeight: 600 }}>계약전 사업 안내:</span> 금액이 확정되지 않더라도 총 계약금액과 캐시플로 예상 입금시기를 입력해주세요.
                  사업 선정 후 1주일 이내에 등록해야 합니다.
                </p>
              </div>
            )}
          </div>
        );

      case 'account':
        return (
          <div className="space-y-5">
            <div className="space-y-3">
              <Label>전용통장 / 운영통장 여부 *</Label>
              <div className="grid grid-cols-3 gap-3">
                {(['DEDICATED', 'OPERATING', 'NONE'] as AccountType[]).map(at => (
                  <button
                    key={at}
                    onClick={() => update('accountType', at)}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${formData.accountType === at
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                      }`}
                  >
                    <div className="text-sm" style={{ fontWeight: 600 }}>
                      {ACCOUNT_TYPE_LABELS[at]}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {at === 'DEDICATED' && '사업 전용 통장을 사용합니다'}
                      {at === 'OPERATING' && '운영통장에서 관리합니다'}
                      {at === 'NONE' && '아직 결정되지 않았습니다'}
                    </div>
                  </button>
                ))}
              </div>
              {formData.accountType !== 'NONE' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  <span style={{ fontWeight: 600 }}>중요:</span> 운영통장으로 입금/출금되는 Big Money는 반드시 추적 관리됩니다.
                </div>
              )}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>정산유형</Label>
                <select
                  value={formData.settlementType}
                  onChange={e => update('settlementType', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {Object.entries(SETTLEMENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>사업비 사용 기준</Label>
                <select
                  value={formData.basis}
                  onChange={e => update('basis', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  {Object.entries(BASIS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        );

      case 'team':
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>사내기업팀 (팀장)</Label>
              <Input
                value={formData.teamName}
                onChange={e => update('teamName', e.target.value)}
                placeholder="예: 8팀(데이나), Joint Business"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>메인 담당자</Label>
                <Input
                  value={formData.managerName}
                  onChange={e => update('managerName', e.target.value)}
                  placeholder="예: 베리, 데이나"
                />
              </div>
              <div className="space-y-2">
                <Label>담당자 계정</Label>
                <select
                  value={formData.managerId}
                  onChange={e => update('managerId', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">선택하세요</option>
                  {members.filter(m => m.role === 'pm').map(m => (
                    <option key={m.uid} value={m.uid}>{m.name} ({m.email})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
              <span style={{ fontWeight: 600 }}>Joint Action 참고:</span> 메인 PM이 있는 그룹/센터장이 확인자로 지정됩니다.
            </div>
          </div>
        );

      case 'finance':
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>총 사업비 금액 (매출부가세 포함)</Label>
              <div className="relative">
                <Input
                  value={fmtInput(formData.contractAmount)}
                  onChange={e => updateNum('contractAmount', e.target.value)}
                  placeholder="0"
                  className="pr-8"
                />
                <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
              </div>
              {formData.contractAmount > 0 && (
                <p className="text-xs text-muted-foreground">{fmtKRW(formData.contractAmount)}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>2026년 총사업비 (매출부가세 포함)</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.budgetCurrentYear)}
                    onChange={e => updateNum('budgetCurrentYear', e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>세금계산서 금액 (매출부가세 포함)</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.taxInvoiceAmount)}
                    onChange={e => updateNum('taxInvoiceAmount', e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  지원금·기부금처럼 매출세금계산서를 발행하지 않는 금액 제외
                </p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>수익률 (소수점 둘째자리까지)</Label>
                <div className="relative">
                  <Input
                    value={formData.profitRate > 0 ? (formData.profitRate * 100).toFixed(2) : ''}
                    onChange={e => {
                      const pct = parseFloat(e.target.value) || 0;
                      update('profitRate', pct / 100);
                    }}
                    placeholder="0.00"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>수익금액</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.profitAmount || calculatedProfit)}
                    onChange={e => updateNum('profitAmount', e.target.value)}
                    placeholder="자동 계산"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
                {calculatedProfit > 0 && !formData.profitAmount && (
                  <p className="text-xs text-muted-foreground">자동 계산: {fmtKRW(calculatedProfit)}</p>
                )}
              </div>
            </div>
          </div>
        );

      case 'payment':
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>계약금</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.paymentContract)}
                    onChange={e => updateNum('paymentContract', e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>중도금</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.paymentInterim)}
                    onChange={e => updateNum('paymentInterim', e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>잔금</Label>
                <div className="relative">
                  <Input
                    value={fmtInput(formData.paymentFinal)}
                    onChange={e => updateNum('paymentFinal', e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-2 text-sm text-muted-foreground">원</span>
                </div>
              </div>
            </div>
            {/* Sum check */}
            {formData.contractAmount > 0 && (
              <div className={`rounded-lg p-3 text-xs ${(formData.paymentContract + formData.paymentInterim + formData.paymentFinal) === formData.contractAmount
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
                }`}>
                입금계획 합계: {fmtKRW(formData.paymentContract + formData.paymentInterim + formData.paymentFinal)}
                {' / '}총 사업비: {fmtKRW(formData.contractAmount)}
                {(formData.paymentContract + formData.paymentInterim + formData.paymentFinal) === formData.contractAmount
                  ? ' — 일치'
                  : ' — 차이 있음'}
              </div>
            )}
            <div className="space-y-2">
              <Label>입금 계획 설명</Label>
              <Input
                value={formData.paymentPlanDesc}
                onChange={e => update('paymentPlanDesc', e.target.value)}
                placeholder="예: 선금80%, 잔금20%"
              />
            </div>
            <div className="space-y-2">
              <Label>잔금입금 여부 / 메모</Label>
              <Input
                value={formData.finalPaymentNote}
                onChange={e => update('finalPaymentNote', e.target.value)}
                placeholder="예: 2025년 10월 중 예정"
              />
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-5">
            {/* Phase Selection */}
            <div className="space-y-3">
              <Label>등록 유형</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setTargetPhase('PROSPECT')}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${targetPhase === 'PROSPECT'
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-border hover:border-amber-300'
                    }`}
                >
                  <div className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    입찰/예정 사업
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    아직 확정되지 않은 사업을 임시 등록합니다
                  </p>
                </button>
                <button
                  onClick={() => setTargetPhase('CONFIRMED')}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${targetPhase === 'CONFIRMED'
                      ? 'border-green-500 bg-green-50'
                      : 'border-border hover:border-green-300'
                    } ${!canConfirm ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    확정 사업
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    대시보드에 등록하고 관리를 시작합니다
                  </p>
                  {!canConfirm && (
                    <p className="text-xs text-red-600 mt-1">필수 항목 미입력</p>
                  )}
                </button>
              </div>
            </div>

            <Separator />

            {/* Validation Checklist */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>검증 체크리스트</Label>
                <Badge variant="outline" className={`text-xs ${overallScore === 100 ? 'text-green-700' : 'text-amber-700'}`}>
                  {passedRequired}/{requiredChecks.length} 완료 ({overallScore}%)
                </Badge>
              </div>
              <Progress value={overallScore} className="h-2" />
              <div className="space-y-1.5">
                {validationChecks.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    {c.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    ) : c.required ? (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <span className={c.passed ? 'text-muted-foreground' : ''}>
                      {c.label}
                      {c.required && <span className="text-red-500 ml-0.5">*</span>}
                    </span>
                    {c.passed && <Check className="w-3 h-3 text-green-600 ml-auto" />}
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Summary */}
            <div className="space-y-3">
              <Label>입력 요약</Label>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm bg-muted/30 rounded-lg p-4">
                <div>
                  <span className="text-muted-foreground">사업명:</span>
                  <span className="ml-2" style={{ fontWeight: 500 }}>{formData.name || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">담당조직:</span>
                  <span className="ml-2">{formData.department || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">발주기관:</span>
                  <span className="ml-2">{formData.clientOrg || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">통장:</span>
                  <span className="ml-2">{ACCOUNT_TYPE_LABELS[formData.accountType]}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">총 사업비:</span>
                  <span className="ml-2" style={{ fontWeight: 500 }}>{formData.contractAmount > 0 ? fmtKRW(formData.contractAmount) : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">정산유형:</span>
                  <span className="ml-2">{SETTLEMENT_TYPE_LABELS[formData.settlementType]}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">메인 담당:</span>
                  <span className="ml-2">{formData.managerName || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">수익률:</span>
                  <span className="ml-2">{formData.profitRate > 0 ? `${(formData.profitRate * 100).toFixed(2)}%` : '-'}</span>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          뒤로
        </Button>
        <div>
          <h1 className="text-xl">
            {editProject ? '사업 정보 수정' : '새 사업 등록'}
            {editProject?.phase === 'PROSPECT' && (
              <Badge className="ml-2 text-xs bg-amber-100 text-amber-800" variant="secondary">→ 확정 전환 가능</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {editProject
              ? `${editProject.name} 정보를 수정합니다`
              : '위저드를 따라 사업 정보를 입력하세요'}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((step, i) => {
          const StepIcon = step.icon;
          const isActive = i === currentStep;
          const isCompleted = i < currentStep;
          return (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => setCurrentStep(i)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all ${isActive
                    ? 'bg-primary text-primary-foreground'
                    : isCompleted
                      ? 'bg-green-100 text-green-800'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
              >
                {isCompleted ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <StepIcon className="w-3 h-3" />
                )}
                <span className="hidden md:inline">{step.label}</span>
                <span className="md:hidden">{i + 1}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`w-4 h-px mx-0.5 ${i < currentStep ? 'bg-green-400' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            {(() => {
              const StepIcon = STEPS[currentStep].icon;
              return <StepIcon className="w-5 h-5 text-primary" />;
            })()}
            {STEPS[currentStep].label}
            <span className="text-sm text-muted-foreground" style={{ fontWeight: 400 }}>
              — {STEPS[currentStep].desc}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renderStep()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          이전
        </Button>

        <div className="flex items-center gap-2">
          {currentStep === STEPS.length - 1 ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleSubmit('PROSPECT')}
                className="gap-1"
              >
                <Save className="w-4 h-4" />
                예정 사업으로 저장
              </Button>
              <Button
                onClick={() => handleSubmit('CONFIRMED')}
                disabled={!canConfirm}
                className="gap-1"
              >
                <CheckCircle2 className="w-4 h-4" />
                확정 등록
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setCurrentStep(Math.min(STEPS.length - 1, currentStep + 1))}
              className="gap-1"
            >
              다음
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
