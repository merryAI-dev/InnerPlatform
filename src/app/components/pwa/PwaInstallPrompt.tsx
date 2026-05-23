import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Smartphone } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../ui/button';
import {
  getPwaInstallPlatform,
  getPwaInstallTarget,
} from '../../platform/pwa-install';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const platform = useMemo(() => {
    if (typeof navigator === 'undefined') return 'desktop';
    return getPwaInstallPlatform(navigator.userAgent);
  }, []);
  const target = getPwaInstallTarget(platform);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  async function handleInstallClick() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    setInstallEvent(null);
  }

  return (
    <section className="rounded-lg border border-white/70 bg-white/65 p-4 shadow-sm shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#0f2747] text-white">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-slate-950 dark:text-slate-100">MYSCube 앱으로 열기</p>
            <p className="mt-1 text-[13px] leading-6 text-slate-600 dark:text-slate-300">{target.summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {installEvent ? (
            <Button type="button" size="sm" onClick={handleInstallClick}>
              <Download className="h-4 w-4" />
              설치
            </Button>
          ) : null}
          <Button asChild type="button" size="sm" variant="outline">
            <Link to={target.endpoint}>
              <ExternalLink className="h-4 w-4" />
              설치 안내
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
