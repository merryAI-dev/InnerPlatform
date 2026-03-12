import { describe, expect, it } from 'vitest';
import { splitLooseNameList } from './name-list';

describe('splitLooseNameList', () => {
  it('splits comma and slash separated names into author options', () => {
    expect(splitLooseNameList('홍길동, 김철수 / 박영희')).toEqual(['홍길동', '김철수', '박영희']);
  });

  it('ignores empty fragments and preserves single names', () => {
    expect(splitLooseNameList(' , 베리 ;; 데이나 |  ')).toEqual(['베리', '데이나']);
    expect(splitLooseNameList('나무')).toEqual(['나무']);
  });
});

