import { describe, expect, it } from 'vitest';
import {
  isHtmlMaskedAsXls,
  parseHtmlBankExport,
  sanitizeHtmlMatrix,
  normalizeBankStatementMatrix,
} from './bank-statement';

// ── KB 은행 거래내역빠른조회 (실제 형식 재현) ──
const KB_HTML = `
<meta http-equiv='Content-Type' content='text/html; charset=UTF-8'>
<style> .td { color:#000000; font-size:9pt; font-family:굴림체; } </style>
<table cellpadding='0' cellspacing='0' border='0' width='610'>
<tr valign='top'>
<td width='605'>
<table width='605' border='1' cellspacing='1' cellpadding='4'>
<tr><td class='td' bgcolor='#C8DFF9'>조회기간</td><td class='td' colspan=7>2026.02.06 ~ 2026.03.25</td></tr>
<tr><td class='td' bgcolor='#C8DFF9'>계좌번호</td><td colspan=7 class='td'>801701-04-271196</td></tr>
<tr><td class='td' bgcolor='#C8DFF9'>예금종류</td><td class='td' colspan='3'>ＯＮＥ ＫＢ 사업자통장</td><td class='td' bgcolor='#C8DFF9'>총잔액</td><td class='td' colspan='3'>193,789,039</td></tr>
</table>
<table width='605' border='1' cellspacing='1' cellpadding='4'>
<tr bgcolor='#C8DFF9'>
  <td class='td'>거래일시</td>
  <td class='td'>적요</td>
  <td class='td'>의뢰인/수취인</td>
  <td class='td'>내통장표시내용</td>
  <td class='td'>출금금액</td>
  <td class='td'>입금금액</td>
  <td class='td'>잔액</td>
  <td class='td'>취급점</td>
</tr>
<tr>
  <td class='td'>2026.03.10</td>
  <td class='td'>전자금융이체</td>
  <td class='td'>홍길동</td>
  <td class='td'>3월 급여</td>
  <td class='td'>3,500,000</td>
  <td class='td'></td>
  <td class='td'>190,289,039</td>
  <td class='td'>인터넷뱅킹</td>
</tr>
<tr>
  <td class='td'>2026.03.15</td>
  <td class='td'>입금이체</td>
  <td class='td'>MYSC기금</td>
  <td class='td'>사업비지급</td>
  <td class='td'></td>
  <td class='td'>50,000,000</td>
  <td class='td'>240,289,039</td>
  <td class='td'>인터넷뱅킹</td>
</tr>
<tr>
  <td class='td' colspan=4>총계</td>
  <td class='td'>3,500,000</td>
  <td class='td'>50,000,000</td>
  <td class='td' colspan=2></td>
</tr>
</table>
</td></tr></table>
`;

// ── 신한은행 형식 (다른 HTML 패턴) ──
const SHINHAN_HTML = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body>
<table>
  <tr><th>거래일자</th><th>적요</th><th>출금금액</th><th>입금금액</th><th>잔액</th></tr>
  <tr><td>2026-03-01</td><td>카드매출</td><td></td><td>1,200,000</td><td>5,200,000</td></tr>
  <tr><td>2026-03-05</td><td>세금계산서</td><td>500,000</td><td></td><td>4,700,000</td></tr>
