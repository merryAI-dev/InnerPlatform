import { describe, expect, it } from 'vitest';
import {
  canAdvanceProjectRegisterStep,
  getProjectRegisterSubmitIssues,
} from './project-request-registration';

describe('project-request-registration', () => {
  it('only blocks next while contract processing is running', () => {
    expect(canAdvanceProjectRegisterStep({
      step: 'contract',
      isUploadingContract: true,
      contractAnalysisState: 'extracting',
    })).toBe(false);

    expect(canAdvanceProjectRegisterStep({
      step: 'basic',
      isUploadingContract: false,
      contractAnalysisState: 'idle',
    })).toBe(true);

    expect(canAdvanceProjectRegisterStep({
      step: 'financial',
      isUploadingContract: false,
      contractAnalysisState: 'ready',
    })).toBe(true);
  });

  it('keeps submit-time checks for the minimum required fields', () => {
    const issues = getProjectRegisterSubmitIssues({
      form: {
        department: '',
        name: '',
        contractStart: '',
        contractEnd: '',
        managerName: '',
      },
      hasContractAmountInput: false,
    });

    expect(issues.map((issue) => issue.label)).toEqual([
      '담당팀',
      '등록 프로젝트명',
      '계약 시작일',
      '계약 종료일',
      '계약금액',
      'PM',
    ]);
  });

  it('accepts zero contract amounts when explicitly entered', () => {
    const issues = getProjectRegisterSubmitIssues({
      form: {
        department: 'L-개발협력센터',
        name: '바우처',
        contractStart: '2026-04-01',
        contractEnd: '2026-12-31',
        managerName: '보람',
      },
      hasContractAmountInput: true,
    });

    expect(issues).toEqual([]);
  });
});
