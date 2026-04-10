import { describe, expect, it } from 'vitest';
import { resolveSelectPopupPosition } from './select-popup-position';

describe('resolveSelectPopupPosition', () => {
  it('opens upward when there is not enough viewport space below the trigger', () => {
    const result = resolveSelectPopupPosition({
      triggerRect: {
        left: 120,
        top: 740,
        right: 200,
        bottom: 764,
        width: 80,
        height: 24,
        x: 120,
        y: 740,
        toJSON: () => ({}),
      },
      viewport: {
        width: 1280,
        height: 800,
      },
      popupWidth: 160,
      popupHeight: 280,
    });

    expect(result.top).toBeLessThan(740);
  });

  it('clamps horizontally so the popup stays inside the viewport', () => {
    const result = resolveSelectPopupPosition({
      triggerRect: {
        left: 1180,
        top: 120,
        right: 1260,
        bottom: 144,
        width: 80,
        height: 24,
        x: 1180,
        y: 120,
        toJSON: () => ({}),
      },
      viewport: {
        width: 1280,
        height: 800,
      },
      popupWidth: 160,
      popupHeight: 280,
    });

    expect(result.left).toBeLessThanOrEqual(1280 - 160 - 8);
  });
});
