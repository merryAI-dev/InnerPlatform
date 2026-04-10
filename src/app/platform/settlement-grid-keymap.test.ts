import { describe, expect, it } from 'vitest';
import {
  matchKeyCombo,
  runKeyRules,
  shouldHandleGridDeletion,
  type KeyRule,
  type KeyRuleContext,
} from './settlement-grid-keymap';

function fakeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  } as KeyboardEvent;
}

const baseCtx: KeyRuleContext = {
  isTextEditingTarget: false,
  hasMultiCellSelection: false,
  inputHasPartialSelection: false,
};

describe('settlement-grid-keymap', () => {
  describe('matchKeyCombo', () => {
    it('matches simple key', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'Enter' }), { key: 'Enter' })).toBe(true);
    });

    it('matches Ctrl+C', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'c', ctrlKey: true }), { key: 'c', mod: true })).toBe(true);
    });

    it('matches Cmd+C (meta)', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'c', metaKey: true }), { key: 'c', mod: true })).toBe(true);
    });

    it('rejects when mod required but not pressed', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'c' }), { key: 'c', mod: true })).toBe(false);
    });

    it('rejects during IME composition', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'Enter', isComposing: true }), { key: 'Enter' })).toBe(false);
    });

    it('rejects IME Process key', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'Process', keyCode: 229 }), { key: 'Enter' })).toBe(false);
    });

    it('matches Shift+Enter', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'Enter', shiftKey: true }), { key: 'Enter', shift: true })).toBe(true);
    });

    it('rejects Shift+Enter when shift not expected', () => {
      expect(matchKeyCombo(fakeKeyEvent({ key: 'Enter', shiftKey: true }), { key: 'Enter' })).toBe(false);
    });
  });

  describe('runKeyRules', () => {
    it('runs matching rule and returns true', () => {
      let called = false;
      const rules: KeyRule[] = [
        { combo: { key: 'Enter' }, run: () => { called = true; return true; } },
      ];
      const result = runKeyRules(fakeKeyEvent({ key: 'Enter' }), rules, baseCtx);
      expect(result).toBe(true);
      expect(called).toBe(true);
    });

    it('skips non-matching rules', () => {
      let called = false;
      const rules: KeyRule[] = [
        { combo: { key: 'Tab' }, run: () => { called = true; return true; } },
      ];
      const result = runKeyRules(fakeKeyEvent({ key: 'Enter' }), rules, baseCtx);
      expect(result).toBe(false);
      expect(called).toBe(false);
    });

    it('stops at first handled rule', () => {
      const order: string[] = [];
      const rules: KeyRule[] = [
        { combo: { key: 'a', mod: true }, run: () => { order.push('first'); return true; } },
        { combo: { key: 'a', mod: true }, run: () => { order.push('second'); return true; } },
      ];
      runKeyRules(fakeKeyEvent({ key: 'a', ctrlKey: true }), rules, baseCtx);
      expect(order).toEqual(['first']);
    });

    it('supports multiple combos per rule', () => {
      let called = false;
      const rules: KeyRule[] = [
        { combo: [{ key: 'Delete' }, { key: 'Backspace' }], run: () => { called = true; return true; } },
      ];
      const result = runKeyRules(fakeKeyEvent({ key: 'Backspace' }), rules, baseCtx);
      expect(result).toBe(true);
      expect(called).toBe(true);
    });
  });

  describe('shouldHandleGridDeletion', () => {
    it('does not hijack backspace while typing in a single input cell', () => {
      expect(shouldHandleGridDeletion({
        isTextEditingTarget: true,
        hasMultiCellSelection: false,
        inputHasPartialSelection: false,
      })).toBe(false);
    });

    it('still allows grid deletion for multi-cell selections', () => {
      expect(shouldHandleGridDeletion({
        isTextEditingTarget: true,
        hasMultiCellSelection: true,
        inputHasPartialSelection: false,
      })).toBe(true);
    });
  });
});
