import { describe, expect, it } from 'vitest';
import { isLiveMyscguardHost, shouldShowStageOnlyCashflowSheetLab } from './deployment-surface';

describe('deployment surface visibility', () => {
  it('treats live myscguard hosts as live surfaces', () => {
    expect(isLiveMyscguardHost('myscube.myscguard.app')).toBe(true);
    expect(isLiveMyscguardHost('soc.myscguard.app')).toBe(true);
    expect(shouldShowStageOnlyCashflowSheetLab('myscube.myscguard.app')).toBe(false);
  });

  it('keeps stage and preview hosts eligible for stage-only sheet lab work', () => {
    expect(isLiveMyscguardHost('inner-platform-stage-merryai-devs-projects.vercel.app')).toBe(false);
    expect(shouldShowStageOnlyCashflowSheetLab('inner-platform-stage-merryai-devs-projects.vercel.app')).toBe(true);
    expect(shouldShowStageOnlyCashflowSheetLab('inner-platform-7lwazqaf6-merryai-devs-projects.vercel.app')).toBe(true);
    expect(shouldShowStageOnlyCashflowSheetLab('localhost')).toBe(true);
  });
});
