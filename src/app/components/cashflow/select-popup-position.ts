export interface PopupViewport {
  width: number;
  height: number;
}

export interface PopupPositionInput {
  triggerRect: DOMRect;
  viewport: PopupViewport;
  popupWidth: number;
  popupHeight: number;
  gap?: number;
  margin?: number;
}

export function resolveSelectPopupPosition(input: PopupPositionInput): { left: number; top: number } {
  const gap = input.gap ?? 4;
  const margin = input.margin ?? 8;
  const maxLeft = Math.max(margin, input.viewport.width - input.popupWidth - margin);
  const left = Math.min(Math.max(input.triggerRect.left, margin), maxLeft);

  const spaceBelow = input.viewport.height - input.triggerRect.bottom - margin;
  const canOpenBelow = spaceBelow >= Math.min(input.popupHeight, 240);
  const preferredTop = canOpenBelow
    ? input.triggerRect.bottom + gap
    : input.triggerRect.top - input.popupHeight - gap;
  const maxTop = Math.max(margin, input.viewport.height - input.popupHeight - margin);
  const top = Math.min(Math.max(preferredTop, margin), maxTop);

  return { left, top };
}
