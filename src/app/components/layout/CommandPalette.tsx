import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  LayoutDashboard, FolderKanban, BarChart3, FileCheck, Shield,
  ClipboardList, BookOpen, Settings, Search, ArrowRight,
  Plus, Zap, Clock, AlertTriangle, Users, Hash,
} from 'lucide-react';
import { Dialog, DialogContent } from '../ui/dialog';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { canShowAdminNavItem } from '../../platform/admin-nav';
import { toast } from 'sonner';
import { resolveGoShortcutTarget } from '../../platform/go-shortcuts';

interface CommandItem {
  id: string;
  icon: any;
  label: string;
  sublabel?: string;
  category: string;
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { projects, transactions } = useAppStore();
  const { user } = useAuth();
  const goPrefixTimeoutRef = useRef<number | null>(null);
  const goPrefixArmedRef = useRef(false);

  const clearGoPrefix = useCallback(() => {
    goPrefixArmedRef.current = false;
    if (goPrefixTimeoutRef.current !== null) {
      window.clearTimeout(goPrefixTimeoutRef.current);
      goPrefixTimeoutRef.current = null;
    }
  }, []);

  const armGoPrefix = useCallback(() => {
    clearGoPrefix();
    goPrefixArmedRef.current = true;
    goPrefixTimeoutRef.current = window.setTimeout(() => {
      goPrefixArmedRef.current = false;
      goPrefixTimeoutRef.current = null;
    }, 800);
  }, [clearGoPrefix]);

