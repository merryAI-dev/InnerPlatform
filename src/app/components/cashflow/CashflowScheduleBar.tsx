import { Check } from 'lucide-react';
import type { ScheduleStep, ScheduleStepState } from './cashflow-schedule-steps';

// 정산 일정 진행 바. 단계 판정은 cashflow-schedule-steps 가 하고 여기서는 그리기만 한다.
// 색은 캐시플로 ERP 언어(#17324D 네이비 · red 는 오류에만)를 따른다. 보라 계열은 금지 색이다.
const DOT: Record<ScheduleStepState, string> = {
  done: 'border-[#17324D] bg-[#17324D] text-white',
  done_late: 'border-[#17324D] bg-[#17324D] text-white',
  current: 'border-[#17324D] bg-white text-[#17324D] ring-2 ring-[#17324D]/15',
  overdue: 'border-red-600 bg-red-600 text-white',
  upcoming: 'border-slate-300 bg-white text-slate-400',
};

const LABEL: Record<ScheduleStepState, string> = {
  done: 'text-slate-700',
  done_late: 'text-slate-700',
  current: 'font-semibold text-[#17324D]',
  overdue: 'font-semibold text-red-700',
  upcoming: 'text-slate-400',
};

const DETAIL: Record<ScheduleStepState, string> = {
  done: 'text-slate-500',
  done_late: 'text-red-700',
  current: 'text-slate-600',
  overdue: 'text-red-700',
  upcoming: 'text-slate-400',
};

const STATE_TEXT: Record<ScheduleStepState, string> = {
  done: '완료',
  done_late: '완료 · 기한 초과',
  current: '진행 중',
  overdue: '기한 지남',
  upcoming: '대기',
};

/** 표 안처럼 좁은 자리용. 점만 보여주고 지금 단계의 한 줄만 아래에 적는다. */
export function CashflowScheduleBarCompact({ steps, className = '' }: { steps: ScheduleStep[]; className?: string }) {
  if (steps.length === 0) return null;
  const active = steps.find((step) => step.state === 'overdue' || step.state === 'current') || steps[steps.length - 1];
  return (
    <div className={`flex flex-col items-center gap-1 ${className}`.trim()}>
      <div className="flex items-center gap-1">
        {steps.map((step, index) => (
          <span key={step.key} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true" className={`h-px w-4 ${steps[index - 1].state === 'upcoming' ? 'bg-slate-200' : 'bg-[#17324D]/30'}`} /> : null}
            <span
              title={`${step.label} · ${STATE_TEXT[step.state]}${step.detail ? ` · ${step.detail}` : ''}`}
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${DOT[step.state]}`}
            >
              {step.state === 'done' || step.state === 'done_late'
                ? <Check className="h-2.5 w-2.5" aria-hidden="true" />
                : <span className="h-1 w-1 rounded-full bg-current" aria-hidden="true" />}
              <span className="sr-only">{step.label} · {STATE_TEXT[step.state]}</span>
            </span>
          </span>
        ))}
      </div>
      <span className={`text-[11px] leading-4 ${DETAIL[active.state]}`}>{active.detail || STATE_TEXT[active.state]}</span>
    </div>
  );
}

export function CashflowScheduleBar({ steps, className = '' }: { steps: ScheduleStep[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={`flex items-start gap-0 ${className}`.trim()}>
      {steps.map((step, index) => (
        <li key={step.key} className={`flex min-w-0 items-start gap-2 ${index > 0 ? 'flex-1' : ''}`}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`mt-2.5 h-px flex-1 ${steps[index - 1].state === 'upcoming' ? 'bg-slate-200' : 'bg-[#17324D]/30'}`}
            />
          ) : null}
          <div className="flex min-w-0 items-start gap-1.5">
            <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${DOT[step.state]}`}>
              {step.state === 'done' || step.state === 'done_late'
                ? <Check className="h-3 w-3" aria-hidden="true" />
                : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <div className={`text-[12px] leading-4 ${LABEL[step.state]}`}>
                {step.label}
                <span className="sr-only"> · {STATE_TEXT[step.state]}</span>
              </div>
              {step.detail ? <div className={`text-[11px] leading-4 ${DETAIL[step.state]}`}>{step.detail}</div> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
