import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { CashflowWeekProvider, useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAppStore } from '../../data/store';
import type { Project } from '../../data/types';
import { Button } from '../ui/button';
import { CashflowProjectSheet } from './CashflowProjectSheet';

interface CashflowExportProjectPaneProps {
  project: Project;
  yearMonth: string;
  onClose: () => void;
}

function CashflowExportProjectPaneBody({ project, yearMonth }: Omit<CashflowExportProjectPaneProps, 'onClose'>) {
  const { members, patchProjectSnapshot } = useAppStore();
  const { setYearMonth } = useCashflowWeeks();

  useEffect(() => {
    setYearMonth(yearMonth);
  }, [setYearMonth, yearMonth]);

  return (
    <CashflowProjectSheet
      key={project.id}
      projectId={project.id}
      projectName={project.name}
      project={project}
      members={members}
      onExecutiveApproverSaved={(result) => patchProjectSnapshot({ ...project, ...result })}
    />
  );
}

export function CashflowExportProjectPane({ project, yearMonth, onClose }: CashflowExportProjectPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  ));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 1023px)');
    const syncMobile = () => setIsMobile(mobile.matches);
    syncMobile();
    mobile.addEventListener('change', syncMobile);
    return () => {
      mobile.removeEventListener('change', syncMobile);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const target = container?.querySelector('#projection-actual-comparison');
      if (!container || !target) return;
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top });
      container.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [project.id]);

  const pane = (
    <aside
      data-testid="cashflow-export-project-pane"
      aria-label={`${project.name} 상세`}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? true : undefined}
      className={isMobile
        ? 'fixed inset-0 z-50 flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-stone-50 shadow-xl'
        : 'sticky top-4 z-20 flex h-[calc(100vh-2rem)] w-full min-w-0 flex-col overflow-hidden border border-stone-200 bg-stone-50 shadow-sm'}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">사업 상세</p>
          <h2 className="truncate text-[14px] font-semibold text-zinc-950">{project.name}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${project.name} 상세 닫기`}
          onClick={onClose}
          className="h-8 w-8 shrink-0 rounded-lg text-stone-600 hover:bg-stone-100 hover:text-zinc-950"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-300 lg:p-4"
      >
        <CashflowWeekProvider key={project.id}>
          <CashflowExportProjectPaneBody project={project} yearMonth={yearMonth} />
        </CashflowWeekProvider>
      </div>
    </aside>
  );

  return isMobile ? createPortal(pane, document.body) : pane;
}