  const go = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
    setQuery('');
  }, [navigate]);

  // ⌘K / Ctrl+K + sequence shortcuts (G then D/P/C/E/A/S)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        );
      if (isEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
        setSelectedIndex(0);
        clearGoPrefix();
        return;
      }
      if (e.key === 'Escape') {
        clearGoPrefix();
        setOpen(false);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      if (goPrefixArmedRef.current) {
        clearGoPrefix();
        const targetPath = resolveGoShortcutTarget(key);
        if (!targetPath) return;
        if (!canShowAdminNavItem(user?.role, targetPath)) {
          toast.warning('해당 메뉴에 접근 권한이 없습니다.');
          return;
        }
        e.preventDefault();
        go(targetPath);
        return;
      }

      if (key === 'g') {
        armGoPrefix();
        return;
      }

      if (key === 'n' && canShowAdminNavItem(user?.role, '/projects/new')) {
        e.preventDefault();
        go('/projects/new');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearGoPrefix();
    };
  }, [armGoPrefix, clearGoPrefix, go, user?.role]);

  const items: CommandItem[] = useMemo(() => {
    const nav: CommandItem[] = [
      { id: 'nav-dash', icon: LayoutDashboard, label: '대시보드', path: '/', category: '탐색', action: () => go('/'), keywords: ['dashboard', '홈'] },
      { id: 'nav-proj', icon: FolderKanban, label: '프로젝트 목록', path: '/projects', category: '탐색', action: () => go('/projects'), keywords: ['project', '사업'] },
      { id: 'nav-new', icon: Plus, label: '새 사업 등록', path: '/projects/new', category: '빠른 작업', action: () => go('/projects/new'), keywords: ['new', '생성', '등록'] },
      { id: 'nav-cash', icon: BarChart3, label: '캐시플로', path: '/cashflow', category: '탐색', action: () => go('/cashflow'), keywords: ['cashflow', '현금흐름', 'projection', 'actual', '주간'] },
      { id: 'nav-evi', icon: FileCheck, label: '증빙/정산 관리', path: '/evidence', category: '탐색', action: () => go('/evidence'), keywords: ['evidence', '증빙'] },
      { id: 'nav-part', icon: Shield, label: '참여율 관리 (100-1)', path: '/participation', category: '탐색', action: () => go('/participation'), keywords: ['participation', '참여율'] },
      { id: 'nav-koica', icon: ClipboardList, label: 'KOICA 인력배치', path: '/koica-personnel', category: '탐색', action: () => go('/koica-personnel'), keywords: ['koica', '인력'] },
      { id: 'nav-audit', icon: BookOpen, label: '감사 로그', path: '/audit', category: '탐색', action: () => go('/audit'), keywords: ['audit', '감사'] },
      { id: 'nav-set', icon: Settings, label: '설정', path: '/settings', category: '탐색', action: () => go('/settings'), keywords: ['settings', '설정'] },
    ]
      .filter((item) => canShowAdminNavItem(user?.role, (item as any).path))
      .map(({ path: _path, ...rest }) => rest);

    const projItems: CommandItem[] = projects.slice(0, 20).map(p => ({
      id: `proj-${p.id}`,
      icon: FolderKanban,
      label: p.name,
      sublabel: `${p.department} · ${p.clientOrg || ''}`,
      category: '프로젝트',
      action: () => go(`/projects/${p.id}`),
      keywords: [p.name, p.department, p.clientOrg || '', p.id],
    }));

    const pendingTx = transactions.filter(t => t.state === 'SUBMITTED').slice(0, 5);
    const txItems: CommandItem[] = pendingTx.map(t => ({
      id: `tx-${t.id}`,
      icon: Clock,
      label: `승인 대기: ${t.counterparty}`,
      sublabel: `${t.amounts.bankAmount.toLocaleString()}원`,
      category: '승인 대기',
      action: () => {
        const proj = projects.find(p => p.id === t.projectId);
        if (proj) {
          go(`/projects/${proj.id}`);
          return;
        }
        const fallback = canShowAdminNavItem(user?.role, '/approvals') ? '/approvals' : '/projects';
        toast.warning('원본 프로젝트를 찾을 수 없어 승인 대기열로 이동합니다.');
        go(fallback);
      },
      keywords: [t.counterparty, t.id],
    }));

    return [...nav, ...txItems, ...projItems];
  }, [projects, transactions, go, user?.role]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.sublabel?.toLowerCase().includes(q) ||
      item.keywords?.some(k => k.toLowerCase().includes(q))
    );
  }, [items, query]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach(item => {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    });
    return map;
  }, [filtered]);

  const flatFiltered = useMemo(() => filtered, [filtered]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, flatFiltered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        flatFiltered[selectedIndex]?.action();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, selectedIndex, flatFiltered]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  if (!open) return null;

  let flatIdx = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 max-w-[560px] overflow-hidden rounded-xl shadow-2xl border-border/40 [&>button]:hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
          <Search className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="검색 또는 명령어 입력..."
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-muted-foreground/60"
          />
          <kbd className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border/60">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[380px] overflow-y-auto py-2">
          {flatFiltered.length === 0 && (
            <div className="text-center py-8 text-[13px] text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              검색 결과가 없습니다
            </div>
          )}
          {Array.from(grouped.entries()).map(([category, catItems]) => (
            <div key={category}>
              <div className="px-4 py-1.5">
                <span className="text-[10px] text-muted-foreground tracking-wider" style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                  {category}
                </span>
              </div>
              {catItems.map(item => {
                flatIdx++;
                const isSelected = flatIdx === selectedIndex;
                const idx = flatIdx;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary/8 text-foreground' : 'text-foreground/80 hover:bg-muted/50'
                    }`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-primary/10' : 'bg-muted/60'
                    }`}>
                      <item.icon className={`w-3.5 h-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate" style={{ fontWeight: isSelected ? 500 : 400 }}>
                        {item.label}
                      </p>
                      {item.sublabel && (
                        <p className="text-[11px] text-muted-foreground truncate">{item.sublabel}</p>
                      )}
                    </div>
                    {isSelected && (
                      <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/60 bg-muted/30">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><kbd className="bg-muted px-1 py-0.5 rounded text-[9px] border">↑↓</kbd> 이동</span>
            <span className="flex items-center gap-1"><kbd className="bg-muted px-1 py-0.5 rounded text-[9px] border">↵</kbd> 선택</span>
            <span className="flex items-center gap-1"><kbd className="bg-muted px-1 py-0.5 rounded text-[9px] border">ESC</kbd> 닫기</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Zap className="w-3 h-3" />
            MYSC Platform
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
