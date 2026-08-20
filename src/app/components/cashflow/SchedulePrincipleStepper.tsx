import { Check } from 'lucide-react';
import { cn } from '../ui/utils';
import { formatDeadlineLabel } from './cashflow-schedule-steps';

/**
 * 이번 달 마감 일정을 화면 맨 위에 한 번 보여주고, 단계마다 그 자리에 있는 사업 수를 센다.
 *
 * `CashflowScheduleBar` 와 목적이 다르다. 그쪽은 **사업 하나의 상태**를 행마다 그리고,
 * 이쪽은 **전사 집계**를 화면당 한 번 그린다. 2026-08-20 에 승인 테이블의 compact bar 가
 * 배지보다 헷갈린다는 이유로 되돌려졌는데(#621), 그 되돌림은 "행마다 상태를 바 모양으로
 * 그린 것" 에 대한 것이다. 여기서는 행을 대체하지 않고 배지가 세던 수를 위에서 합친다.
 *
 * 아직 하지 않은 사업은 빨간색이다. 남은 일이 몇 건인지가 이 화면의 요점이라, 0 건이 되면
 * 강조를 거둔다 - 늘 빨간 화면은 아무것도 알려주지 않는다.
 */

export interface SchedulePrincipleStep {
  label: string;
  /** 이 단계에 있는 사업 수. 세지 못했으면 비운다 - 0 과 "모름" 은 다르다. */
  count?: number | null;
  /** 마감 시각(ISO). 없으면 note 를 쓴다. 날짜를 지어내지 않는다. */
  deadline?: string | null;
  note?: string;
  /** 아직 하지 않은 일. 남아 있으면 빨갛게 센다. */
  pending?: boolean;
}

export function SchedulePrincipleStepper({
  title,
  steps,
  nowIso,
  className = '',
}: {
  title: string;
  steps: SchedulePrincipleStep[];
  nowIso: string;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white px-4 py-3', className)}>
      <p className="text-[12px] font-semibold text-slate-700">{title}</p>
      <ol className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        {steps.map((step, index) => {
          const counted = typeof step.count === 'number';
          const remaining = Boolean(step.pending) && counted && (step.count as number) > 0;
          const cleared = Boolean(step.pending) && counted && step.count === 0;
          const detail = step.deadline ? formatDeadlineLabel(step.deadline, nowIso) : (step.note || '');
          return (
            <li key={step.label} className="flex flex-1 items-start gap-2 sm:flex-col sm:items-center sm:text-center">
              <div className="flex w-full items-center gap-2 sm:justify-center">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                    remaining && 'border-[#e11d48] bg-[#e11d48] text-white',
                    cleared && 'border-[#001e46] bg-[#001e46] text-white',
                    !remaining && !cleared && 'border-slate-300 bg-white text-slate-600',
                  )}
                >
                  {cleared ? <Check className="h-3.5 w-3.5" /> : counted ? step.count : index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span aria-hidden className="hidden h-px flex-1 bg-slate-200 sm:block" />
                ) : null}
              </div>
              <div className="min-w-0 sm:mt-2">
                <p className={cn('text-[13px]', remaining ? 'font-semibold text-[#e11d48]' : 'text-slate-700')}>
                  {step.label}
                  {counted ? <span className="ml-1 text-[11px] font-normal text-slate-500">{step.count}건</span> : null}
                </p>
                {detail ? <p className="mt-0.5 text-[11px] text-slate-500">{detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
