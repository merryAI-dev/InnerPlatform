import { Check } from 'lucide-react';
import type { ScheduleStep, ScheduleStepState } from './cashflow-schedule-steps';

// 정산 일정 진행 바. 단계 판정은 cashflow-schedule-steps 가 하고 여기서는 그리기만 한다.
// 색은 DESIGN.md 계열만 쓴다 - 참고 이미지의 보라 계열은 금지 색이다.
const DOT: Record<ScheduleStepState, string> = {
  done: 'border-[#001e46] bg-[#001e46] text-white',
  done_late: 'border-[#001e46] bg-[#001e46] text-white',
  current: 'border-[#0176D3] bg-white text-[#0176D3] ring-2 ring-[#0176D3]/20',
  overdue: 'border-[#e11d48] bg-[#e11d48] text-white',
  upcoming: 'border-slate-300 bg-white text-slate-400',
};

const LABEL: Record<ScheduleStepState, string> = {
  done: 'text-slate-700',
  done_late: 'text-slate-700',
  current: 'font-semibold text-[#0176D3]',
  overdue: 'font-semibold text-[#e11d48]',
  upcoming: 'text-slate-400',
};

const DETAIL: Record<ScheduleStepState, string> = {
  done: 'text-slate-500',
  done_late: 'text-[#e11d48]',
  current: 'text-slate-600',
  overdue: 'text-[#e11d48]',
  upcoming: 'text-slate-400',
};

const STATE_TEXT: Record<ScheduleStepState, string> = {
  done: '완료',
  done_late: '완료 · 기한 초과',
  current: '진행 중',
  overdue: '기한 지남',
  upcoming: '대기',
};

export function CashflowScheduleBar({ steps, className = '' }: { steps: ScheduleStep[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={`flex items-start gap-0 ${className}`.trim()}>
      {steps.map((step, index) => (
        <li key={step.key} className={`flex min-w-0 items-start gap-2 ${index > 0 ? 'flex-1' : ''}`}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`mt-2.5 h-px flex-1 ${steps[index - 1].state === 'upcoming' ? 'bg-slate-200' : 'bg-[#001e46]/30'}`}
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
