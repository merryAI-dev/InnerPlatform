import { describe, expect, it } from 'vitest';
import { isLiveMyscguardHost, shouldShowCashflowSheetLab } from './deployment-surface';

describe('deployment surface visibility', () => {
  it('treats live myscguard hosts as live surfaces', () => {
    expect(isLiveMyscguardHost('myscube.myscguard.app')).toBe(true);
    expect(isLiveMyscguardHost('soc.myscguard.app')).toBe(true);
    expect(shouldShowCashflowSheetLab('myscube.myscguard.app')).toBe(true);
  });

  it('does not classify preview or unknown hosts as live', () => {
    expect(isLiveMyscguardHost('inner-platform-preview-merryai-devs-projects.vercel.app')).toBe(false);
    expect(isLiveMyscguardHost('unknown.myscguard.app')).toBe(false);
    expect(shouldShowCashflowSheetLab('inner-platform-preview-merryai-devs-projects.vercel.app')).toBe(true);
    expect(shouldShowCashflowSheetLab('inner-platform-7lwazqaf6-merryai-devs-projects.vercel.app')).toBe(true);
    expect(shouldShowCashflowSheetLab('localhost')).toBe(true);
  });
});
