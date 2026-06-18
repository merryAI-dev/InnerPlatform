export function getSnappedWeekScrollLeft(input: {
  currentLeft: number;
  direction: -1 | 1;
  viewportWidth: number;
  maxScrollLeft: number;
  weekWidth: number;
}): number {
  const currentLeft = Math.max(0, Number(input.currentLeft) || 0);
  const viewportWidth = Math.max(0, Number(input.viewportWidth) || 0);
  const maxScrollLeft = Math.max(0, Number(input.maxScrollLeft) || 0);
  const weekWidth = Math.max(0, Number(input.weekWidth) || 0);
  const pageStep = weekWidth > 0
    ? Math.max(viewportWidth * 0.85, weekWidth)
    : viewportWidth;
  const rawTarget = currentLeft + input.direction * pageStep;
  const snappedTarget = weekWidth > 0
    ? Math.round(rawTarget / weekWidth) * weekWidth
    : rawTarget;
  return Math.min(maxScrollLeft, Math.max(0, Math.round(snappedTarget)));
}
