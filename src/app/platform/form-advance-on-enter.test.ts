import { describe, expect, it } from 'vitest';
import { shouldAdvanceOnEnter } from './form-advance-on-enter';

// DOM 없이 규칙만 검증한다 (vitest 환경이 node 다).
function inputOf(type: string, extra: Record<string, unknown> = {}) {
  return { tagName: 'INPUT', type, ...extra };
}

describe('shouldAdvanceOnEnter', () => {
  it('숫자·텍스트 칸에서 Enter 를 받는다', () => {
    for (const type of ['text', 'number', 'date', 'month', 'url']) {
      expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf(type) })).toBe(true);
    }
  });

  it('한글 조합 중 Enter 는 확정이지 이동이 아니다', () => {
    // 이동으로 먹으면 조합 중이던 글자가 사라진다.
    expect(shouldAdvanceOnEnter({
      key: 'Enter', target: inputOf('text'), nativeEvent: { isComposing: true },
    })).toBe(false);
  });

  it('textarea 와 버튼은 건드리지 않는다', () => {
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: { tagName: 'TEXTAREA' } })).toBe(false);
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: { tagName: 'BUTTON' } })).toBe(false);
  });

  it('읽기 전용·비활성 칸은 넘기지 않는다', () => {
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf('text', { readOnly: true }) })).toBe(false);
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf('text', { disabled: true }) })).toBe(false);
  });

  it('수식 키가 눌린 Enter 는 제출 단축키 몫으로 남긴다', () => {
    for (const mod of ['shiftKey', 'metaKey', 'ctrlKey', 'altKey'] as const) {
      expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf('text'), [mod]: true })).toBe(false);
    }
  });

  it('파일 선택처럼 넘길 수 없는 칸은 제외한다', () => {
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf('file') })).toBe(false);
    expect(shouldAdvanceOnEnter({ key: 'Enter', target: inputOf('checkbox') })).toBe(false);
  });
});
