import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  Banknote,
  BarChart3,
  Calculator,
  CircleDollarSign,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Pencil,
  Search,
  SlidersHorizontal,
  UserCog,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DialogContent } from '../ui/dialog';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { canShowAdminNavItem } from '../../platform/admin-nav';
import { shouldShowShellRoute, useShellLabEnabled } from '../../platform/shell-lab-visibility';
import { toast } from 'sonner';
import { resolveGoShortcutTarget } from '../../platform/go-shortcuts';
import {
  buildAdminCommandItems,
  searchAdminCommandItems,
  type AdminCommandIcon,
} from '../../platform/admin-command-index';

interface CommandItem {
  id: string;
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  category: string;
  action: () => void;
}

const COMMAND_ICON_MAP: Record<AdminCommandIcon, LucideIcon> = {
  approval: ListChecks,
  bank: Banknote,
  budget: Calculator,
  cashflow: BarChart3,
  dashboard: LayoutDashboard,
  expense: Pencil,
  payroll: CircleDollarSign,
  project: FolderKanban,
  search: Search,
  settings: SlidersHorizontal,
  users: UserCog,
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { user } = useAuth();
  const [labEnabled] = useShellLabEnabled();
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

  // ⌘K / Ctrl+K + sequence shortcuts (G then D/P/M/C/E/S)
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
        if (!shouldShowShellRoute(targetPath, 'admin', 'shortcut', { labEnabled })) {
          toast.warning('LAB 메뉴는 LAB 토글을 켠 뒤 사용할 수 있습니다.');
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

    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearGoPrefix();
    };
  }, [armGoPrefix, clearGoPrefix, go, labEnabled, user?.role]);

  const indexedItems = useMemo(() => buildAdminCommandItems({
    role: user?.role,
    projects,
  }), [projects, user?.role]);

  const items: CommandItem[] = useMemo(() => {
    return searchAdminCommandItems(indexedItems, query, query.trim() ? 12 : 18)
      .map((item) => ({
        id: item.id,
        icon: COMMAND_ICON_MAP[item.icon],
        label: item.label,
        sublabel: item.description,
        category: item.category,
        action: () => go(item.to),
      }));
  }, [go, indexedItems, query]);

  const filtered = items;

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
