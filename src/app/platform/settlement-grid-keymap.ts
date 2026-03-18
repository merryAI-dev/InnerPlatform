export interface KeyCombo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyRuleContext {
  isTextEditingTarget: boolean;
  hasMultiCellSelection: boolean;
  inputHasPartialSelection: boolean;
}

export interface KeyRule {
  combo: KeyCombo | KeyCombo[];
  run: (e: KeyboardEvent, ctx: KeyRuleContext) => boolean;
}

export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.key === 'Process' || e.keyCode === 229;
}

export function matchKeyCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  if (isImeComposing(e)) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (combo.key.toLowerCase() !== e.key.toLowerCase()) return false;
  if (Boolean(combo.mod) !== mod) return false;
  if (Boolean(combo.shift) !== e.shiftKey) return false;
  if (Boolean(combo.alt) !== e.altKey) return false;
  return true;
}

export function matchRule(e: KeyboardEvent, rule: KeyRule): boolean {
  const combos = Array.isArray(rule.combo) ? rule.combo : [rule.combo];
  return combos.some((c) => matchKeyCombo(e, c));
}

export function runKeyRules(e: KeyboardEvent, rules: KeyRule[], ctx: KeyRuleContext): boolean {
  for (const rule of rules) {
    if (!matchRule(e, rule)) continue;
    const handled = rule.run(e, ctx);
    if (handled) return true;
  }
  return false;
}

export function detectKeyRuleContext(e: KeyboardEvent): KeyRuleContext {
  const target = e.target as HTMLElement | null;
  const isTextEditingTarget = Boolean(
    target
    && (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target.isContentEditable
    ),
  );
  const inputHasPartialSelection = Boolean(
    target instanceof HTMLInputElement
    && typeof target.selectionStart === 'number'
    && typeof target.selectionEnd === 'number'
    && target.selectionStart !== target.selectionEnd,
  );
  return { isTextEditingTarget, hasMultiCellSelection: false, inputHasPartialSelection };
}
