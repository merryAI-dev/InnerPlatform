import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  FolderKanban, ArrowLeft, ArrowRight, CheckCircle2,
  Building2, Calendar, Wallet, FileText,
  Users, Briefcase, ClipboardList, AlertTriangle,
  Loader2, Send, Upload,
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
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { getStorageInstance } from '../../lib/firebase';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import {
  PROJECT_TYPE_LABELS, SETTLEMENT_TYPE_LABELS, ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  type ProjectType,
} from '../../data/types';
import { toast } from 'sonner';
import { type ProjectProposalDraft } from './project-proposal';
import { PROJECT_DEPARTMENT_OPTIONS } from '../../data/project-department-options';

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

const initialProposal: ProjectProposalDraft = {
  name: '',
  officialContractName: '',
  type: 'D1',
  description: '',
  clientOrg: '',
  department: '',
  contractAmount: 0,
  salesVatAmount: 0,
  totalRevenueAmount: 0,
  supportAmount: 0,
  contractStart: '',
  contractEnd: '',
  settlementType: 'TYPE1',
  basis: 'SUPPLY_AMOUNT',
  accountType: 'DEDICATED',
  paymentPlanDesc: '',
  settlementGuide: '',
  projectPurpose: '',
  managerName: '',
  teamName: '',
  teamMembers: '',
  participantCondition: '',
  note: '',
  contractDocument: null,
};

