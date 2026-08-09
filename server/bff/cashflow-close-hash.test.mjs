import { describe, expect, it } from 'vitest';
import { cashflowCloseHash } from './cashflow-close-hash.mjs';

// BFF <-> JVM parity 표. JVM CashflowCloseHashTest 가 정확히 같은 입력과 기대값을 가진다.
// 이 표를 고치면 반드시 JVM 쪽 표도 함께 고쳐야 한다 - 두 값이 갈리면 라이브에서
// 조직장 승인이 "근거가 손상되었습니다"(409) 로 거부된다.
//
// 입력은 실제로 오가는 형태를 덮는다: 정렬 안 된 키, 중첩 맵/배열(샤드), 한글 문자열,
// 정수/음수/0/소수, 빈 컬렉션과 null.
const CLOSE_HASH_PARITY = [
  {
    name: 'simple unsorted keys',
    value: { b: 1, a: 'x' },
    hash: 'sha256:cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246',
  },
  {
    name: 'cumulative close shard shape',
    value: {
      contractVersion: 'cashflow-cumulative-close-v2',
      requestId: 'p123-2026-08',
      requestRevision: 2,
      projectId: 'p123',
      yearMonth: '2023-01',
      cells: [
        { mode: 'projection', weekNo: 1, cashflowLine: 'SALES_IN', cellState: 'EMPTY', amount: null },
        { mode: 'actual', weekNo: 5, cashflowLine: 'BANK_INTEREST_OUT', cellState: 'VALUE', amount: 7582243 },
      ],
      source: { spreadsheetId: 'sheet-a', sourceRevision: `sha256:${'ab'.repeat(32)}` },
    },
    hash: 'sha256:12b47306a6b0e03d565d5e549d21944e9a65565b6d1cab1e34729be887169da7',
  },
  {
    name: 'korean keys and values',
    value: { 사유: '감사 지적으로 정정', 상태: '확정' },
    hash: 'sha256:66a3b9a944c4f4675af7c2066727da4d14136a6fd083c1e30fecd6849d8739b8',
  },
  {
    name: 'number forms',
    value: { zero: 0, negative: -5, big: 123456789, fraction: 1.5 },
    hash: 'sha256:1ec728a405d2d92079835069029e55b8683ae5199d6a975bb4d1ca0bfa29716d',
  },
  {
    name: 'empty collections and null',
    value: { list: [], map: {}, nothing: null },
    hash: 'sha256:92c9fb1a630c449e63f2a610dbd4e06d47d679ce8b711d185b765101c6943dc4',
  },
];

describe('cashflowCloseHash', () => {
  it.each(CLOSE_HASH_PARITY)('matches the JVM parity table: $name', ({ value, hash }) => {
    expect(cashflowCloseHash(value)).toBe(hash);
  });

  it('is insensitive to key insertion order at every depth', () => {
    const forward = cashflowCloseHash({ outer: { a: 1, b: [{ c: 2, d: 3 }] } });
    const reversed = cashflowCloseHash({ outer: { b: [{ d: 3, c: 2 }], a: 1 } });
    expect(forward).toBe(reversed);
  });

  it('treats array order as meaningful', () => {
    expect(cashflowCloseHash({ cells: [1, 2] })).not.toBe(cashflowCloseHash({ cells: [2, 1] }));
  });
});
