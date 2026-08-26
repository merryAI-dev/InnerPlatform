import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
      compact
      onExecutiveApproverSaved={(result) => patchProjectSnapshot({ ...project, ...result })}
    />
  );
}

export function CashflowExportProjectPane({ project, yearMonth, onClose }: CashflowExportProjectPaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const desktopSlotRef = useRef<HTMLDivElement>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [desktopFrame, setDesktopFrame] = useState<{ left: number; width: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  ));

  useEffect(() => {
    const handlePaneKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const pane = paneRef.current;
      const blockingDialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .some((element) => element !== pane && element.getClientRects().length > 0);
      if (blockingDialog) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !isMobile || !pane) return;
      const focusable = [...pane.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !pane.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !pane.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handlePaneKeyboard);
    return () => window.removeEventListener('keydown', handlePaneKeyboard);
  }, [isMobile, onClose]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 1023px)');
    const syncMobile = () => {
      pendingScrollTopRef.current = scrollRef.current?.scrollTop ?? null;
      setIsMobile(mobile.matches);
    };
    syncMobile();
    mobile.addEventListener('change', syncMobile);
    return () => {
      mobile.removeEventListener('change', syncMobile);
    };
  }, []);

  useLayoutEffect(() => {
    const savedScrollTop = pendingScrollTopRef.current;
    const container = scrollRef.current;
    if (savedScrollTop === null || !container) return undefined;
    container.scrollTop = savedScrollTop;
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop;
      pendingScrollTopRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobile]);

  useLayoutEffect(() => {
    const slot = desktopSlotRef.current;
    if (!slot || isMobile) return undefined;
    const syncFrame = () => {
      const rect = slot.getBoundingClientRect();
      setDesktopFrame({ left: rect.left, width: rect.width });
    };
    syncFrame();
    const observer = new ResizeObserver(syncFrame);
    observer.observe(slot);
    const main = slot.closest('main');
    if (main) observer.observe(main);
    window.addEventListener('resize', syncFrame);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncFrame);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile]);

  useEffect(() => () => {
    const target = returnFocusRef.current;
    if (!target || !document.contains(target)) return;
    window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      const target = container?.querySelector('#projection-actual-comparison');
      if (!container || !target) return;
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top });
      (isMobile ? closeButtonRef.current : container)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [project.id]);

  const pane = (
    <aside
      ref={paneRef}
      data-testid="cashflow-export-project-pane"
      aria-label={`${project.name} 상세`}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? true : undefined}
      style={!isMobile && desktopFrame ? { left: desktopFrame.left, width: desktopFrame.width } : undefined}
      className={isMobile
        ? 'fixed inset-0 z-50 flex h-dvh w-full min-w-0 flex-col overflow-hidden bg-stone-50 shadow-xl'
        : `fixed bottom-[42px] top-[64px] z-20 flex min-w-0 flex-col overflow-hidden border border-stone-200 bg-stone-50 shadow-sm ${desktopFrame ? '' : 'invisible'}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">사업 상세</p>
          <h2 className="truncate text-[14px] font-semibold text-zinc-950">{project.name}</h2>
        </div>
        <Button
          ref={closeButtonRef}
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
        data-testid="cashflow-export-project-pane-scroll"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto [overflow-anchor:none] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-300 lg:p-4"
      >
        <CashflowWeekProvider key={project.id}>
          <CashflowExportProjectPaneBody project={project} yearMonth={yearMonth} />
        </CashflowWeekProvider>
      </div>
    </aside>
  );

  return (
    <>
      <div ref={desktopSlotRef} data-testid="cashflow-export-project-pane-slot" aria-hidden="true" className="hidden min-w-0 lg:block" />
      {createPortal(pane, document.body)}
    </>
  );
}