export function PortalProjectRegister() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const { portalUser, projects, createProjectRequest } = usePortalStore();
  const [step, setStep] = useState<Step>('basic');
  const [form, setForm] = useState<ProjectProposalDraft>({
    ...initialProposal,
    managerName: portalUser?.name || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isUploadingContract, setIsUploadingContract] = useState(false);
  const contractFileInputRef = useRef<HTMLInputElement | null>(null);

  const currentStepIdx = STEPS.findIndex(s => s.key === step);
  const canProceed = () => {
    if (step === 'basic') return form.name.trim() && form.officialContractName.trim() && form.clientOrg.trim() && form.type && form.department;
    if (step === 'financial') return form.contractAmount > 0 && form.contractStart && form.contractEnd;
    if (step === 'team') return form.managerName;
    return true;
  };

  const handleContractDocumentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error('계약서 파일은 PDF로 업로드해 주세요.');
      return;
    }
    if (!authUser?.uid) {
      toast.error('로그인 정보를 확인할 수 없습니다.');
      return;
    }
    const storage = getStorageInstance();
    if (!storage) {
      toast.error('파일 업로드를 위한 저장소를 초기화할 수 없습니다.');
      return;
    }

    setIsUploadingContract(true);
    try {
      const uploadedAt = new Date().toISOString();
      const safeName = file.name.replace(/[^\w.\-가-힣() ]+/g, '_');
      const path = `orgs/${orgId}/project-request-contracts/${authUser.uid}/${Date.now()}-${safeName}`;
      const ref = storageRef(storage, path);
      const snapshot = await uploadBytes(ref, file, {
        contentType: file.type || 'application/pdf',
      });
      const downloadURL = await getDownloadURL(snapshot.ref);
      update('contractDocument', {
        path,
        name: file.name,
        downloadURL,
        size: file.size,
        contentType: file.type || 'application/pdf',
        uploadedAt,
      });
      toast.success(`계약서 업로드 완료: ${file.name}`);
    } catch (error) {
      console.error('[PortalProjectRegister] contract upload failed:', error);
      toast.error('계약서 업로드에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setIsUploadingContract(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!form.contractDocument) {
      setStep('financial');
      toast.error('계약서 등 PDF를 업로드해 주세요.');
      return;
    }
    setIsSubmitting(true);

    try {
      const createdId = await createProjectRequest(form);
      if (!createdId) {
        toast.error('사업 등록 제안 저장에 실패했습니다. 다시 시도해 주세요.');
        return;
      }

      setSubmitted(true);
      toast.success('사업 등록 제안이 저장되었습니다. 관리자 검토를 기다려주세요.');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '사업 등록 제안 저장에 실패했습니다');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fmtKRW = (n: number) => {
    if (!n) return '0';
    return n.toLocaleString('ko-KR');
  };

  const update = (key: keyof ProjectProposalDraft, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };
  const projectNameOptions = Array.from(new Set(projects.map((project) => String(project.name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
  const clientOrgOptions = Array.from(new Set(projects.map((project) => String(project.clientOrg || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));

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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">신청자(별명)</Label>
                  <Input
                    value={portalUser?.name || authUser?.name || ''}
                    readOnly
                    className="h-9 text-[12px] mt-1 bg-muted/40"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">담당팀 *</Label>
                  <Select
                    value={form.department || undefined}
                    onValueChange={(value) => update('department', value)}
                  >
                    <SelectTrigger className="h-9 text-[12px] mt-1">
                      <SelectValue placeholder="담당팀 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_DEPARTMENT_OPTIONS.map((department) => (
                        <SelectItem key={department} value={department}>
                          {department}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-[11px]">공식 계약명 *</Label>
                <Input
                  value={form.officialContractName}
                  onChange={e => update('officialContractName', e.target.value)}
                  placeholder="계약서 상의 공식 명칭을 그대로 입력해 주세요. 헷갈리면 OCR/PDF 제목 기준으로 적어도 괜찮습니다."
                  className="h-9 text-[12px] mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  계약서 상의 공식 명칭이라고 꼭 명시해 주세요. 헷갈리면 OCR/PDF 제목 기준으로 적어도 괜찮습니다.
                </p>
              </div>

              <div>
                <Label className="text-[11px]">등록 프로젝트명 (10글자 이내) *</Label>
                <datalist id="project-name-options">
                  {projectNameOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <Input
                  value={form.name}
                  onChange={e => update('name', e.target.value.slice(0, 10))}
                  placeholder="예: 뷰티풀커넥트"
                  list="project-name-options"
                  className="h-9 text-[12px] mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">{form.name.length}/10자</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px]">프로젝트 유형 *</Label>
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
                  <Label className="text-[11px]">계약 대상 *</Label>
                  <datalist id="client-org-options">
                    {clientOrgOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <Input
                    value={form.clientOrg}
                    onChange={e => update('clientOrg', e.target.value)}
                    placeholder="예: KOICA, 서울시, 아모레퍼시픽재단"
                    list="client-org-options"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px]">프로젝트 목적</Label>
                <Textarea
                  value={form.projectPurpose}
                  onChange={e => update('projectPurpose', e.target.value)}
                  placeholder="예: 어떤 대상에게 어떤 가치를 제공하는 사업인지 적어 주세요."
                  className="text-[12px] mt-1 min-h-[72px]"
                />
              </div>

              <div>
                <Label className="text-[11px]">프로젝트 주요 내용</Label>
                <Textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  placeholder="프로젝트 주요 수행 내용, 범위, 산출물 등을 적어 주세요."
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
                <Label className="text-[11px]">계약금액 (계약서 내 기재된 총 금액) *</Label>
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
                  <Label className="text-[11px]">계약 시작일 *</Label>
                  <Input
                    type="date"
                    value={form.contractStart}
                    onChange={e => update('contractStart', e.target.value)}
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">계약 종료일 *</Label>
                  <Input
                    type="date"
                    value={form.contractEnd}
                    onChange={e => update('contractEnd', e.target.value)}
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-[11px]">매출 부가세</Label>
                  <Input
                    type="number"
                    value={form.salesVatAmount || ''}
                    onChange={e => update('salesVatAmount', Number(e.target.value) || 0)}
                    placeholder="0"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">총수익</Label>
                  <Input
                    type="number"
                    value={form.totalRevenueAmount || ''}
                    onChange={e => update('totalRevenueAmount', Number(e.target.value) || 0)}
                    placeholder="0"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">지원금</Label>
                  <Input
                    type="number"
                    value={form.supportAmount || ''}
                    onChange={e => update('supportAmount', Number(e.target.value) || 0)}
                    placeholder="0"
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
                  <Label className="text-[11px]">선금/중도금/잔금 비율(%) 및 금액, 입금예상시점</Label>
                  <Input
                    value={form.paymentPlanDesc}
                    onChange={e => update('paymentPlanDesc', e.target.value)}
                    placeholder="예: 선금 50%(5천만원, 4월), 잔금 50%(6월 예정)"
                    className="h-9 text-[12px] mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px]">사업비 수령 방식 및 정산 기준</Label>
                <Textarea
                  value={form.settlementGuide}
                  onChange={e => update('settlementGuide', e.target.value)}
                  placeholder="예: 이나라도움 수령, 공급가액 기준, 선지급 후 정산"
                  className="text-[12px] mt-1 min-h-[72px]"
                />
              </div>

              <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-600" />
                  <div>
                    <p className="text-[12px]" style={{ fontWeight: 600 }}>계약서 등 (PDF로 업로드) *</p>
                    <p className="text-[11px] text-muted-foreground">
                      계약이 확정되었다는 서류를 업로드해 주세요. 날인이 되어 있지 않아도 됩니다.
                    </p>
                  </div>
                </div>
                <input
                  ref={contractFileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={handleContractDocumentSelect}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 text-[12px] gap-1.5"
                    onClick={() => contractFileInputRef.current?.click()}
                    disabled={isUploadingContract}
                  >
                    {isUploadingContract ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isUploadingContract ? '업로드 중...' : 'PDF 업로드'}
                  </Button>
                  {form.contractDocument && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 text-[12px]"
                      onClick={() => update('contractDocument', null)}
                    >
                      첨부 제거
                    </Button>
                  )}
                </div>
                {form.contractDocument ? (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] space-y-1">
                    <div style={{ fontWeight: 600 }}>{form.contractDocument.name}</div>
                    <div className="text-muted-foreground">
                      {(form.contractDocument.size / 1024 / 1024).toFixed(2)} MB · {form.contractDocument.uploadedAt.slice(0, 10)}
                    </div>
                    <a
                      href={form.contractDocument.downloadURL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-600 hover:underline"
                    >
                      업로드된 파일 보기
                    </a>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-700">제출 전까지 PDF 1개 업로드가 필요합니다.</p>
                )}
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
                <Label className="text-[11px]">기타 참고사항</Label>
                <Textarea
                  value={form.note}
                  onChange={e => update('note', e.target.value)}
                  placeholder="관리자에게 전달할 추가 참고사항"
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
              {!form.contractDocument && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
                  계약서 등 PDF가 아직 업로드되지 않았습니다. 이전 단계로 돌아가 첨부 후 제출해 주세요.
                </div>
              )}

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
                    <ReviewRow label="신청자" value={portalUser?.name || authUser?.name || '-'} />
                    <ReviewRow label="공식계약명" value={form.officialContractName} />
                    <ReviewRow label="등록명" value={form.name} />
                    <ReviewRow label="유형" value={PROJECT_TYPE_LABELS[form.type]} />
                    <ReviewRow label="계약대상" value={form.clientOrg} />
                    <ReviewRow label="담당팀" value={form.department || '-'} />
                    {form.projectPurpose && <ReviewRow label="목적" value={form.projectPurpose} />}
                    {form.description && <ReviewRow label="주요내용" value={form.description} />}
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
                    <ReviewRow label="계약금액" value={`${fmtKRW(form.contractAmount)}원`} highlight />
                    <ReviewRow label="매출부가세" value={`${fmtKRW(form.salesVatAmount)}원`} />
                    <ReviewRow label="총수익" value={`${fmtKRW(form.totalRevenueAmount)}원`} />
                    <ReviewRow label="지원금" value={`${fmtKRW(form.supportAmount)}원`} />
                    <ReviewRow label="계약기간" value={`${form.contractStart} ~ ${form.contractEnd}`} />
                    <ReviewRow label="정산유형" value={SETTLEMENT_TYPE_LABELS[form.settlementType]} />
                    <ReviewRow label="기준" value={BASIS_LABELS[form.basis]} />
                    <ReviewRow label="통장유형" value={ACCOUNT_TYPE_LABELS[form.accountType]} />
                    {form.paymentPlanDesc && <ReviewRow label="입금계획" value={form.paymentPlanDesc} />}
                    {form.settlementGuide && <ReviewRow label="수령/정산" value={form.settlementGuide} />}
                    <ReviewRow label="첨부파일" value={form.contractDocument?.name || '미업로드'} />
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
            disabled={isSubmitting || !form.contractDocument}
          >
            <Send className="w-3.5 h-3.5" /> {isSubmitting ? '제출 중...' : '관리자에게 제출'}
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
