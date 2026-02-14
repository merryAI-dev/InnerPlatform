import { useState, useMemo } from 'react';
import {
  Users, UserPlus, Search, Shield, Edit3,
  MoreHorizontal, Mail, Clock, CheckCircle2,
  XCircle, Eye, UserCog, Key, Trash2,
  ArrowUpDown, FolderKanban, Filter,
  ShieldCheck, ShieldAlert, Activity,
  Ban, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import { PageHeader } from '../layout/PageHeader';
import { ScrollArea } from '../ui/scroll-area';
import { toast } from 'sonner';
import type { UserRole } from '../../data/types';
import { PROJECTS, ORG_MEMBERS } from '../../data/mock-data';

// ═══════════════════════════════════════════════════════════════
// 사용자 관리 페이지 — Admin
// 사용자 계정 CRUD, 역할 배정, 프로젝트 배정, 활성화/비활성화
// ═══════════════════════════════════════════════════════════════

interface ManagedUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  department?: string;
  phone?: string;
  assignedProjects: string[];
  createdAt: string;
  lastLoginAt: string;
  avatarUrl?: string;
  note?: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  finance: '재무팀',
  pm: 'PM (사업담당)',
  viewer: '뷰어',
  auditor: '감사',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300',
  finance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  pm: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  viewer: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  auditor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
};

const ROLE_ICONS: Record<UserRole, typeof Shield> = {
  admin: ShieldCheck,
  finance: Activity,
  pm: FolderKanban,
  viewer: Eye,
  auditor: ShieldAlert,
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '활성',
  INACTIVE: '비활성',
  PENDING: '승인대기',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
  INACTIVE: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
};

// Mock initial data from ORG_MEMBERS
const INITIAL_USERS: ManagedUser[] = ORG_MEMBERS.map((m, i) => ({
  uid: m.uid,
  name: m.name,
  email: m.email,
  role: m.role,
  status: (i === 0 ? 'ACTIVE' : i < 18 ? 'ACTIVE' : 'ACTIVE') as ManagedUser['status'],
  department: i < 6 ? '임팩트 이노베이션 그룹' : i < 12 ? '소셜벤처 그룹' : i < 17 ? '공간혁신 그룹' : '경영지원실',
  phone: `010-${String(1000 + i * 111).slice(0, 4)}-${String(5000 + i * 222).slice(0, 4)}`,
  assignedProjects: PROJECTS.slice(i % PROJECTS.length, (i % PROJECTS.length) + 2).map(p => p.id),
  createdAt: `2024-${String(1 + (i % 12)).padStart(2, '0')}-15T09:00:00Z`,
  lastLoginAt: new Date(Date.now() - i * 86400000 * 2).toISOString(),
  note: '',
}));

