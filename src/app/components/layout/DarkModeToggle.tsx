import { useState, useEffect, useCallback } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function DarkModeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('mysc-theme') as Theme) || 'light';
    }
    return 'light';
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('mysc-theme', theme);
  }, [theme]);

  // Listen for system theme changes if theme === 'system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  }, []);

  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  const label = theme === 'dark' ? '다크 모드' : theme === 'system' ? '시스템 설정' : '라이트 모드';

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={cycle}
            className="w-full flex items-center justify-center h-8 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-[11px]">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={cycle}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      <span className="ml-auto text-[9px] text-slate-600 bg-slate-800 px-1 py-0.5 rounded">
        {theme === 'light' ? 'L' : theme === 'dark' ? 'D' : 'A'}
      </span>
    </button>
  );
}
