import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitMerge,
  KeyRound,
  RefreshCw,
  Search,
  Shield,
  UserCog,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { featureFlags } from '../../config/feature-flags';
import { useAuth } from '../../data/auth-store';
import type { UserRole } from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import {
  deepSyncAuthGovernanceUserViaBff,
  fetchAuthGovernanceUsersViaBff,
  type AuthGovernanceUserRow,
  type AuthGovernanceSummary,
} from '../../lib/platform-bff-client';
import { PageHeader } from '../layout/PageHeader';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Separator } from '../ui/separator';
import {
  emptyGovernanceSummary,
  filterGovernanceRows,
  getRecommendedGovernanceRole,
  type AuthGovernanceFilters,
} from './auth-governance-view-model';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: '관리자' },
  { value: 'finance', label: '재무팀' },
  { value: 'pm', label: 'PM' },
];

const DRIFT_LABELS: Record<string, string> = {
  missing_auth: 'Auth 없음',
  missing_canonical_member: 'Canonical 멤버 없음',
  legacy_only: 'Legacy만 존재',
  duplicate_member_docs: '중복 멤버 문서',
  legacy_role_mismatch: 'Legacy role 불일치',
  claim_mismatch: 'Claim 불일치',
  bootstrap_admin_not_adopted: 'Bootstrap admin 미반영',
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: 'bg-stone-900 text-white',
  finance: 'bg-stone-700 text-white',
  pm: 'bg-stone-200 text-stone-900',
};

function roleLabel(role: string | null | undefined): string {
  const normalized = (role || '').trim().toLowerCase();
  return ROLE_OPTIONS.find((item) => item.value === normalized)?.label || (normalized || '미지정');
}

function statusLabel(status: string | null | undefined): string {
  if (status === 'ACTIVE') return '활성';
  if (status === 'INACTIVE') return '비활성';
  if (status === 'PENDING') return '대기';
  return '미지정';
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: 'default' | 'danger';
}) {
  return (
    <Card className={tone === 'danger' ? 'border-rose-200 bg-rose-50/60' : 'border-stone-200 bg-white'}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={tone === 'danger'
          ? 'flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700'
          : 'flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 text-stone-700'}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-xs text-stone-500">{label}</div>
          <div className="text-2xl font-semibold text-stone-950">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge className={ok ? 'bg-stone-900 text-white' : 'bg-amber-100 text-amber-800'}>
      {label}
    </Badge>
  );
}

