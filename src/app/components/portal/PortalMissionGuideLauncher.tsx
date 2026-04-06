import { useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Sparkles } from 'lucide-react';

import { useAuth } from '../../data/auth-store';
import {
  readPortalGuideAcknowledged,
  writePortalGuideAcknowledged,
} from '../../platform/portal-guide-preferences';
import type { PortalMissionProgress, PortalMissionStep } from '../../platform/portal-mission-guide';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { PortalMissionGuide } from './PortalMissionGuide';

export function PortalMissionGuideLauncher({
  guideId,
  progress,
  resolveStepAction,
}: {
  guideId: string;
  progress: PortalMissionProgress;
  resolveStepAction?: (step: PortalMissionStep) => (() => void) | null | undefined;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const scope = useMemo(() => ({ uid: user?.uid || null, guideId }), [guideId, user?.uid]);

  useEffect(() => {
    const acknowledged = readPortalGuideAcknowledged(scope);
    setDontShowAgain(acknowledged);
    setOpen(!acknowledged);
  }, [scope]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      writePortalGuideAcknowledged(scope, dontShowAgain);
    }
    setOpen(nextOpen);
  };

  return (
    <>
      <div
        data-testid={`portal-mission-guide-launcher-${guideId}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/90 via-white to-teal-50/70 px-4 py-3 shadow-sm"
      >
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-indigo-700">활용 가이드</p>
              <p className="truncate text-[13px] font-semibold text-slate-900">{progress.currentLabel}</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            지금 꼭 필요한 단계만 모달로 보고, 필요할 때만 다시 열 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-indigo-200 bg-white text-[10px] text-indigo-700">
            {progress.completedCount}/{progress.steps.length} 완료
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-[11px]"
            onClick={() => setOpen(true)}
          >
            <BookOpenCheck className="h-3.5 w-3.5" />
            가이드 열기
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-testid={`portal-mission-guide-modal-${guideId}`}
          className="flex h-[min(84vh,860px)] w-[min(960px,calc(100vw-2rem))] max-w-[min(960px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle className="text-[16px] font-semibold text-slate-950">
              {progress.title}
            </DialogTitle>
            <DialogDescription className="text-[12px] leading-6 text-slate-600">
              {progress.subtitle}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <PortalMissionGuide progress={progress} resolveStepAction={resolveStepAction} />
          </div>

          <DialogFooter className="border-t border-slate-200 px-6 py-4">
            <label className="mr-auto flex items-start gap-2 text-[12px] text-slate-600">
              <Checkbox
                checked={dontShowAgain}
                onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                className="mt-0.5"
              />
              <span>숙지했습니다. 다음부터 이 가이드를 자동으로 띄우지 않습니다.</span>
            </label>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
