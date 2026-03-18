export interface CellDragCallbacks {
  onMove: (rowIdx: number, colIdx: number) => void;
  onComplete: () => void;
}

export function startCellDragSession(
  callbacks: CellDragCallbacks,
): () => void {
  let frameId: number | null = null;
  let pendingTarget: { r: number; c: number } | null = null;

  document.body.style.userSelect = 'none';

  const flush = () => {
    frameId = null;
    if (!pendingTarget) return;
    const { r, c } = pendingTarget;
    pendingTarget = null;
    callbacks.onMove(r, c);
  };

  const onMouseMove = (e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest<HTMLElement>('[data-cell-row][data-cell-col]');
    if (!target) return;
    const r = Number(target.dataset.cellRow);
    const c = Number(target.dataset.cellCol);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    if (pendingTarget?.r === r && pendingTarget.c === c) return;
    pendingTarget = { r, c };
    if (frameId != null) return;
    frameId = window.requestAnimationFrame(flush);
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (frameId != null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
    flush();
    document.body.style.userSelect = '';
  };

  const onMouseUp = () => {
    cleanup();
    callbacks.onComplete();
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return cleanup;
}
