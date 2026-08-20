/**
 * 한 칸을 다 넣고 Enter 를 누르면 다음 입력으로 넘어간다.
 *
 * Tab 은 원래 되지만(폼에 tabIndex 를 두지 않아 DOM 순서 그대로다) 숫자를 연달아 넣는
 * 화면에서는 손이 Enter 로 간다. 그 습관을 막지 않고 받아준다.
 *
 * 건드리지 않는 것:
 * - **textarea** — 줄바꿈이 Enter 다.
 * - **조합 중인 한글** (`isComposing`) — 확정 Enter 를 이동으로 먹으면 글자가 사라진다.
 * - **버튼·셀렉트·체크박스** — Enter 가 이미 "누름" 이라 뜻을 빼앗지 않는다.
 * - 수식 키가 눌린 Enter — 제출 단축키와 겹치지 않게 둔다.
 */
const ADVANCEABLE_INPUT_TYPES = new Set([
  'text', 'number', 'tel', 'url', 'email', 'search', 'date', 'month', 'password',
]);

/** DOM 인스턴스가 아니라 모양으로 본다. 규칙을 DOM 없이도 검증할 수 있게 하려는 것이다. */
export function isAdvanceableTarget(value: unknown): boolean {
  const el = value as { tagName?: string; type?: string; disabled?: boolean; readOnly?: boolean } | null;
  if (!el || String(el.tagName || '').toUpperCase() !== 'INPUT') return false;
  if (el.disabled === true || el.readOnly === true) return false;
  return ADVANCEABLE_INPUT_TYPES.has(String(el.type || ''));
}

/** 화면에 실제로 보이고 초점을 받을 수 있는 입력만 다음 후보로 본다. */
function focusableInputs(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll('input'))
    .filter((input) => isAdvanceableTarget(input))
    .filter((input) => input.offsetParent !== null || input.getClientRects().length > 0);
}

export function shouldAdvanceOnEnter(event: {
  key: string;
  nativeEvent?: { isComposing?: boolean };
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** React 의 이벤트도, 테스트가 만드는 형태 객체도 받는다. 판정은 모양으로만 한다. */
  target: unknown;
}): boolean {
  if (event.key !== 'Enter') return false;
  if (event.nativeEvent?.isComposing) return false;
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  return isAdvanceableTarget(event.target);
}

/** 다음 입력으로 초점을 옮긴다. 마지막 칸이면 아무것도 하지 않는다(제출을 가로채지 않는다). */
export function advanceFocusToNextInput(root: HTMLElement, current: HTMLInputElement): boolean {
  const inputs = focusableInputs(root);
  const index = inputs.indexOf(current);
  if (index < 0 || index >= inputs.length - 1) return false;
  const next = inputs[index + 1];
  next.focus();
  if (typeof next.select === 'function' && next.type !== 'date' && next.type !== 'month') next.select();
  return true;
}
