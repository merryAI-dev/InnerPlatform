import React, { useEffect, useState } from 'react';
import {
  Settings, Users, BookOpen, Shield, Building2, Plus, Database, Upload, MessageCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router';
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
import { FirebaseSetup } from './FirebaseSetup';
import { DataMigrationTab } from './DataMigrationTab';
import { GuideUploadTab } from '../guide-chat/GuideUploadTab';
import { PageHeader } from '../layout/PageHeader';
import { useAuth } from '../../data/auth-store';
import { resolveHomePath } from '../../platform/navigation';

const roleLabels: Record<string, string> = {
  admin: '관리자',
  tenant_admin: '테넌트 관리자',
  finance: '재무',
  pm: 'PM',
  viewer: '뷰어',
  auditor: '감사',
  support: '지원',
  security: '보안',
};

const roleColor: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  tenant_admin: 'bg-violet-100 text-violet-800',
  finance: 'bg-blue-100 text-blue-800',
  pm: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-700',
  auditor: 'bg-amber-100 text-amber-800',
  support: 'bg-slate-100 text-slate-700',
  security: 'bg-rose-100 text-rose-800',
};

export function SettingsPage() {
  const { org, members, templates } = useAppStore();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('org');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }

    const role = user?.role;
    if (!role) return;

    // Keep operational settings (Firebase/feature toggles, member management) admin-scoped.
    const allowed = role === 'admin' || role === 'tenant_admin';
    if (!allowed) {
      navigate(resolveHomePath(role), { replace: true });
    }
  }, [isAuthenticated, navigate, user?.role]);

  if (!isAuthenticated) return null;
  if (!user) return null;
  if (!(user.role === 'admin' || user.role === 'tenant_admin')) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Settings}
        iconGradient="linear-gradient(135deg, #4f46e5, #6366f1)"
        title="설정"
        description="조직, 구성원, 원장 템플릿, Firebase 연결 관리"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="org" className="gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> 조직 정보
          </TabsTrigger>
          <TabsTrigger value="firebase" className="gap-1.5">
            <Database className="w-3.5 h-3.5" /> Firebase
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
          <TabsTrigger value="guide" className="gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" /> 사업비 가이드
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

        {/* Firebase */}
        <TabsContent value="firebase">
          <FirebaseSetup />
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">구성원 ({members.length}명)</CardTitle>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> 구성원 초대
                </Button>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map(m => (
                    <TableRow key={m.uid}>
                      <TableCell style={{ fontWeight: 500 }}>{m.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded ${roleColor[m.role]}`}>
                          {roleLabels[m.role]}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{m.uid}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
                    <TableHead className="text-center">관리자</TableHead>
                    <TableHead className="text-center">재무</TableHead>
                    <TableHead className="text-center">PM</TableHead>
                    <TableHead className="text-center">감사</TableHead>
                    <TableHead className="text-center">뷰어</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { perm: '프로젝트 생성/수정', admin: true, finance: true, pm: false, auditor: false, viewer: false },
                    { perm: '원장 생성', admin: true, finance: true, pm: true, auditor: false, viewer: false },
                    { perm: '거래 입력/수정', admin: true, finance: true, pm: true, auditor: false, viewer: false },
                    { perm: '거래 제출', admin: true, finance: true, pm: true, auditor: false, viewer: false },
                    { perm: '거래 승인/반려', admin: true, finance: true, pm: false, auditor: false, viewer: false },
                    { perm: '증빙 첨부', admin: true, finance: true, pm: true, auditor: false, viewer: false },
                    { perm: '증빙 검토/반려', admin: true, finance: true, pm: false, auditor: false, viewer: false },
                    { perm: '전사 대시보드 조회', admin: true, finance: true, pm: true, auditor: true, viewer: true },
                    { perm: '캐시플로 분석', admin: true, finance: true, pm: true, auditor: true, viewer: true },
                    { perm: '감사 로그 조회', admin: true, finance: false, pm: false, auditor: true, viewer: false },
                    { perm: '설정 변경', admin: true, finance: false, pm: false, auditor: false, viewer: false },
                    { perm: '구성원 관리', admin: true, finance: false, pm: false, auditor: false, viewer: false },
                    { perm: '원장 템플릿 관리', admin: true, finance: true, pm: false, auditor: false, viewer: false },
                  ].map(row => (
                    <TableRow key={row.perm}>
                      <TableCell className="text-sm">{row.perm}</TableCell>
                      {(['admin', 'finance', 'pm', 'auditor', 'viewer'] as const).map(role => (
                        <TableCell key={role} className="text-center">
                          {row[role] ? (
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

        {/* Guide Q&A */}
        <TabsContent value="guide">
          <GuideUploadTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
