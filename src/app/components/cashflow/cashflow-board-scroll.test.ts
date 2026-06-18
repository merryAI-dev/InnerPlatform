import { describe, expect, it } from 'vitest';

import { getSnappedWeekScrollLeft } from './cashflow-board-scroll';

describe('cashflow board scroll snapping', () => {
  it('moves by a page and snaps the target to week column boundaries', () => {
    expect(getSnappedWeekScrollLeft({
      currentLeft: 13,
      direction: 1,
      viewportWidth: 560,
      maxScrollLeft: 2000,
      weekWidth: 84,
    })).toBe(504);

    expect(getSnappedWeekScrollLeft({
      currentLeft: 505,
      direction: -1,
      viewportWidth: 560,
      maxScrollLeft: 2000,
      weekWidth: 84,
    })).toBe(0);
  });

  it('clamps the snapped target inside the scroll range', () => {
    expect(getSnappedWeekScrollLeft({
      currentLeft: 1800,
      direction: 1,
      viewportWidth: 560,
      maxScrollLeft: 1900,
      weekWidth: 84,
    })).toBe(1900);

    expect(getSnappedWeekScrollLeft({
      currentLeft: 10,
      direction: -1,
      viewportWidth: 560,
      maxScrollLeft: 1900,
      weekWidth: 84,
    })).toBe(0);
  });

  it('falls back to the viewport page size when the week width is unavailable', () => {
    expect(getSnappedWeekScrollLeft({
      currentLeft: 100,
      direction: 1,
      viewportWidth: 500,
      maxScrollLeft: 2000,
      weekWidth: 0,
    })).toBe(600);
  });
});
