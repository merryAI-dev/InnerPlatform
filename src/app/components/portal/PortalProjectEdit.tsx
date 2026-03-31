import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  Building2,
  Loader2,
  Save,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import { upsertProjectViaBff } from '../../lib/platform-bff-client';
import {
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  BASIS_LABELS,
  ACCOUNT_TYPE_LABELS,
  type ProjectType,
  type SettlementType,
  type Basis,
  type AccountType,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../../data/project-department-options';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

function fmtKRW(value: number) {
  if (!value) return '0';
  return value.toLocaleString('ko-KR');
}

export function PortalProjectEdit() {
  const navigate = useNavigate();
  const { orgId } = useFirebase();
  const { user: authUser } = useAuth();
  const { myProject } = usePortalStore();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    officialContractName: '',
    type: 'D1' as ProjectType,
    department: '',
    clientOrg: '',
    contractAmount: 0,
    salesVatAmount: 0,
    contractStart: '',
    contractEnd: '',
    settlementType: 'TYPE1' as SettlementType,
    basis: '공급가액' as Basis,
    accountType: 'DEDICATED' as AccountType,
    managerName: '',
    teamName: '',
    participantCondition: '',
    projectPurpose: '',
    note: '',
  });

  useEffect(() => {
    if (myProject) {
      setForm({
        name: myProject.name || '',
        officialContractName: myProject.officialContractName || '',
        type: myProject.type || 'D1',
        department: myProject.department || '',
        clientOrg: myProject.clientOrg || '',
        contractAmount: myProject.contractAmount || 0,
        salesVatAmount: myProject.salesVatAmount || 0,
        contractStart: myProject.contractStart || '',
        contractEnd: myProject.contractEnd || '',
        settlementType: myProject.settlementType || 'TYPE1',
        basis: myProject.basis || '공급가액',
        accountType: myProject.accountType || 'DEDICATED',
        managerName: myProject.managerName || '',
        teamName: myProject.teamName || '',
        participantCondition: myProject.participantCondition || '',
        projectPurpose: myProject.projectPurpose || '',
        note: (myProject as any).note || '',
      });
    }
  }, [myProject]);

  if (!myProject) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-muted-foreground text-sm">배정된 프로젝트가 없습니다.</p>
      </div>
    );
  }

  const handleSave = async () => {
    if (!orgId || !myProject || !authUser?.uid) return;
    setSaving(true);
    try {
      const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
      await upsertProjectViaBff({
        tenantId: orgId,
        actor: {
          uid: authUser.uid,
          email: authUser.email,
          role: authUser.role,
          idToken,
        },
        project: {
          ...myProject,
          expectedVersion: myProject.version ?? 1,
          id: myProject.id,
          name: form.name.trim(),
          officialContractName: form.officialContractName.trim(),
          type: form.type,
          department: form.department,
          clientOrg: form.clientOrg.trim(),
          contractAmount: form.contractAmount,
          salesVatAmount: form.salesVatAmount,
          contractStart: form.contractStart,
          contractEnd: form.contractEnd,
          settlementType: form.settlementType,
          basis: form.basis,
          accountType: form.accountType,
          managerName: form.managerName.trim(),
          teamName: form.teamName.trim(),
          participantCondition: form.participantCondition.trim(),
          projectPurpose: form.projectPurpose.trim(),
        },
      });
      toast.success('프로젝트 정보가 저장되었습니다.');
    } catch (err) {
      toast.error('저장에 실패했습니다. 다시 시도해주세요.');
      console.error('[PortalProjectEdit] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> 돌아가기
        </Button>
        <div>
          <h1 className="text-xl font-bold">프로젝트 정보 수정</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            현재 프로젝트: {myProject.name}
          </p>
        </div>
      </div>

      {/* 기본 정보 */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4" /> 기본 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">프로젝트명 (등록명)</Label>
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="예: 2026 CTS2"
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">계약서 상 정식명</Label>
              <Input
                value={form.officialContractName}
                onChange={(e) => update('officialContractName', e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">사업 유형</Label>
              <Select value={form.type} onValueChange={(v) => update('type', v as ProjectType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">담당조직</Label>
              <Select value={form.department} onValueChange={(v) => update('department', v)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">발주기관 (계약기관)</Label>
            <Input
              value={form.clientOrg}
              onChange={(e) => update('clientOrg', e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">사업 목적</Label>
            <Textarea
              value={form.projectPurpose}
              onChange={(e) => update('projectPurpose', e.target.value)}
              className="text-sm min-h-[60px]"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* 재무 정보 */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="w-4 h-4" /> 재무 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">계약금액 (원)</Label>
              <Input
                type="number"
                value={form.contractAmount || ''}
                onChange={(e) => update('contractAmount', Number(e.target.value))}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">{fmtKRW(form.contractAmount)}원</p>
            </div>
            <div>
              <Label className="text-xs">매출부가세 (원)</Label>
              <Input
                type="number"
                value={form.salesVatAmount || ''}
                onChange={(e) => update('salesVatAmount', Number(e.target.value))}
                className="text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">계약 시작일</Label>
              <Input
                type="date"
                value={form.contractStart}
                onChange={(e) => update('contractStart', e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">계약 종료일</Label>
              <Input
                type="date"
                value={form.contractEnd}
                onChange={(e) => update('contractEnd', e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">정산 유형</Label>
              <Select value={form.settlementType} onValueChange={(v) => update('settlementType', v as SettlementType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SETTLEMENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">정산 기준</Label>
              <Select value={form.basis} onValueChange={(v) => update('basis', v as Basis)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BASIS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">통장 유형</Label>
              <Select value={form.accountType} onValueChange={(v) => update('accountType', v as AccountType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 팀 구성 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> 팀 구성
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">메인 담당자</Label>
              <Input
                value={form.managerName}
                onChange={(e) => update('managerName', e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">사내기업팀 (팀장)</Label>
              <Input
                value={form.teamName}
                onChange={(e) => update('teamName', e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">참여기업 조건</Label>
            <Textarea
              value={form.participantCondition}
              onChange={(e) => update('participantCondition', e.target.value)}
              className="text-sm min-h-[60px]"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* 저장 버튼 */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/portal')}>
          취소
        </Button>
        <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          저장
        </Button>
      </div>
    </div>
  );
}
