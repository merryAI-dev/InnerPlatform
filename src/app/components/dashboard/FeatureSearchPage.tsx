import { useState } from 'react';
import { ArrowRight, Building2, UserRoundCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { AdminCommandSearch } from './AdminCommandSearch';
import { MyscWordmark } from '../brand/MyscWordmark';

const ADMIN_ENTRY_POINTS = [
  { label: '전체 프로젝트 보기', to: '/projects', description: '프로젝트 목록, 담당조직, PM, 발주기관을 확인합니다.' },
  { label: '프로젝트 등록/승인', to: '/projects/migration-audit', description: '신규 등록 요청, 수정 제출, 계약서 PDF 검토를 처리합니다.' },
  { label: '캐시플로 모니터링', to: '/cashflow', description: '입금, 지출, 계약금, 지원금, 수익 흐름을 확인합니다.' },
  { label: '권한/사용자', to: '/users', description: '사용자 역할, 조직장, 접근 권한을 관리합니다.' },
];

const PM_ENTRY_POINTS = [
  { label: '내 프로젝트 현황', to: '/portal' },
  { label: '예산 편집', to: '/portal/budget' },
  { label: '사업비 입력', to: '/portal/weekly-expenses' },
  { label: '프로젝트 등록 요청', to: '/portal/register-project' },
];

export function FeatureSearchPage() {
  const { projects } = useAppStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.name?.trim() || '구성원';
  const [activeAdminEntry, setActiveAdminEntry] = useState<(typeof ADMIN_ENTRY_POINTS)[number] | null>(null);

  return (
    <div className="min-h-dvh bg-[linear-gradient(135deg,#eef6ff_0%,#f8fbff_46%,#ecfdf5_100%)] px-4 py-5 dark:bg-[linear-gradient(135deg,#061a2f_0%,#0f172a_52%,#052e2b_100%)] md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-6xl flex-col justify-center space-y-5 md:min-h-[calc(100dvh-4rem)]">
        <section className="overflow-hidden rounded-lg border border-white/60 bg-white/50 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
          <div className="border-b border-white/20 bg-[#0f2747]/90 px-5 py-5 text-white shadow-inner shadow-white/5 backdrop-blur-xl md:px-7">
            <MyscWordmark tone="onDark" size="md" />
          </div>
          <div className="space-y-5 px-5 py-6 md:px-7 md:py-8">
            <div className="max-w-3xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300">
                Feature Search
              </p>
              <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-slate-950 dark:text-slate-50 md:text-[38px]">
                안녕하세요, {displayName} 사내기업가님
              </h1>
              <p className="mt-3 text-[14px] leading-6 text-slate-600 dark:text-slate-300">
                아래 검색창에서 원하시는 기능을 바로 탐색하실 수 있습니다.
              </p>
            </div>

            <AdminCommandSearch projects={projects} role={user?.role} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section
            className="rounded-lg border border-white/60 bg-sky-50/50 p-4 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-sky-400/20 dark:bg-sky-950/25"
            onMouseLeave={() => setActiveAdminEntry(null)}
          >
            <div className="flex items-center gap-2 text-sky-900 dark:text-sky-200">
              <Building2 className="h-4 w-4" />
              <h2 className="text-[13px] font-bold">관리자</h2>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {ADMIN_ENTRY_POINTS.map((item) => (
                  <button
                    key={item.to}
                    type="button"
                    aria-describedby="admin-entry-memo"
                    onMouseEnter={() => setActiveAdminEntry(item)}
                    onFocus={() => setActiveAdminEntry(item)}
                    onClick={() => navigate(item.to)}
                    className="flex h-10 w-full items-center justify-between rounded-lg border border-white/70 bg-white/60 px-3 text-left text-[12px] font-semibold text-sky-950 shadow-sm backdrop-blur-md transition-colors hover:border-sky-200 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:border-sky-400/20 dark:bg-slate-950/50 dark:text-sky-200 dark:hover:bg-sky-950/30"
                  >
                    {item.label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <div
                id="admin-entry-memo"
                role="note"
                aria-live="polite"
                className={`relative min-h-[88px] rounded-lg border border-sky-100/80 bg-white/75 px-3 py-2.5 text-[11px] font-medium leading-5 text-sky-950 shadow-lg shadow-slate-900/5 backdrop-blur-xl transition-all duration-150 dark:border-sky-400/20 dark:bg-slate-950/55 dark:text-sky-100 ${
                  activeAdminEntry
                    ? 'translate-x-0 opacity-100'
                    : 'translate-x-1 opacity-45'
                }`}
              >
                <span className="absolute right-0 top-0 h-0 w-0 border-b-[12px] border-l-[12px] border-b-sky-100/90 border-l-transparent dark:border-b-sky-400/25" />
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-sky-600 dark:text-sky-300">
                  Memo
                </span>
                <span className="block">
                  {activeAdminEntry?.description || ADMIN_ENTRY_POINTS[0].description}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-emerald-50/50 p-4 shadow-lg shadow-slate-900/5 backdrop-blur-xl dark:border-emerald-400/20 dark:bg-emerald-950/25">
            <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200">
              <UserRoundCheck className="h-4 w-4" />
              <h2 className="text-[13px] font-bold">PM</h2>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {PM_ENTRY_POINTS.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => navigate(item.to)}
                  className="flex h-10 items-center justify-between rounded-lg border border-white/70 bg-white/60 px-3 text-left text-[12px] font-semibold text-emerald-950 shadow-sm backdrop-blur-md transition-colors hover:border-emerald-200 hover:bg-white/80 dark:border-emerald-400/20 dark:bg-slate-950/50 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
                >
                  {item.label}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
