import { createPortal } from 'react-dom';

export type CashflowSheetSyncOperation = 'saving' | 'refresh' | 'staging' | 'applying';

const copy: Record<CashflowSheetSyncOperation, { title: string; detail: string; activeStep: number }> = {
  saving: {
    title: '시트 연결 정보를 저장하고 있습니다',
    detail: '저장하는 동안 화면을 잠시 잠급니다.',
    activeStep: 0,
  },
  refresh: {
    title: '시트 최신값을 가져오고 있습니다',
    detail: '시트 값을 읽어 서버 고정본으로 만들고 있습니다.',
    activeStep: 0,
  },
  staging: {
    title: '시트 변경값을 확인하고 있습니다',
    detail: '월 결산 이후 변경 여부를 확인하고 있습니다.',
    activeStep: 1,
  },
  applying: {
    title: '시트 값을 MYSCube에 반영하고 있습니다',
    detail: '원장 반영이 끝날 때까지 페이지를 닫거나 새로고침하지 마세요.',
    activeStep: 2,
  },
};

const steps = ['시트 읽기', '변경 확인', '원장 반영'];

export function CashflowSheetSyncOverlay({ operation }: { operation: CashflowSheetSyncOperation }) {
  const current = copy[operation];

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-[#EAF4FB]/90 px-5 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="cashflow-sheet-sync-title">
      <div role="status" aria-live="assertive" className="w-full max-w-[360px] rounded-2xl border border-white/80 bg-white/95 px-7 py-8 text-center shadow-[0_24px_60px_rgba(23,50,77,0.20)]">
        <div className="mx-auto flex h-24 items-center justify-center" aria-hidden="true">
          <div className="cashflow-sync-blob" />
        </div>
        <h2 id="cashflow-sheet-sync-title" className="mt-4 text-[17px] font-bold tracking-[-0.02em] text-[#17324D]">{current.title}</h2>
        <p className="mt-2 text-[13px] leading-5 text-slate-600">{current.detail}</p>
        <ol className="mt-6 grid grid-cols-3 gap-1.5 text-[11px] font-semibold">
          {steps.map((step, index) => (
            <li key={step} className={index < current.activeStep ? 'text-[#17324D]' : index === current.activeStep ? 'text-[#17324D]' : 'text-slate-400'}>
              <span className={`mx-auto mb-1.5 block h-1.5 rounded-full ${index < current.activeStep ? 'bg-[#17324D]' : index === current.activeStep ? 'bg-[#6B9ED1]' : 'bg-slate-200'}`} />
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