export function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>(INITIAL_USERS);
  const [searchText, setSearchText] = useState('');
  const [filterRole, setFilterRole] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [sortField, setSortField] = useState<'name' | 'role' | 'lastLoginAt'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // 새 사용자 폼
  const [newForm, setNewForm] = useState({
    name: '',
    email: '',
    role: 'pm' as UserRole,
    department: '',
    phone: '',
    note: '',
  });

  // 필터링
  const filteredUsers = useMemo(() => {
    let list = users.filter(u => {
      if (filterRole !== 'ALL' && u.role !== filterRole) return false;
      if (filterStatus !== 'ALL' && u.status !== filterStatus) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return u.name.toLowerCase().includes(q) ||
               u.email.toLowerCase().includes(q) ||
               (u.department || '').toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'ko');
      else if (sortField === 'role') cmp = a.role.localeCompare(b.role);
      else cmp = new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime();
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [users, filterRole, filterStatus, searchText, sortField, sortAsc]);

  // KPI
  const kpi = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.status === 'ACTIVE').length,
    pending: users.filter(u => u.status === 'PENDING').length,
    admins: users.filter(u => u.role === 'admin').length,
    pms: users.filter(u => u.role === 'pm').length,
    finance: users.filter(u => u.role === 'finance').length,
  }), [users]);

  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    PROJECTS.forEach(p => m.set(p.id, p.name));
    return m;
  }, []);

  // 사용자 생성
  const handleCreate = () => {
    if (!newForm.name || !newForm.email) return;
    const newUser: ManagedUser = {
      uid: `u-${Date.now()}`,
      name: newForm.name,
      email: newForm.email,
      role: newForm.role,
      status: 'ACTIVE',
      department: newForm.department,
      phone: newForm.phone,
      assignedProjects: [],
      createdAt: new Date().toISOString(),
      lastLoginAt: '-',
      note: newForm.note,
    };
    setUsers(prev => [newUser, ...prev]);
    setShowCreateDialog(false);
    setNewForm({ name: '', email: '', role: 'pm', department: '', phone: '', note: '' });
    toast.success(`${newUser.name} 계정이 생성되었습니다`);
  };

  // 역할 변경
  const handleRoleChange = (uid: string, newRole: UserRole) => {
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    toast.success('역할이 변경되었습니다');
  };

  // 상태 변경
  const handleStatusToggle = (uid: string) => {
    setUsers(prev => prev.map(u => {
      if (u.uid !== uid) return u;
      const newStatus = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      return { ...u, status: newStatus };
    }));
  };

  // 승인
  const handleApproveUser = (uid: string) => {
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: 'ACTIVE' } : u));
    toast.success('사용자가 승인되었습니다');
  };

  // 사용자 수정
  const handleSaveEdit = () => {
    if (!editingUser) return;
    setUsers(prev => prev.map(u => u.uid === editingUser.uid ? editingUser : u));
    setShowEditDialog(false);
    setEditingUser(null);
    toast.success('사용자 정보가 수정되었습니다');
  };

  // 삭제
  const handleDelete = (uid: string) => {
    setUsers(prev => prev.filter(u => u.uid !== uid));
    if (selectedUser?.uid === uid) setSelectedUser(null);
    toast.success('사용자가 삭제되었습니다');
  };

  const formatDate = (iso: string) => {
    if (iso === '-') return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatRelative = (iso: string) => {
    if (iso === '-') return '미접속';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        <PageHeader
          icon={Users}
          iconGradient="linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)"
          title="사용자 관리"
          description="사용자 계정 등록·역할 배정·권한 관리"
          badge={`${kpi.total}명`}
          actions={
            <Button
              size="sm"
              className="h-8 text-[12px] gap-1.5"
              onClick={() => setShowCreateDialog(true)}
            >
              <UserPlus className="w-3.5 h-3.5" />
              새 사용자 등록
            </Button>
          }
        />

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: '전체', value: kpi.total, icon: Users, color: '#6366f1' },
            { label: '활성', value: kpi.active, icon: CheckCircle2, color: '#059669' },
            { label: '승인대기', value: kpi.pending, icon: Clock, color: '#d97706' },
            { label: '관리자', value: kpi.admins, icon: ShieldCheck, color: '#8b5cf6' },
            { label: 'PM', value: kpi.pms, icon: FolderKanban, color: '#3b82f6' },
            { label: '재무팀', value: kpi.finance, icon: Activity, color: '#0d9488' },
          ].map(k => (
            <Card key={k.label}>
              <CardContent className="p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${k.color}15` }}>
                  <k.icon className="w-3.5 h-3.5" style={{ color: k.color }} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{k.label}</p>
                  <p className="text-[18px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{k.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 승인 대기 알림 */}
        {kpi.pending > 0 && (
          <Card className="border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10">
            <CardContent className="p-3 flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-[12px]" style={{ fontWeight: 600 }}>
                  승인 대기 중인 사용자가 {kpi.pending}명 있습니다
                </p>
                <p className="text-[10px] text-muted-foreground">포털에서 가입한 사용자를 승인해주세요</p>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setFilterStatus('PENDING')}>
                확인하기
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Filter Bar */}
        <Card>
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="이름, 이메일, 부서 검색..."
                  className="h-8 pl-8 text-[12px]"
                />
              </div>

              <Select value={filterRole} onValueChange={v => setFilterRole(v)}>
                <SelectTrigger className="h-8 w-[130px] text-[12px]">
                  <SelectValue placeholder="역할" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 역할</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                  <SelectItem value="finance">재무팀</SelectItem>
                  <SelectItem value="pm">PM</SelectItem>
                  <SelectItem value="viewer">뷰어</SelectItem>
                  <SelectItem value="auditor">감사</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={v => setFilterStatus(v)}>
                <SelectTrigger className="h-8 w-[130px] text-[12px]">
                  <SelectValue placeholder="상태" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 상태</SelectItem>
                  <SelectItem value="ACTIVE">활성</SelectItem>
                  <SelectItem value="INACTIVE">비활성</SelectItem>
                  <SelectItem value="PENDING">승인대기</SelectItem>
                </SelectContent>
              </Select>

              <Separator orientation="vertical" className="h-5 mx-1" />

              <p className="text-[11px] text-muted-foreground">{filteredUsers.length}명</p>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="flex gap-4">
          {/* 좌: 사용자 목록 */}
          <div className={selectedUser ? 'w-[420px] shrink-0' : 'w-full'}>
            {/* 정렬 헤더 */}
            <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
              {[
                { key: 'name' as const, label: '이름순' },
                { key: 'role' as const, label: '역할순' },
                { key: 'lastLoginAt' as const, label: '최근접속순' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => { if (sortField === s.key) setSortAsc(!sortAsc); else { setSortField(s.key); setSortAsc(true); } }}
                  className={`flex items-center gap-0.5 px-2 py-1 rounded transition-colors ${sortField === s.key ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  style={{ fontWeight: sortField === s.key ? 600 : 400 }}
                >
                  <ArrowUpDown className="w-2.5 h-2.5" />
                  {s.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filteredUsers.length === 0 ? (
                <Card className="p-8 text-center">
                  <Users className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-[13px] text-muted-foreground">사용자가 없습니다</p>
                </Card>
              ) : (
                filteredUsers.map(u => {
                  const isSelected = selectedUser?.uid === u.uid;
                  const RIcon = ROLE_ICONS[u.role];
                  return (
                    <Card
                      key={u.uid}
                      className={`overflow-hidden cursor-pointer transition-all hover:shadow-sm ${isSelected ? 'ring-2 ring-primary/40 shadow-sm' : ''}`}
                      onClick={() => setSelectedUser(u)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[12px]"
                            style={{
                              fontWeight: 700,
                              background: u.role === 'admin' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' :
                                         u.role === 'finance' ? 'linear-gradient(135deg, #059669, #0d9488)' :
                                         u.role === 'pm' ? 'linear-gradient(135deg, #3b82f6, #6366f1)' :
                                         u.role === 'auditor' ? 'linear-gradient(135deg, #d97706, #f59e0b)' :
                                         'linear-gradient(135deg, #94a3b8, #64748b)',
                            }}
                          >
                            {u.name.charAt(0)}
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[12px] truncate" style={{ fontWeight: 600 }}>{u.name}</span>
                              <Badge className={`text-[8px] h-3.5 px-1.5 ${ROLE_COLORS[u.role]}`}>
                                {ROLE_LABELS[u.role]}
                              </Badge>
                              <Badge className={`text-[8px] h-3.5 px-1.5 ${STATUS_COLORS[u.status]}`}>
                                {STATUS_LABELS[u.status]}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                            <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground">
                              {u.department && <span>{u.department}</span>}
                              <span>접속: {formatRelative(u.lastLoginAt)}</span>
                              <span>사업: {u.assignedProjects.length}건</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={e => e.stopPropagation()}>
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-[12px]">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingUser({ ...u }); setShowEditDialog(true); }}>
                                <Edit3 className="w-3.5 h-3.5 mr-2" /> 정보 수정
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedUser(u); }}>
                                <Eye className="w-3.5 h-3.5 mr-2" /> 상세 보기
                              </DropdownMenuItem>
                              {u.status === 'PENDING' && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleApproveUser(u.uid); }}>
                                  <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-600" /> 승인
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStatusToggle(u.uid); }}>
                                {u.status === 'ACTIVE' ? (
                                  <><Ban className="w-3.5 h-3.5 mr-2 text-amber-600" /> 비활성화</>
                                ) : (
                                  <><RefreshCw className="w-3.5 h-3.5 mr-2 text-emerald-600" /> 활성화</>
                                )}
                              </DropdownMenuItem>
                              {u.role !== 'admin' && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDelete(u.uid); }} className="text-rose-600">
                                  <Trash2 className="w-3.5 h-3.5 mr-2" /> 삭제
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* 우: 선택된 사용자 상세 */}
          {selectedUser && (
            <div className="flex-1 min-w-0">
              <UserDetailPanel
                user={selectedUser}
                projectMap={projectMap}
                onClose={() => setSelectedUser(null)}
                onEdit={() => { setEditingUser({ ...selectedUser }); setShowEditDialog(true); }}
                onRoleChange={(role) => { handleRoleChange(selectedUser.uid, role); setSelectedUser(prev => prev ? { ...prev, role } : null); }}
                onStatusToggle={() => { handleStatusToggle(selectedUser.uid); setSelectedUser(prev => prev ? { ...prev, status: prev.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : null); }}
              />
            </div>
          )}
        </div>

        {/* ── 새 사용자 생성 다이얼로그 ── */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[14px] flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-primary" />
                새 사용자 등록
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">이름 *</Label>
                  <Input
                    value={newForm.name}
                    onChange={e => setNewForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="홍길동"
                    className="h-8 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">이메일 *</Label>
                  <Input
                    type="email"
                    value={newForm.email}
                    onChange={e => setNewForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="user@mysc.co.kr"
                    className="h-8 text-[12px] mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">역할 *</Label>
                  <Select value={newForm.role} onValueChange={v => setNewForm(prev => ({ ...prev, role: v as UserRole }))}>
                    <SelectTrigger className="h-8 text-[12px] mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">관리자</SelectItem>
                      <SelectItem value="finance">재무팀</SelectItem>
                      <SelectItem value="pm">PM (사업담당)</SelectItem>
                      <SelectItem value="viewer">뷰어</SelectItem>
                      <SelectItem value="auditor">감사</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">부서</Label>
                  <Input
                    value={newForm.department}
                    onChange={e => setNewForm(prev => ({ ...prev, department: e.target.value }))}
                    placeholder="소속 부서"
                    className="h-8 text-[12px] mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">전화번호</Label>
                  <Input
                    value={newForm.phone}
                    onChange={e => setNewForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="h-8 text-[12px] mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">메모</Label>
                  <Input
                    value={newForm.note}
                    onChange={e => setNewForm(prev => ({ ...prev, note: e.target.value }))}
                    placeholder="비고"
                    className="h-8 text-[12px] mt-1"
                  />
                </div>
              </div>

              {/* Role description */}
              <div className="p-3 rounded-lg bg-muted/40 text-[10px] text-muted-foreground space-y-1">
                <p style={{ fontWeight: 600 }}>역할별 권한:</p>
                <p><span className="text-foreground" style={{ fontWeight: 500 }}>관리자</span> — 모든 사업·재무·사용자 관리 권한</p>
                <p><span className="text-foreground" style={{ fontWeight: 500 }}>재무팀</span> — 모든 사업의 재무 조회·승인 권한</p>
                <p><span className="text-foreground" style={{ fontWeight: 500 }}>PM</span> — 배정된 사업의 재무·인력 관리 권한</p>
                <p><span className="text-foreground" style={{ fontWeight: 500 }}>뷰어</span> — 배정된 사업 조회만 가능</p>
                <p><span className="text-foreground" style={{ fontWeight: 500 }}>감사</span> — 모든 사업 읽기 전용 + 감사로그</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>취소</Button>
              <Button size="sm" onClick={handleCreate} disabled={!newForm.name || !newForm.email}>
                <UserPlus className="w-3 h-3 mr-1" /> 등록
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── 사용자 수정 다이얼로그 ── */}
        <Dialog open={showEditDialog} onOpenChange={v => { if (!v) { setShowEditDialog(false); setEditingUser(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[14px] flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-primary" />
                사용자 정보 수정
              </DialogTitle>
            </DialogHeader>
            {editingUser && (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px]">이름</Label>
                    <Input
                      value={editingUser.name}
                      onChange={e => setEditingUser(prev => prev ? { ...prev, name: e.target.value } : null)}
                      className="h-8 text-[12px] mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">이메일</Label>
                    <Input
                      value={editingUser.email}
                      onChange={e => setEditingUser(prev => prev ? { ...prev, email: e.target.value } : null)}
                      className="h-8 text-[12px] mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px]">역할</Label>
                    <Select value={editingUser.role} onValueChange={v => setEditingUser(prev => prev ? { ...prev, role: v as UserRole } : null)}>
                      <SelectTrigger className="h-8 text-[12px] mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">관리자</SelectItem>
                        <SelectItem value="finance">재무팀</SelectItem>
                        <SelectItem value="pm">PM (사업담당)</SelectItem>
                        <SelectItem value="viewer">뷰어</SelectItem>
                        <SelectItem value="auditor">감사</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px]">부서</Label>
                    <Input
                      value={editingUser.department || ''}
                      onChange={e => setEditingUser(prev => prev ? { ...prev, department: e.target.value } : null)}
                      className="h-8 text-[12px] mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px]">전화번호</Label>
                    <Input
                      value={editingUser.phone || ''}
                      onChange={e => setEditingUser(prev => prev ? { ...prev, phone: e.target.value } : null)}
                      className="h-8 text-[12px] mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">상태</Label>
                    <Select value={editingUser.status} onValueChange={v => setEditingUser(prev => prev ? { ...prev, status: v as ManagedUser['status'] } : null)}>
                      <SelectTrigger className="h-8 text-[12px] mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">활성</SelectItem>
                        <SelectItem value="INACTIVE">비활성</SelectItem>
                        <SelectItem value="PENDING">승인대기</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-[11px]">메모</Label>
                  <Input
                    value={editingUser.note || ''}
                    onChange={e => setEditingUser(prev => prev ? { ...prev, note: e.target.value } : null)}
                    className="h-8 text-[12px] mt-1"
                    placeholder="비고"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => { setShowEditDialog(false); setEditingUser(null); }}>취소</Button>
              <Button size="sm" onClick={handleSaveEdit}>저장</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════════
// User Detail Panel
// ═══════════════════════════════════════════════════════════════

function UserDetailPanel({
  user, projectMap, onClose, onEdit, onRoleChange, onStatusToggle,
}: {
  user: ManagedUser;
  projectMap: Map<string, string>;
  onClose: () => void;
  onEdit: () => void;
  onRoleChange: (role: UserRole) => void;
  onStatusToggle: () => void;
}) {
  const RIcon = ROLE_ICONS[user.role];
  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[16px]"
              style={{
                fontWeight: 700,
                background: user.role === 'admin' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' :
                           user.role === 'finance' ? 'linear-gradient(135deg, #059669, #0d9488)' :
                           user.role === 'pm' ? 'linear-gradient(135deg, #3b82f6, #6366f1)' :
                           user.role === 'auditor' ? 'linear-gradient(135deg, #d97706, #f59e0b)' :
                           'linear-gradient(135deg, #94a3b8, #64748b)',
              }}
            >
              {user.name.charAt(0)}
            </div>
            <div>
              <h3 className="text-[15px]" style={{ fontWeight: 700 }}>{user.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge className={`text-[9px] h-4 px-1.5 ${ROLE_COLORS[user.role]}`}>
                  <RIcon className="w-2.5 h-2.5 mr-0.5" />
                  {ROLE_LABELS[user.role]}
                </Badge>
                <Badge className={`text-[9px] h-4 px-1.5 ${STATUS_COLORS[user.status]}`}>
                  {STATUS_LABELS[user.status]}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={onEdit}>
              <Edit3 className="w-3 h-3" /> 수정
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 기본 정보 */}
        <div>
          <h4 className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 600 }}>기본 정보</h4>
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={Mail} label="이메일" value={user.email} />
            <InfoRow icon={Shield} label="부서" value={user.department || '-'} />
            <InfoRow icon={Key} label="전화번호" value={user.phone || '-'} />
            <InfoRow icon={Clock} label="가입일" value={new Date(user.createdAt).toLocaleDateString('ko-KR')} />
          </div>
        </div>

        <Separator />

        {/* 역할 변경 */}
        <div>
          <h4 className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 600 }}>역할 변경</h4>
          <Select value={user.role} onValueChange={v => onRoleChange(v as UserRole)}>
            <SelectTrigger className="h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">관리자</SelectItem>
              <SelectItem value="finance">재무팀</SelectItem>
              <SelectItem value="pm">PM (사업담당)</SelectItem>
              <SelectItem value="viewer">뷰어</SelectItem>
              <SelectItem value="auditor">감사</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* 계정 상태 */}
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-[11px]" style={{ fontWeight: 600 }}>계정 활성화</h4>
            <p className="text-[10px] text-muted-foreground">비활성화된 계정은 로그인 불가</p>
          </div>
          <Switch
            checked={user.status === 'ACTIVE'}
            onCheckedChange={onStatusToggle}
          />
        </div>

        <Separator />

        {/* 배정 사업 */}
        <div>
          <h4 className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 600 }}>
            배정 사업 ({user.assignedProjects.length}건)
          </h4>
          <div className="space-y-1.5">
            {user.assignedProjects.map(pid => (
              <div key={pid} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-[11px]">
                <FolderKanban className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate">{projectMap.get(pid) || pid}</span>
              </div>
            ))}
            {user.assignedProjects.length === 0 && (
              <p className="text-[10px] text-muted-foreground">배정된 사업 없음</p>
            )}
          </div>
        </div>

        <Separator />

        {/* 활동 내역 */}
        <div>
          <h4 className="text-[11px] text-muted-foreground mb-2" style={{ fontWeight: 600 }}>최근 활동</h4>
          <div className="space-y-2">
            <ActivityRow
              icon={Clock}
              text={`마지막 접속: ${user.lastLoginAt === '-' ? '미접속' : new Date(user.lastLoginAt).toLocaleDateString('ko-KR') + ' ' + new Date(user.lastLoginAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`}
            />
            <ActivityRow
              icon={UserCog}
              text={`계정 생성: ${new Date(user.createdAt).toLocaleDateString('ko-KR')}`}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-[9px] text-muted-foreground">{label}</p>
        <p className="text-[11px]" style={{ fontWeight: 500 }}>{value}</p>
      </div>
    </div>
  );
}

function ActivityRow({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <Icon className="w-3 h-3 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
