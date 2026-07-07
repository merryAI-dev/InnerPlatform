import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  Calculator,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Search,
  SlidersHorizontal,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Project, UserRole } from '../../data/types';
import {
  buildAdminCommandItems,
  searchAdminCommandItems,
  type AdminCommandIcon,
} from '../../platform/admin-command-index';

const ICONS: Record<AdminCommandIcon, LucideIcon> = {
  approval: ListChecks,
  budget: Calculator,
  cashflow: BarChart3,
  dashboard: LayoutDashboard,
  project: FolderKanban,
  settings: SlidersHorizontal,
  users: UserCog,
};

const SUGGESTIONS = ['프로젝트 등록', '계약서', '캐시플로', '권한'];

const SCOPE_STYLE = {
  admin: {
    label: '관리자',
    pill: 'border-sky-200/80 bg-sky-50/75 text-sky-800 shadow-sm backdrop-blur-md dark:border-sky-400/20 dark:bg-sky-950/40 dark:text-sky-200',
    icon: 'bg-sky-50/75 text-sky-800 shadow-inner shadow-white/40 backdrop-blur-md dark:bg-sky-950/40 dark:text-sky-200',
    hover: 'hover:bg-sky-50/70 dark:hover:bg-sky-950/25',
  },
  pm: {
    label: 'PM',
    pill: 'border-emerald-200/80 bg-emerald-50/75 text-emerald-800 shadow-sm backdrop-blur-md dark:border-emerald-400/20 dark:bg-emerald-950/40 dark:text-emerald-200',
    icon: 'bg-emerald-50/75 text-emerald-800 shadow-inner shadow-white/40 backdrop-blur-md dark:bg-emerald-950/40 dark:text-emerald-200',
    hover: 'hover:bg-emerald-50/70 dark:hover:bg-emerald-950/25',
  },
} as const;

export function AdminCommandSearch({
  projects,
  role,
}: {
  projects: Project[];
  role?: UserRole;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const indexItems = useMemo(() => buildAdminCommandItems({
    role,
    projects,
    projectLimit: 24,
  }), [projects, role]);

  const results = useMemo(
    () => searchAdminCommandItems(indexItems, query, query.trim() ? 8 : 5),
    [indexItems, query],
  );

  const showResults = focused || query.trim().length > 0;
  const firstResult = results[0];

  function openResult(path: string) {
    setFocused(false);
    setQuery('');
    navigate(path);
  }

  function submitSearch() {
    if (firstResult) openResult(firstResult.to);
  }

  return (
    <section className="rounded-lg border border-white/60 bg-white/50 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
      <div className="p-3 md:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${SCOPE_STYLE.admin.pill}`}>
            관리자
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${SCOPE_STYLE.pm.pill}`}>
            PM
          </span>
          <span className="text-[11px] text-muted-foreground">색상으로 이동 공간을 구분합니다.</span>
        </div>
        <div className="flex min-h-[56px] items-center gap-3 rounded-lg border border-slate-300/70 bg-white/65 px-4 shadow-inner shadow-white/50 backdrop-blur-xl transition-all hover:border-sky-300 hover:bg-white/80 hover:shadow-lg hover:shadow-sky-900/10 hover:ring-2 hover:ring-sky-100 focus-within:border-sky-400 focus-within:bg-white/85 focus-within:shadow-lg focus-within:shadow-sky-900/10 focus-within:ring-2 focus-within:ring-sky-100 dark:border-white/15 dark:bg-slate-900/50 dark:shadow-none dark:hover:border-sky-600 dark:hover:bg-slate-900/70 dark:hover:ring-sky-900/40 dark:focus-within:border-sky-600 dark:focus-within:bg-slate-900/75">
          <Search className="h-5 w-5 shrink-0 text-slate-500" />
          <input
            value={query}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitSearch();
              }
            }}
            aria-label="기능 검색"
            placeholder="담당 프로젝트, 기능, 계약서, 캐시플로, 권한 검색"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-slate-950 outline-none placeholder:text-slate-500 dark:text-slate-50 dark:placeholder:text-slate-400"
          />
          <kbd className="hidden rounded-md border border-white/70 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-500 shadow-sm backdrop-blur-md sm:inline-flex dark:border-white/10 dark:bg-slate-900/70">
            Enter
          </kbd>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="h-8 rounded-full border border-white/70 bg-white/50 px-3 text-[11px] font-medium text-slate-700 shadow-sm backdrop-blur-md transition-colors hover:border-sky-200 hover:bg-sky-50/80 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {showResults && (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
            {results.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-muted-foreground">
                검색 결과가 없습니다
              </div>
            ) : (
              <div className="divide-y divide-white/60 dark:divide-white/10">
                {results.map((item) => {
                  const Icon = ICONS[item.icon];
                  const style = SCOPE_STYLE[item.scope];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openResult(item.to)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-200 ${style.hover}`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.icon}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-950 dark:text-slate-50">
                          {item.label}
                        </span>
                        {item.description && (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span className={`hidden rounded-full border px-2 py-1 text-[10px] font-semibold sm:block ${style.pill}`}>
                        {style.label}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
