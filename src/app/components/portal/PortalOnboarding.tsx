import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import {
  FolderKanban, User, Mail, Briefcase, ArrowRight,
  CheckCircle2, Building2, Zap, ChevronRight, Lock, LogIn,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { Badge } from '../ui/badge';
import { usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { PROJECTS } from '../../data/mock-data';
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_SHORT_LABELS } from '../../data/types';

// ═══════════════════════════════════════════════════════════════
// PortalOnboarding — 회원가입 + 사업 선택
// ═══════════════════════════════════════════════════════════════

const statusColors: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-700',
};

export function PortalOnboarding() {
  const navigate = useNavigate();
  const { register, isRegistered } = usePortalStore();
  const { login, logout } = useAuth();
  const [step, setStep] = useState<'info' | 'project' | 'done'>(isRegistered ? 'done' : 'info');

  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'PM',
    projectId: '',
  });

  const activeProjects = PROJECTS.filter(p =>
    p.status === 'IN_PROGRESS' || p.status === 'COMPLETED_PENDING_PAYMENT'
  );
  const allProjects = PROJECTS;

  const selectedProject = allProjects.find(p => p.id === form.projectId);

  const handleNext = () => {
    if (step === 'info' && form.name && form.email) {
      setStep('project');
    } else if (step === 'project' && form.projectId) {
      register({
        name: form.name,
        email: form.email,
        role: form.role,
        projectId: form.projectId,
      });
      setStep('done');
    }
  };

  const handleStart = () => {
    navigate('/portal');
  };

  // 이미 등록된 경우
  if (isRegistered && step !== 'done') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-[18px] mb-2" style={{ fontWeight: 700 }}>이미 등록되어 있습니다</h2>
            <p className="text-[13px] text-muted-foreground mb-4">사업 관리 포털로 이동합니다.</p>
            <Button onClick={() => navigate('/portal')} className="gap-2">
              포털로 이동 <ArrowRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/30 dark:from-slate-950 dark:to-teal-950/10 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' }}
          >
            <FolderKanban className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-[22px] mb-1" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            사업비 관리 포털
          </h1>
          <p className="text-[13px] text-muted-foreground">
            사업 담당자로 등록하고, 배정된 사업의 재무를 관리하세요
          </p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[
            { key: 'info', label: '기본 정보' },
            { key: 'project', label: '사업 선택' },
            { key: 'done', label: '완료' },
          ].map((s, i) => {
            const isCurrent = s.key === step;
            const isPast = (step === 'project' && i === 0) || (step === 'done' && i < 2);
            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className={`w-8 h-px ${isPast || isCurrent ? 'bg-teal-400' : 'bg-border'}`} />}
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] ${
                    isPast ? 'bg-teal-500 text-white' :
                    isCurrent ? 'bg-teal-500 text-white ring-4 ring-teal-500/20' :
                    'bg-muted text-muted-foreground'
                  }`} style={{ fontWeight: 700 }}>
                    {isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-[11px] ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`} style={{ fontWeight: isCurrent ? 600 : 400 }}>
                    {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step 1: 기본 정보 */}
        {step === 'info' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <User className="w-3.5 h-3.5 text-muted-foreground" /> 이름 (닉네임)
                </Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="예: 데이나"
                  className="h-10 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" /> 이메일
                </Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="예: dana@mysc.co.kr"
                  className="h-10 text-[13px]"
                />
              </div>
              <div>
                <Label className="text-[12px] flex items-center gap-1.5 mb-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-muted-foreground" /> 역할
                </Label>
                <Select value={form.role} onValueChange={v => setForm(prev => ({ ...prev, role: v }))}>
                  <SelectTrigger className="h-10 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PM">PM (사업 담당자)</SelectItem>
                    <SelectItem value="팀원">팀원</SelectItem>
                    <SelectItem value="외부전문가">외부전문가</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full h-10 gap-2"
                onClick={handleNext}
                disabled={!form.name || !form.email}
              >
                다음: 사업 선택 <ArrowRight className="w-4 h-4" />
              </Button>

              <div className="pt-3 border-t border-border mt-4">
                <Link
                  to="/login"
                  className="w-full flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <LogIn className="w-3.5 h-3.5" /> 이미 계정이 있으신가요? 로그인
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: 사업 선택 */}
        {step === 'project' && (
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-[12px] text-muted-foreground mb-3">
                  관리할 사업을 선택해 주세요. 선택한 사업의 재무·인력 정보만 열람/편집할 수 있습니다.
                </p>

                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {activeProjects.map(p => (
                    <button
                      key={p.id}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        form.projectId === p.id
                          ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20 ring-1 ring-teal-500/30'
                          : 'border-border hover:border-teal-300 hover:bg-muted/30'
                      }`}
                      onClick={() => setForm(prev => ({ ...prev, projectId: p.id }))}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] truncate" style={{ fontWeight: 600 }}>
                            {p.name}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                            <span>{p.clientOrg}</span>
                            <span>{p.department}</span>
                            {p.managerName && <span>담당: {p.managerName}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge className={`text-[9px] h-4 px-1.5 ${statusColors[p.status] || ''}`}>
                            {PROJECT_STATUS_LABELS[p.status]}
                          </Badge>
                          {form.projectId === p.id && (
                            <CheckCircle2 className="w-4 h-4 text-teal-500" />
                          )}
                        </div>
                      </div>
                      {p.contractAmount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          사업비: {(p.contractAmount / 1e8).toFixed(1)}억원
                          {p.managerName && ` · ${p.managerName}`}
                        </p>
                      )}
                    </button>
                  ))}

                  {/* 계약전 사업 */}
                  <div className="pt-2">
                    <p className="text-[10px] text-muted-foreground mb-1.5 px-1" style={{ fontWeight: 600 }}>계약 전 / 예정 사업</p>
                    {allProjects.filter(p => p.status === 'CONTRACT_PENDING').slice(0, 5).map(p => (
                      <button
                        key={p.id}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          form.projectId === p.id
                            ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/20'
                            : 'border-border/50 hover:border-teal-300 hover:bg-muted/30'
                        }`}
                        onClick={() => setForm(prev => ({ ...prev, projectId: p.id }))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] truncate" style={{ fontWeight: 500 }}>{p.name}</p>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 text-amber-600">계약전</Badge>
                            {form.projectId === p.id && <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 선택된 사업 확인 */}
            {selectedProject && (
              <Card className="border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/20">
                <CardContent className="p-3 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-teal-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-teal-700 dark:text-teal-300" style={{ fontWeight: 600 }}>선택된 사업</p>
                    <p className="text-[12px] truncate">{selectedProject.name}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setStep('info')}>
                이전
              </Button>
              <Button
                className="flex-1 h-10 gap-2"
                onClick={handleNext}
                disabled={!form.projectId}
              >
                등록 완료 <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: 완료 */}
        {step === 'done' && (
          <Card>
            <CardContent className="p-8 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' }}
              >
                <CheckCircle2 className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-[20px] mb-2" style={{ fontWeight: 800 }}>등록 완료!</h2>
              <p className="text-[13px] text-muted-foreground mb-6">
                사업비 관리 포털에서 배정된 사업의 재무와 인력을 관리할 수 있습니다.
              </p>
              <Button size="lg" className="gap-2 h-11" onClick={handleStart}>
                사업 관리 시작하기 <ArrowRight className="w-4 h-4" />
              </Button>

              <div className="mt-6 pt-4 border-t border-border">
                <button
                  onClick={() => navigate('/')}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto"
                >
                  <Zap className="w-3 h-3" /> 관리자 페이지로 이동
                </button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}