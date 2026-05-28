import React, { useEffect, useMemo, useState } from 'react';
import {
  Settings, Users, BookOpen, Building2, Plus, Upload, Shield, Search, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_META } from '../../platform/role-meta';
import { hasPermission, type PlatformPermission } from '../../platform/rbac';
import { useLocation, useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Separator } from '../ui/separator';
import { useAppStore } from '../../data/store';
import {
  CASHFLOW_CATEGORY_LABELS, SETTLEMENT_TYPE_LABELS, BASIS_LABELS,
  type CashflowCategory,
} from '../../data/types';
import { DataMigrationTab } from './DataMigrationTab';
import { PageHeader } from '../layout/PageHeader';
import { useAuth } from '../../data/auth-store';

const DISPLAY_ROLES = ['admin', 'finance', 'pm'] as const;
type DisplayRole = typeof DISPLAY_ROLES[number];
const PRIMARY_SETTINGS_TABS = ['org', 'members', 'templates', 'migration', 'permissions'] as const;
const PRIMARY_SETTINGS_TAB_SET = new Set<string>(PRIMARY_SETTINGS_TABS);

const PERMISSION_LABELS: Partial<Record<PlatformPermission, string>> = {
  'project:write':       '프로젝트 생성/수정',
  'ledger:write':        '원장 생성',
  'transaction:submit':  '거래 입력/수정',
  'transaction:approve': '거래 승인/반려',
  'evidence:write':      '증빙 첨부',
  'comment:write':       '댓글/제출',
  'audit:read':          '감사 로그 조회',
  'user:manage':         '구성원 관리',
  'tenant:manage':       '설정 변경',
};

