import { useMemo } from 'react';
import {
  CheckCircle2,
  Chrome,
  ExternalLink,
  Home,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Button } from '../ui/button';
import {
  getPwaInstallTarget,
  resolvePwaInstallTarget,
  type PwaInstallPlatform,
} from '../../platform/pwa-install';

const PLATFORM_LINKS: Array<{ platform: PwaInstallPlatform; label: string; icon: typeof Smartphone }> = [
  { platform: 'ios', label: 'iPhone', icon: Smartphone },
  { platform: 'android', label: 'Android', icon: Chrome },
  { platform: 'desktop', label: 'Desktop', icon: MonitorSmartphone },
];

function readUserAgent() {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent;
}

export function PwaInstallPage() {
  const location = useLocation();
  const target = useMemo(
    () => resolvePwaInstallTarget(location.pathname, readUserAgent()),
    [location.pathname],
  );

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#e0f2fe_0,#f8fbff_34%,#eef6ff_100%)] px-4 py-6 text-slate-950 dark:bg-[radial-gradient(circle_at_top_left,#0f2747_0,#061a2f_44%,#020617_100%)] dark:text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-3 rounded-lg border border-white/70 bg-white/70 px-3 py-2 shadow-sm backdrop-blur-xl transition hover:border-sky-200 hover:bg-white/90 dark:border-white/10 dark:bg-slate-950/50 dark:hover:border-sky-300/30">
            <img src="/pwa/myscube-icon-192.png" alt="MYSCube" className="h-9 w-9 rounded-md" />
            <span className="text-sm font-extrabold tracking-tight">MYSCube</span>
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <Home className="h-4 w-4" />
              홈으로
            </Link>
          </Button>
        </header>

        <section className="overflow-hidden rounded-lg border border-white/70 bg-white/70 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/50">
          <div className="border-b border-white/60 bg-[#0f2747] px-5 py-6 text-white sm:px-7">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-sky-100/80">{target.eyebrow}</p>
            <h1 className="mt-3 max-w-3xl text-[30px] font-extrabold leading-tight sm:text-[42px]">{target.title}</h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-7 text-sky-50/85">{target.summary}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild>
                <Link to={target.primaryActionHref}>
                  <ExternalLink className="h-4 w-4" />
                  {target.primaryActionLabel}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="/manifest.webmanifest" target="_blank" rel="noreferrer">
                  <ShieldCheck className="h-4 w-4" />
                  Manifest 확인
                </a>
              </Button>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[220px_1fr]">
            <nav className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="PWA 설치 플랫폼">
              {PLATFORM_LINKS.map(({ platform, label, icon: Icon }) => {
                const item = getPwaInstallTarget(platform);
                const active = target.platform === platform;
                return (
                  <Link
                    key={platform}
                    to={item.endpoint}
                    className={`rounded-lg border px-3 py-3 transition ${
                      active
                        ? 'border-sky-200 bg-white text-[#0f2747] shadow-md shadow-sky-900/10 dark:border-sky-300/30 dark:bg-sky-950/35 dark:text-sky-100'
                        : 'border-white/70 bg-white/45 text-slate-700 hover:border-sky-200 hover:bg-white/80 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-bold">
                      <Icon className="h-4 w-4" />
                      {label}
                    </span>
                    <span className="mt-1 block text-[12px] leading-5 opacity-75">{item.endpoint}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200/80 bg-white/75 p-4 dark:border-white/10 dark:bg-slate-900/45">
                <h2 className="text-sm font-extrabold text-slate-950 dark:text-slate-100">설치 순서</h2>
                <ol className="mt-3 grid gap-2">
                  {target.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 rounded-md bg-slate-50/80 px-3 py-2 text-sm leading-6 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f2747] text-[12px] font-bold text-white">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 p-4 dark:border-emerald-300/20 dark:bg-emerald-950/20">
                <h2 className="text-sm font-extrabold text-emerald-950 dark:text-emerald-100">설치 후 확인</h2>
                <ul className="mt-3 grid gap-2">
                  {target.checks.map((check) => (
                    <li key={check} className="flex gap-2 text-sm leading-6 text-emerald-900 dark:text-emerald-100">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0" />
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
