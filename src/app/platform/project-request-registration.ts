export type ProjectRegisterStep = 'contract' | 'basic' | 'financial' | 'team' | 'review';

export interface ProjectRegisterNextState {
  step: ProjectRegisterStep;
  isUploadingContract: boolean;
  contractAnalysisState: 'idle' | 'extracting' | 'analyzing' | 'ready' | 'error';
}

export interface ProjectRegisterDraftLike {
  department: string;
  name: string;
  contractStart: string;
  contractEnd: string;
  managerName: string;
}

export interface ProjectRegisterSubmitContext {
  form: ProjectRegisterDraftLike;
  hasContractAmountInput: boolean;
}

export interface ProjectRegisterSubmitIssue {
  step: Exclude<ProjectRegisterStep, 'review'>;
  label: string;
}

export function canAdvanceProjectRegisterStep(state: ProjectRegisterNextState): boolean {
  if (state.step !== 'contract') return true;
  return !state.isUploadingContract
    && state.contractAnalysisState !== 'extracting'
    && state.contractAnalysisState !== 'analyzing';
}

export function getProjectRegisterSubmitIssues(
  context: ProjectRegisterSubmitContext,
): ProjectRegisterSubmitIssue[] {
  const issues: ProjectRegisterSubmitIssue[] = [];
  const { form, hasContractAmountInput } = context;

  if (!String(form.department || '').trim()) {
    issues.push({ step: 'basic', label: '담당팀' });
  }
  if (!String(form.name || '').trim()) {
    issues.push({ step: 'basic', label: '등록 프로젝트명' });
  }
  if (!String(form.contractStart || '').trim()) {
    issues.push({ step: 'financial', label: '계약 시작일' });
  }
  if (!String(form.contractEnd || '').trim()) {
    issues.push({ step: 'financial', label: '계약 종료일' });
  }
  if (!hasContractAmountInput) {
    issues.push({ step: 'financial', label: '계약금액' });
  }
  if (!String(form.managerName || '').trim()) {
    issues.push({ step: 'team', label: 'PM' });
  }

  return issues;
}
