export function shouldApplyCashflowSheetLabProjectResult(input: {
  requestGeneration: number;
  currentGeneration: number;
  requestedProjectId: string;
  selectedProjectId: string;
  requestedSourceYear: number;
  selectedSourceYear: number;
}): boolean {
  return input.requestGeneration === input.currentGeneration
    && input.requestedProjectId === input.selectedProjectId
    && input.requestedSourceYear === input.selectedSourceYear;
}