</table>
</body></html>
`;

// ── 하나은행 형식 (style + 중첩 테이블) ──
const HANA_HTML = `
<style>td{font-size:9pt}</style>
<table>
<tr><td>하나은행 거래내역</td></tr>
<tr><td>조회기간: 2026.01.01 ~ 2026.03.25</td></tr>
</table>
<table border=1>
<tr><th>거래일</th><th>내용</th><th>입금</th><th>출금</th><th>잔액</th><th>메모</th></tr>
<tr><td>2026.01.15</td><td>급여이체</td><td></td><td>4,000,000</td><td>12,000,000</td><td>1월급여</td></tr>
<tr><td>2026.02.10</td><td>카드매출입금</td><td>2,500,000</td><td></td><td>14,500,000</td><td></td></tr>
<tr><td>2026.03.01</td><td>임대료</td><td></td><td>1,500,000</td><td>13,000,000</td><td>3월분</td></tr>
</table>
`;

describe('isHtmlMaskedAsXls', () => {
  it('detects HTML starting with meta tag (KB)', () => {
    expect(isHtmlMaskedAsXls("<meta http-equiv='Content-Type'")).toBe(true);
  });
  it('detects HTML starting with DOCTYPE (신한)', () => {
    expect(isHtmlMaskedAsXls('<!DOCTYPE html>')).toBe(true);
  });
  it('detects HTML starting with style tag', () => {
    expect(isHtmlMaskedAsXls('<style>td{font-size:9pt}</style><table>')).toBe(true);
  });
  it('detects HTML containing table tag', () => {
    expect(isHtmlMaskedAsXls('some preamble <table border=1>')).toBe(true);
  });
  it('rejects real XLSX binary header', () => {
    expect(isHtmlMaskedAsXls('PK\x03\x04\x14\x00')).toBe(false);
  });
  it('rejects plain CSV', () => {
    expect(isHtmlMaskedAsXls('거래일시,적요,출금금액')).toBe(false);
  });
});

describe('parseHtmlBankExport', () => {
  it('extracts KB transaction table (not metadata table)', () => {
    const matrix = parseHtmlBankExport(KB_HTML);
    // Should pick the transaction table (8 cols), not the metadata table (2 cols)
    expect(matrix.length).toBeGreaterThanOrEqual(3); // header + 2 data + summary
    // First row should be the header
    const header = matrix[0];
    expect(header).toContain('거래일시');
    expect(header).toContain('출금금액');
    expect(header).toContain('입금금액');
    expect(header).toContain('잔액');
  });

  it('extracts actual data rows from KB', () => {
    const matrix = parseHtmlBankExport(KB_HTML);
    // Find the data row with 홍길동
    const dataRow = matrix.find((r) => r.some((c) => c.includes('홍길동')));
    expect(dataRow).toBeDefined();
    expect(dataRow!.some((c) => c.includes('3,500,000'))).toBe(true);
  });

  it('handles colspan expansion in KB metadata', () => {
    const matrix = parseHtmlBankExport(KB_HTML);
    // All rows should have the same number of columns
    const colCounts = new Set(matrix.map((r) => r.length));
    expect(colCounts.size).toBe(1); // uniform column count
  });

  it('parses simple 신한 format', () => {
    const matrix = parseHtmlBankExport(SHINHAN_HTML);
    expect(matrix.length).toBeGreaterThanOrEqual(3);
    expect(matrix[0]).toContain('거래일자');
    const row1 = matrix.find((r) => r.some((c) => c.includes('카드매출')));
    expect(row1).toBeDefined();
  });

  it('picks transaction table over metadata in 하나 format', () => {
    const matrix = parseHtmlBankExport(HANA_HTML);
    const header = matrix[0];
    expect(header).toContain('거래일');
    expect(header).toContain('입금');
    expect(header).toContain('출금');
    expect(matrix.length).toBe(4); // header + 3 rows
  });

  it('returns empty for non-table HTML', () => {
    const matrix = parseHtmlBankExport('<html><body><p>No tables here</p></body></html>');
    expect(matrix).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(parseHtmlBankExport('')).toEqual([]);
  });
});

describe('sanitizeHtmlMatrix', () => {
  it('strips HTML entities', () => {
    const result = sanitizeHtmlMatrix([['hello&nbsp;world', '100&amp;200']]);
    expect(result[0][0]).toBe('hello world');
    expect(result[0][1]).toBe('100&200');
  });

  it('removes rows with residual HTML tags', () => {
    const result = sanitizeHtmlMatrix([
      ['<td class="x">bad</td>', 'still html'],
      ['2026-03-10', '정상 행'],
    ]);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('2026-03-10');
  });

  it('removes all-empty rows', () => {
    const result = sanitizeHtmlMatrix([
      ['', '', ''],
      ['data', 'here', ''],
    ]);
    expect(result).toHaveLength(1);
  });

  it('normalizes whitespace', () => {
    const result = sanitizeHtmlMatrix([['  2026.03.10  ', '  전자금융\n이체  ']]);
    expect(result[0][0]).toBe('2026.03.10');
    expect(result[0][1]).toBe('전자금융 이체');
  });
});

describe('KB end-to-end: parseHtmlBankExport → normalizeBankStatementMatrix', () => {
  it('produces valid columns and rows from KB HTML', () => {
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(KB_HTML));
    const sheet = normalizeBankStatementMatrix(matrix);

    expect(sheet.columns.length).toBeGreaterThanOrEqual(5);
    // Should have date, amount columns
    const hasDate = sheet.columns.some((c) => c.includes('거래일시'));
    const hasAmount = sheet.columns.some((c) => c.includes('출금금액') || c.includes('입금금액'));
    expect(hasDate).toBe(true);
    expect(hasAmount).toBe(true);

    // Data rows (not summary)
    expect(sheet.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('KB summary row (총계) is excluded', () => {
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(KB_HTML));
    const sheet = normalizeBankStatementMatrix(matrix);
    const hasSummary = sheet.rows.some((r) => r.cells.some((c) => c.includes('총계')));
    expect(hasSummary).toBe(false);
  });
});

describe('신한 end-to-end', () => {
  it('produces valid sheet from 신한 HTML', () => {
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(SHINHAN_HTML));
    const sheet = normalizeBankStatementMatrix(matrix);
    expect(sheet.columns).toContain('거래일자');
    expect(sheet.rows.length).toBe(2);
  });
});

describe('하나 end-to-end', () => {
  it('produces valid sheet from 하나 HTML', () => {
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(HANA_HTML));
    const sheet = normalizeBankStatementMatrix(matrix);
    expect(sheet.rows.length).toBe(3);
    const hasDate = sheet.columns.some((c) => c.includes('거래일'));
    expect(hasDate).toBe(true);
  });
});

describe('edge cases — header stability', () => {
  it('handles table with no header-like row gracefully', () => {
    const html = '<table><tr><td>aaa</td><td>bbb</td></tr><tr><td>ccc</td><td>ddd</td></tr></table>';
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(html));
    const sheet = normalizeBankStatementMatrix(matrix);
    // No date/amount keywords → no header found → empty result
    expect(sheet.columns).toEqual([]);
  });

  it('handles BOM (byte order mark) prefix', () => {
    const withBom = '\uFEFF<table><tr><td>거래일시</td><td>입금금액</td></tr><tr><td>2026-03-10</td><td>1,000</td></tr></table>';
    expect(isHtmlMaskedAsXls(withBom)).toBe(true);
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(withBom));
    expect(matrix.length).toBe(2);
  });

  it('handles deeply nested tables (KB-style wrapper)', () => {
    const nested = `
      <table><tr><td>
        <table><tr><td>메타데이터</td></tr></table>
        <table>
          <tr><td>거래일시</td><td>적요</td><td>출금금액</td><td>입금금액</td><td>잔액</td></tr>
          <tr><td>2026-03-10</td><td>이체</td><td>100,000</td><td></td><td>500,000</td></tr>
          <tr><td>2026-03-11</td><td>입금</td><td></td><td>200,000</td><td>700,000</td></tr>
          <tr><td>2026-03-12</td><td>카드</td><td>50,000</td><td></td><td>650,000</td></tr>
        </table>
      </td></tr></table>`;
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(nested));
    const sheet = normalizeBankStatementMatrix(matrix);
    expect(sheet.rows.length).toBe(3);
  });

  it('handles missing closing tags gracefully', () => {
    // Regex parser requires closing </td> — malformed HTML without them returns empty
    const malformed = '<table><tr><td>거래일시<td>입금금액</tr><tr><td>2026-01-01<td>5,000</tr></table>';
    const matrix = parseHtmlBankExport(malformed);
    // Regex-based parser can't handle missing closing tags — returns empty gracefully
    expect(matrix.length).toBe(0);
    // But well-formed version works
    const wellFormed = '<table><tr><td>거래일시</td><td>입금금액</td></tr><tr><td>2026-01-01</td><td>5,000</td></tr></table>';
    const matrix2 = parseHtmlBankExport(wellFormed);
    expect(matrix2.length).toBe(2);
  });

  it('handles Korean encoding markers in header', () => {
    const html = `<meta charset="euc-kr"><table>
      <tr><td>거래일시</td><td>적요</td><td>출금금액</td><td>입금금액</td><td>잔액</td></tr>
      <tr><td>2026.03.10</td><td>테스트</td><td>1,000</td><td></td><td>9,000</td></tr>
    </table>`;
    expect(isHtmlMaskedAsXls(html)).toBe(true);
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(html));
    expect(matrix.length).toBe(2);
  });

  it('handles table with only 1 row (no data)', () => {
    const html = '<table><tr><td>거래일시</td><td>입금금액</td></tr></table>';
    const matrix = parseHtmlBankExport(html);
    // table with < 2 rows should be skipped
    expect(matrix).toEqual([]);
  });

  it('handles multiple tables where metadata table has more rows', () => {
    // Metadata table has 5 rows but only 2 cols; transaction table has 3 rows but 6 cols + keywords
    const html = `
      <table>
        <tr><td>항목1</td><td>값1</td></tr>
        <tr><td>항목2</td><td>값2</td></tr>
        <tr><td>항목3</td><td>값3</td></tr>
        <tr><td>항목4</td><td>값4</td></tr>
        <tr><td>항목5</td><td>값5</td></tr>
      </table>
      <table>
        <tr><td>거래일시</td><td>적요</td><td>출금금액</td><td>입금금액</td><td>잔액</td><td>비고</td></tr>
        <tr><td>2026-03-10</td><td>이체</td><td>100</td><td></td><td>500</td><td></td></tr>
        <tr><td>2026-03-11</td><td>입금</td><td></td><td>200</td><td>700</td><td></td></tr>
      </table>`;
    const matrix = sanitizeHtmlMatrix(parseHtmlBankExport(html));
    const sheet = normalizeBankStatementMatrix(matrix);
    // Should prefer the transaction table due to keyword bonus
    expect(sheet.columns.some((c) => c.includes('거래일시'))).toBe(true);
    expect(sheet.rows.length).toBe(2);
  });
});