export function SettingsPage() {
  const { org, members, templates, upsertMember, removeMember } = useAppStore();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const requestedTab = searchParams.get('tab') || 'org';
  const initialTab = PRIMARY_SETTINGS_TAB_SET.has(requestedTab) ? requestedTab : 'org';
  const [tab, setTab] = useState(initialTab);
  const [memberSearch, setMemberSearch] = useState('');
  const [savingMember, setSavingMember] = useState(false);
  const [memberDraft, setMemberDraft] = useState({
    uid: '',
    name: '',
    email: '',
    role: 'pm' as DisplayRole,
  });
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const settingsAccessBlocked = Boolean(isAuthenticated && user && user.role !== 'admin');
  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => [
      member.name,
      member.email,
      member.uid,
      ROLE_META[member.role]?.label,
      member.role,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [memberSearch, members]);

  const resetMemberDraft = () => {
    setMemberDraft({ uid: '', name: '', email: '', role: 'pm' });
  };

  const handleSaveMember = async () => {
    const uid = memberDraft.uid.trim();
    const name = memberDraft.name.trim();
    const email = memberDraft.email.trim().toLowerCase();
    if (!uid || !name || !email) {
      toast.error('UID, 이름, 이메일을 모두 입력해 주세요.');
      return;
    }

    setSavingMember(true);
    try {
      await upsertMember({
        uid,
        name,
        email,
        role: memberDraft.role,
        status: 'ACTIVE',
      });
      toast.success('구성원 원장을 저장했습니다.');
      resetMemberDraft();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '구성원 원장 저장에 실패했습니다.');
    } finally {
      setSavingMember(false);
    }
  };

  const handleRemoveMember = async (uid: string, name: string) => {
    if (!window.confirm(`${name || uid} 구성원을 원장에서 제거할까요?`)) return;
    try {
      await removeMember(uid);
      toast.success('구성원 원장에서 제거했습니다.');
      if (memberDraft.uid === uid) resetMemberDraft();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '구성원 제거에 실패했습니다.');
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: currentPath } });
    }
  }, [authLoading, currentPath, isAuthenticated, navigate]);

  if (authLoading || !isAuthenticated) return null;
  if (!user) return null;

  if (settingsAccessBlocked) {
    return (
      <div className="space-y-5">
        <PageHeader
          icon={Shield}
          iconGradient="linear-gradient(135deg, #001e46, #001e46)"
          title="설정 접근 권한이 없습니다"
          description="운영 설정은 관리자만 변경할 수 있습니다. 현재 URL은 유지했습니다."
        />
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-5 text-sm text-slate-600">
            필요한 경우 관리자에게 권한 확인을 요청해 주세요.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Settings}
        iconGradient="linear-gradient(135deg, #0891b2, #0891b2)"
        title="설정"
        description="운영에 필요한 조직, 구성원, 템플릿, 권한 설정만 관리합니다"
      />

      <Card className="border-slate-200/80 bg-slate-50/70">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-[12px] font-semibold text-slate-900">운영 설정 범위</p>
            <p className="text-[12px] leading-6 text-slate-600">
              1차 운영 surface에서는 조직 정보, 구성원, 원장 템플릿, 데이터 마이그레이션, 권한 매트릭스만 노출합니다.
            </p>
          </div>
          <Badge variant="outline" className="h-7 self-start border-slate-300 bg-white px-3 text-[11px] text-slate-700">
            Primary Admin Settings
          </Badge>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="org" className="gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> 조직 정보
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> 구성원
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> 원장 템플릿
          </TabsTrigger>
          <TabsTrigger value="migration" className="gap-1.5">
            <Upload className="w-3.5 h-3.5" /> 데이터 마이그레이션
          </TabsTrigger>
          <TabsTrigger value="permissions" className="gap-1.5">
            <Shield className="w-3.5 h-3.5" /> 권한 설정
          </TabsTrigger>
        </TabsList>

        {/* Organization */}
        <TabsContent value="org">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">조직 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>조직명</Label>
                <Input value={org.name} readOnly className="max-w-sm" />
              </div>
              <div>
                <Label>조직 ID</Label>
                <Input value={org.id} readOnly className="max-w-sm" />
              </div>
              <div>
                <Label>생성일</Label>
                <Input value={new Date(org.createdAt).toLocaleDateString('ko-KR')} readOnly className="max-w-sm" />
              </div>
              <Separator />
              <div>
                <h4 className="mb-2">캐시플로 표준 항목 (Enum)</h4>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(CASHFLOW_CATEGORY_LABELS) as [CashflowCategory, string][]).map(([key, label]) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {label} ({key})
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <div className="space-y-4">
            <Card className="border-slate-200">
              <CardHeader>
                <CardTitle className="text-base">구성원 원장 추가/수정</CardTitle>
                <p className="text-[12px] text-muted-foreground">
                  사업 담당자 선택값은 이 원장의 UID를 저장합니다. 이미 로그인한 구성원은 Firebase UID를 사용하세요.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_180px_auto_auto] lg:items-end">
                <div>
                  <Label className="text-xs">UID *</Label>
                  <Input
                    value={memberDraft.uid}
                    onChange={(event) => setMemberDraft((prev) => ({ ...prev, uid: event.target.value }))}
                    placeholder="Firebase UID"
                    className="mt-1 border-slate-300"
                  />
                </div>
                <div>
                  <Label className="text-xs">이름 *</Label>
                  <Input
                    value={memberDraft.name}
                    onChange={(event) => setMemberDraft((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="홍길동(닉네임)"
                    className="mt-1 border-slate-300"
                  />
                </div>
                <div>
                  <Label className="text-xs">이메일 *</Label>
                  <Input
                    value={memberDraft.email}
                    onChange={(event) => setMemberDraft((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="name@mysc.co.kr"
                    className="mt-1 border-slate-300"
                  />
                </div>
                <div>
                  <Label className="text-xs">역할</Label>
                  <Select value={memberDraft.role} onValueChange={(value) => setMemberDraft((prev) => ({ ...prev, role: value as DisplayRole }))}>
                    <SelectTrigger className="mt-1 h-9 border-slate-300 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DISPLAY_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>{ROLE_META[role]?.label ?? role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={() => void handleSaveMember()} disabled={savingMember} className="gap-2">
                  <Save className="h-4 w-4" /> 저장
                </Button>
                <Button type="button" variant="outline" onClick={resetMemberDraft}>
                  초기화
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-base">구성원 원장 ({members.length}명)</CardTitle>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      실제 데이터는 Firestore orgs/{org.id}/members에 저장됩니다.
                    </p>
                  </div>
                  <div className="relative w-full lg:w-[320px]">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="이름, 이메일, UID 검색"
                      className="h-9 border-slate-300 pl-9"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>이메일</TableHead>
                    <TableHead>역할</TableHead>
                    <TableHead>UID</TableHead>
                    <TableHead className="w-[160px] text-right">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map(m => (
                    <TableRow key={m.uid}>
                      <TableCell style={{ fontWeight: 500 }}>{m.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${ROLE_META[m.role]?.badgeClass ?? ''}`}>
                          {ROLE_META[m.role]?.label ?? m.role}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{m.uid}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setMemberDraft({
                              uid: m.uid,
                              name: m.name,
                              email: m.email || '',
                              role: DISPLAY_ROLES.includes(m.role as DisplayRole) ? m.role as DisplayRole : 'pm',
                            })}
                          >
                            수정
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-slate-300 text-red-700 hover:text-red-700"
                            onClick={() => void handleRemoveMember(m.uid, m.name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates">
          <div className="space-y-4">
            {templates.map(tpl => (
              <Card key={tpl.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{tpl.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{tpl.version}</Badge>
                      <Badge variant="secondary">{tpl.id}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">기본 기준 (Basis)</p>
                      <p>{BASIS_LABELS[tpl.defaultBasis]}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">승인 기준 금액</p>
                      <p>{tpl.approvalThreshold.toLocaleString()}원 이상</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">허용 정산유형</p>
                      <div className="flex gap-1">
                        {tpl.allowedSettlementTypes.map(s => (
                          <Badge key={s} variant="outline" className="text-xs">{SETTLEMENT_TYPE_LABELS[s]}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">필수 증빙</p>
                      <div className="flex gap-1">
                        {tpl.evidenceRules.map(r => (
                          <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">캐시플로 항목</p>
                    <div className="flex flex-wrap gap-1">
                      {tpl.cashflowEnums.map(c => (
                        <Badge key={c} variant="outline" className="text-[10px]">
                          {CASHFLOW_CATEGORY_LABELS[c]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Data migration */}
        <TabsContent value="migration">
          <DataMigrationTab />
        </TabsContent>

        {/* Permissions */}
        <TabsContent value="permissions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">역할별 권한 매트릭스</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>권한</TableHead>
                    {DISPLAY_ROLES.map(role => (
                      <TableHead key={role} className="text-center">
                        {ROLE_META[role].label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Object.entries(PERMISSION_LABELS) as [PlatformPermission, string][]).map(([perm, label]) => (
                    <TableRow key={perm}>
                      <TableCell className="text-sm">{label}</TableCell>
                      {DISPLAY_ROLES.map((role: DisplayRole) => (
                        <TableCell key={role} className="text-center">
                          {hasPermission(role, perm) ? (
                            <span className="text-green-600">&#10003;</span>
                          ) : (
                            <span className="text-gray-300">&#10005;</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
