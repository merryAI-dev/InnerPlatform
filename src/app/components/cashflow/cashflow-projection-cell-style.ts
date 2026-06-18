export function shouldHighlightProjectionAmountMismatch(input: {
  projection: number;
  actual: number;
}): boolean {
  return input.projection !== 0 && input.actual !== 0 && input.projection !== input.actual;
}
