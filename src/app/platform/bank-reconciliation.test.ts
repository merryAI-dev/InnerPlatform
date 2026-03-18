import { describe, expect, it } from 'vitest';
import {
  detectBankCsvProfile,
  getBankCsvProfileMeta,
  parseBankCsv,
} from './bank-reconciliation';

const HANA_MATRIX = [
  ['거래일시', '적요', '입금액', '출금액', '거래 후 잔액'],
  ['2026-03-05 10:20', '하나 운영비', '', '11,000', '250,000'],
];

const KOOKMIN_MATRIX = [
  ['거래일자', '기재내용', '맡기신금액', '찾으신금액', '잔액'],
  ['2026.03.05', '국민 거래처', '0', '11,000', '250,000'],
];

const SHINHAN_MATRIX = [
  ['거래일', '내용', '입출금액', '거래구분', '잔액'],
  ['20260305', '신한 운영비', '11000', '출금', '250000'],
];

describe('bank reconciliation parser', () => {
  it('detects hana quick-view csv and parses split debit columns', () => {
    expect(detectBankCsvProfile(HANA_MATRIX)).toBe('HANA');
    expect(getBankCsvProfileMeta('HANA').label).toBe('하나은행 빠른조회');

    const [tx] = parseBankCsv(HANA_MATRIX);
    expect(tx).toMatchObject({
      date: '2026-03-05',
      description: '하나 운영비',
      amount: 11000,
      direction: 'OUT',
      balance: 250000,
    });
  });

  it('detects kookmin quick-view csv and maps alternate header names', () => {
    expect(detectBankCsvProfile(KOOKMIN_MATRIX)).toBe('KOOKMIN');

    const [tx] = parseBankCsv(KOOKMIN_MATRIX);
    expect(tx).toMatchObject({
      date: '2026-03-05',
      description: '국민 거래처',
      amount: 11000,
      direction: 'OUT',
    });
  });

  it('detects shinhan single-amount csv and uses explicit direction column', () => {
    expect(detectBankCsvProfile(SHINHAN_MATRIX)).toBe('SHINHAN');

    const [tx] = parseBankCsv(SHINHAN_MATRIX);
    expect(tx).toMatchObject({
      date: '2026-03-05',
      description: '신한 운영비',
      amount: 11000,
      direction: 'OUT',
      balance: 250000,
    });
  });
});
