import { CheckCircle2, ChevronRight, CircleDotDashed, Flag, Lock, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { cn } from '../ui/utils';
import type { PortalMissionProgress, PortalMissionStep } from '../../platform/portal-mission-guide';

function StepIcon({ step }: { step: PortalMissionStep }) {
  if (step.status === 'complete') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (step.status === 'attention') return <Flag className="h-4 w-4 text-amber-600" />;
  if (step.status === 'active') return <CircleDotDashed className="h-4 w-4 text-indigo-600" />;
  return <Lock className="h-4 w-4 text-slate-400" />;
}

export function PortalMissionGuide({
  progress,
  compact = false,
}: {
  progress: PortalMissionProgress;
  compact?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <Card
      data-testid="portal-mission-guide"
      className={cn(
        'border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-teal-50/70 shadow-sm',
        compact ? 'rounded-xl' : 'rounded-2xl',
      )}
    >
      <CardContent className={cn(compact ? 'px-4 py-4' : 'px-5 py-5')}>
        <div className={cn('flex items-start justify-between gap-4', compact && 'flex-col')}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-700">Guided Start</p>
                <h3 className="text-sm font-bold text-slate-900">{progress.title}</h3>
              </div>
            </div>
            <p className="text-[12px] text-slate-700">{progress.currentLabel}</p>
            {!compact && <p className="text-[11px] text-muted-foreground">{progress.subtitle}</p>}
          </div>
          <Badge variant="outline" className="border-indigo-200 bg-white text-[10px] text-indigo-700">
            {progress.completedCount}/{progress.steps.length} 완료
          </Badge>
        </div>

        <div className={cn('mt-4 grid gap-2', compact ? 'grid-cols-1' : 'md:grid-cols-3')}>
          {progress.steps.map((step) => {
            const isActive = step.id === progress.activeStep.id;
            return (
              <div
                key={step.id}
                data-testid={isActive ? 'portal-mission-active-step' : undefined}
                className={cn(
                  'rounded-xl border px-3 py-3 transition-colors',
                  step.status === 'complete' && 'border-emerald-200 bg-emerald-50/80',
                  step.status === 'active' && 'border-indigo-300 bg-white shadow-sm',
                  step.status === 'attention' && 'border-amber-300 bg-amber-50/80',
                  step.status === 'locked' && 'border-slate-200 bg-slate-50/80',
                )}
              >
                <div className="flex items-center gap-2">
                  <StepIcon step={step} />
                  <span className="text-[11px] font-semibold text-slate-900">STEP {step.order}</span>
                  {isActive && (
                    <Badge className="ml-auto bg-indigo-600 text-[10px] text-white">지금 할 일</Badge>
                  )}
                </div>
                <p className="mt-2 text-[13px] font-semibold text-slate-900">{step.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-600">{step.description}</p>
                {isActive && step.ctaLabel && step.ctaPath && (
                  <Button
                    size="sm"
                    className="mt-3 h-8 gap-1.5 text-[11px]"
                    onClick={() => navigate(step.ctaPath!)}
                  >
                    {step.ctaLabel}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