export function UserManagementPage() {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const [items, setItems] = useState<AuthGovernanceUserRow[]>([]);
  const [summary, setSummary] = useState<AuthGovernanceSummary>(emptyGovernanceSummary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdentityKey, setSelectedIdentityKey] = useState<string>('');
  const [syncingIdentityKey, setSyncingIdentityKey] = useState<string>('');
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [draftRoles, setDraftRoles] = useState<Record<string, UserRole>>({});
  const [filters, setFilters] = useState<AuthGovernanceFilters>({
    searchText: '',
    role: 'ALL',
    drift: 'DRIFT_ONLY',
    source: 'ALL',
  });

  const governanceEnabled = featureFlags.platformApiEnabled && !!authUser?.idToken;

  const loadGovernance = async () => {
    if (!authUser || !governanceEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuthGovernanceUsersViaBff({
        tenantId: orgId,
        actor: authUser,
      });
      setItems(response.items);
      setSummary(response.summary);
      setDraftRoles((prev) => {
        const next = { ...prev };
        for (const row of response.items) {
          if (!next[row.identityKey]) {
            next[row.identityKey] = getRecommendedGovernanceRole(row);
          }
        }
        return next;
      });
      setSelectedIdentityKey((prev) => {
        if (prev && response.items.some((row) => row.identityKey === prev)) return prev;
        return response.items[0]?.identityKey || '';
      });
    } catch (err: any) {
      setError(err?.message || 'Auth governance 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGovernance();
  }, [orgId, authUser?.uid, authUser?.idToken]);

  const filteredRows = useMemo(
    () => filterGovernanceRows(items, filters),
    [items, filters],
  );

  const selectedRow = useMemo(
    () => filteredRows.find((row) => row.identityKey === selectedIdentityKey)
      || items.find((row) => row.identityKey === selectedIdentityKey)
      || filteredRows[0]
      || items[0]
      || null,
    [filteredRows, items, selectedIdentityKey],
  );

  useEffect(() => {
    if (selectedRow && selectedRow.identityKey !== selectedIdentityKey) {
      setSelectedIdentityKey(selectedRow.identityKey);
    }
  }, [selectedIdentityKey, selectedRow]);

  const handleDeepSync = async (row: AuthGovernanceUserRow) => {
    if (!authUser) return;
    const role = draftRoles[row.identityKey] || getRecommendedGovernanceRole(row);
    setSyncingIdentityKey(row.identityKey);
    try {
      await deepSyncAuthGovernanceUserViaBff({
        tenantId: orgId,
        actor: authUser,
        identityKey: row.identityKey,
        role,
        reason: 'admin auth governance dashboard deep sync',
      });
      toast.success(`${row.email} 권한 정렬을 반영했습니다.`);
      await loadGovernance();
    } catch (err: any) {
      toast.error(err?.message || '권한 정렬을 반영하지 못했습니다.');
    } finally {
      setSyncingIdentityKey('');
    }
  };

  const handleBulkDeepSync = async () => {
    if (!authUser) return;
    const targets = filteredRows.filter((row) => row.needsDeepSync);
    if (targets.length === 0) {
      toast.info('현재 필터 기준으로 정렬할 대상이 없습니다.');
      return;
    }

    setBulkSyncing(true);
    try {
      for (const row of targets) {
        await deepSyncAuthGovernanceUserViaBff({
          tenantId: orgId,
          actor: authUser,
          identityKey: row.identityKey,
          role: draftRoles[row.identityKey] || getRecommendedGovernanceRole(row),
          reason: 'admin auth governance dashboard bulk deep sync',
        });
      }
      toast.success(`${targets.length}건의 권한 정렬을 반영했습니다.`);
      await loadGovernance();
    } catch (err: any) {
      toast.error(err?.message || '일괄 정렬 중 오류가 발생했습니다.');
    } finally {
      setBulkSyncing(false);
    }
  };

  if (!governanceEnabled) {
    return (
      <div className="space-y-5">
        <PageHeader
          icon={UserCog}
          iconGradient="linear-gradient(135deg, #44403c 0%, #0c0a09 100%)"
          title="Auth/RBAC 정렬 대시보드"
          description="Firebase Auth와 member 문서를 함께 관리하는 운영 화면"
        />
        <Card className="border-stone-200">
          <CardContent className="p-6 text-sm text-stone-600">
            이 화면은 BFF와 Firebase ID 토큰이 활성화된 admin 환경에서만 동작합니다.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UserCog}
        iconGradient="linear-gradient(135deg, #44403c 0%, #0c0a09 100%)"
        title="Auth/RBAC 정렬 대시보드"
        description="Firebase Auth, canonical member, legacy member, custom claim drift를 한 화면에서 정렬합니다."
        badge={`${summary.total}건`}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-9 gap-2 bg-stone-900 text-white hover:bg-stone-800"
              onClick={() => void handleBulkDeepSync()}
              disabled={loading || bulkSyncing}
            >
              <GitMerge className={`h-4 w-4 ${bulkSyncing ? 'animate-pulse' : ''}`} />
              정렬 필요 전체 적용
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 border-stone-300 bg-white text-stone-900"
              onClick={() => void loadGovernance()}
              disabled={loading || bulkSyncing}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
          </div>
        )}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard icon={Users} label="전체 정렬 대상" value={summary.total} />
        <KpiCard icon={GitMerge} label="정렬 필요" value={summary.needsDeepSync} tone={summary.needsDeepSync > 0 ? 'danger' : 'default'} />
        <KpiCard icon={KeyRound} label="Auth 없음" value={summary.missingAuth} tone={summary.missingAuth > 0 ? 'danger' : 'default'} />
        <KpiCard icon={Database} label="Canonical 없음" value={summary.missingCanonicalMember} tone={summary.missingCanonicalMember > 0 ? 'danger' : 'default'} />
        <KpiCard icon={AlertTriangle} label="중복 member" value={summary.duplicateMemberDocs} tone={summary.duplicateMemberDocs > 0 ? 'danger' : 'default'} />
        <KpiCard icon={Shield} label="Bootstrap 후보" value={summary.bootstrapCandidates} />
      </div>

      <Card className="border-stone-200">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <Input
              value={filters.searchText}
              onChange={(event) => setFilters((prev) => ({ ...prev, searchText: event.target.value }))}
              placeholder="이메일, 이름, docId, drift 검색"
              className="h-9 border-stone-300 pl-9"
            />
          </div>
          <Select value={filters.role} onValueChange={(value) => setFilters((prev) => ({ ...prev, role: value as AuthGovernanceFilters['role'] }))}>
            <SelectTrigger className="h-9 w-[150px] border-stone-300 bg-white">
              <SelectValue placeholder="권한 추천값" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 권한</SelectItem>
              {ROLE_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.drift} onValueChange={(value) => setFilters((prev) => ({ ...prev, drift: value as AuthGovernanceFilters['drift'] }))}>
            <SelectTrigger className="h-9 w-[150px] border-stone-300 bg-white">
              <SelectValue placeholder="정렬 상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 상태</SelectItem>
              <SelectItem value="DRIFT_ONLY">정렬 필요만</SelectItem>
              <SelectItem value="CLEAN_ONLY">정렬 완료만</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.source} onValueChange={(value) => setFilters((prev) => ({ ...prev, source: value as AuthGovernanceFilters['source'] }))}>
            <SelectTrigger className="h-9 w-[170px] border-stone-300 bg-white">
              <SelectValue placeholder="소스 상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 소스</SelectItem>
              <SelectItem value="AUTH_MISSING">Auth 없음</SelectItem>
              <SelectItem value="MEMBER_MISSING">Canonical 없음</SelectItem>
              <SelectItem value="BOOTSTRAP">Bootstrap 후보</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-rose-200 bg-rose-50/70">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.9fr)]">
        <Card className="border-stone-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-stone-900">정렬 대상 목록</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[720px]">
              <div className="divide-y divide-stone-200">
                {filteredRows.map((row) => {
                  const role = draftRoles[row.identityKey] || getRecommendedGovernanceRole(row);
                  const selected = selectedRow?.identityKey === row.identityKey;
                  return (
                    <div
                      key={row.identityKey}
                      className={`cursor-pointer px-4 py-4 ${selected ? 'bg-stone-100' : 'bg-white hover:bg-stone-50'}`}
                      onClick={() => setSelectedIdentityKey(row.identityKey)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-stone-950">{row.displayName}</div>
                            <Badge className={row.needsDeepSync ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}>
                              {row.needsDeepSync ? '정렬 필요' : '정렬 완료'}
                            </Badge>
                            {row.bootstrapAdmin && (
                              <Badge className="bg-stone-900 text-white">Bootstrap admin 후보</Badge>
                            )}
                          </div>
                          <div className="text-sm text-stone-600">{row.email}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <SourceBadge ok={Boolean(row.authUid)} label={row.authUid ? 'Auth 연결' : 'Auth 없음'} />
                            <SourceBadge ok={Boolean(row.canonicalMember)} label={row.canonicalMember ? 'Canonical 있음' : 'Canonical 없음'} />
                            <Badge className="bg-stone-100 text-stone-700">Legacy {row.legacyMembers.length}건</Badge>
                            <Badge className={ROLE_BADGE_CLASS[row.effectiveRole] || 'bg-stone-200 text-stone-900'}>
                              현재 판단 {roleLabel(row.effectiveRole)}
                            </Badge>
                            {row.claimRole && (
                              <Badge className="bg-stone-100 text-stone-700">Claim {roleLabel(row.claimRole)}</Badge>
                            )}
                          </div>
                          {row.driftFlags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {row.driftFlags.map((flag) => (
                                <Badge key={flag} className="bg-amber-100 text-amber-800">
                                  {DRIFT_LABELS[flag] || flag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Select
                            value={role}
                            onValueChange={(value) => setDraftRoles((prev) => ({ ...prev, [row.identityKey]: value as UserRole }))}
                          >
                            <SelectTrigger
                              className="h-9 w-[140px] border-stone-300 bg-white"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-9 min-w-[140px] bg-stone-900 text-white hover:bg-stone-800"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeepSync(row);
                            }}
                            disabled={syncingIdentityKey === row.identityKey}
                          >
                            {syncingIdentityKey === row.identityKey ? (
                              <>
                                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                                반영 중
                              </>
                            ) : (
                              <>
                                <GitMerge className="mr-2 h-3.5 w-3.5" />
                                Deep Sync
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!loading && filteredRows.length === 0 && (
                  <div className="px-4 py-16 text-center text-sm text-stone-500">
                    조건에 맞는 정렬 대상이 없습니다.
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-stone-900">선택 사용자 정렬 상태</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedRow ? (
              <div className="text-sm text-stone-500">대상을 선택하면 auth/member 정합성을 비교해서 보여줍니다.</div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-base font-semibold text-stone-950">{selectedRow.displayName}</div>
                  <div className="text-sm text-stone-600">{selectedRow.email}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge className={ROLE_BADGE_CLASS[selectedRow.effectiveRole] || 'bg-stone-200 text-stone-900'}>
                    현재 판단 {roleLabel(selectedRow.effectiveRole)}
                  </Badge>
                  <Badge className="bg-stone-100 text-stone-700">
                    추천 반영 {roleLabel(draftRoles[selectedRow.identityKey] || getRecommendedGovernanceRole(selectedRow))}
                  </Badge>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <KeyRound className="h-3.5 w-3.5" />
                      Firebase Auth
                    </div>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                      <div>UID: {selectedRow.authUid || '-'}</div>
                      <div>Claim role: {roleLabel(selectedRow.claimRole)}</div>
                      <div>Claim tenant: {selectedRow.claimTenantId || '-'}</div>
                      <div>계정 상태: {selectedRow.authUid ? (selectedRow.authDisabled ? '비활성' : '활성') : '없음'}</div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <Database className="h-3.5 w-3.5" />
                      Canonical Member
                    </div>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                      {selectedRow.canonicalMember ? (
                        <>
                          <div>docId: {selectedRow.canonicalMember.docId}</div>
                          <div>role: {roleLabel(selectedRow.canonicalMember.role)}</div>
                          <div>status: {statusLabel(selectedRow.canonicalMember.status)}</div>
                          <div>name: {selectedRow.canonicalMember.name || '-'}</div>
                        </>
                      ) : (
                        <div>canonical member 문서가 없습니다.</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <GitMerge className="h-3.5 w-3.5" />
                      Legacy Members
                    </div>
                    <div className="space-y-2">
                      {selectedRow.legacyMembers.length > 0 ? selectedRow.legacyMembers.map((member) => (
                        <div key={member.docId} className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                          <div>docId: {member.docId}</div>
                          <div>role: {roleLabel(member.role)}</div>
                          <div>status: {statusLabel(member.status)}</div>
                          <div>name: {member.name || '-'}</div>
                        </div>
                      )) : (
                        <div className="rounded-xl border border-dashed border-stone-200 bg-white p-3 text-sm text-stone-500">
                          legacy 문서는 없습니다.
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Drift Flags
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRow.driftFlags.length > 0 ? selectedRow.driftFlags.map((flag) => (
                        <Badge key={flag} className="bg-amber-100 text-amber-800">
                          {DRIFT_LABELS[flag] || flag}
                        </Badge>
                      )) : (
                        <Badge className="bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          drift 없음
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                  <div className="font-medium text-stone-900">이 액션이 하는 일</div>
                  <div className="mt-2 space-y-1">
                    <div>1. Auth 계정 기준으로 canonical member 문서를 맞춥니다.</div>
                    <div>2. legacy member 문서가 있으면 role과 canonical UID를 함께 미러링합니다.</div>
                    <div>3. Firebase custom claim role/tenantId까지 같이 정렬합니다.</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-stone-500">
                    마지막 추천 role은 {roleLabel(draftRoles[selectedRow.identityKey] || getRecommendedGovernanceRole(selectedRow))} 입니다.
                  </div>
                  <Button
                    className="bg-stone-900 text-white hover:bg-stone-800"
                    onClick={() => void handleDeepSync(selectedRow)}
                    disabled={syncingIdentityKey === selectedRow.identityKey}
                  >
                    {syncingIdentityKey === selectedRow.identityKey ? '반영 중…' : '선택 사용자 Deep Sync'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
