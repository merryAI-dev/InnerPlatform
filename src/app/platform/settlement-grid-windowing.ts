export interface SettlementGridWindowRange {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

export function computeSettlementGridWindowRange(input: {
  rowCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeightEstimate: number;
  overscan: number;
}): SettlementGridWindowRange {
  const {
    rowCount,
    scrollTop,
    viewportHeight,
    rowHeightEstimate,
    overscan,
  } = input;

  if (rowCount <= 0 || viewportHeight <= 0 || rowHeightEstimate <= 0) {
    return {
      startIndex: 0,
      endIndex: rowCount,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeightEstimate));
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeightEstimate));
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(rowCount, visibleStart + visibleCount + overscan);
  const paddingTop = startIndex * rowHeightEstimate;
  const paddingBottom = Math.max(0, (rowCount - endIndex) * rowHeightEstimate);

  return {
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
  };
}
