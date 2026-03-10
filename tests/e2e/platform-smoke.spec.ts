import { expect, test } from '@playwright/test';

const SETTLEMENT_HEADERS = [
  '작성자',
  'No.',
  '거래일시',
  '해당 주차',
  '지출구분',
  '비목',
  '세목',
  '세세목',
  'cashflow항목',
  '통장잔액',
  '통장에 찍힌 입/출금액',
  '입금액(사업비,공급가액,은행이자)',
  '매입부가세 반환',
  '사업비 사용액',
  '매입부가세',
  '지급처',
  '상세 적요',
  '필수증빙자료 리스트',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
  'e나라 등록',
  'e나라 집행',
  '부가세 지결 완료여부',
  '최종완료',
  '비고',
];

const BANK_HEADERS = [
  '상태',
  '신뢰도',
  '은행 일자',
  '은행 적요',
  '은행 금액',
  '↔',
  '시스템 일자',
  '프로젝트',
  '거래처',
  '시스템 금액',
];

const BANK_CSV = [
  '거래일,적요,입금액,출금액,잔액',
  '2026-02-12,Masion Viet (프랑스),0,11520000,1216329459',
].join('\n');

test('settlement smoke keeps headers and exposes enhanced helpers', async ({ page }) => {
  await page.goto('/playwright/settlement-smoke.html');
  await expect(page.locator('[data-testid="settlement-1-지출구분"]')).toBeVisible();

  const headerTexts = (await page.locator('thead tr').nth(1).locator('th').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(headerTexts).toEqual(SETTLEMENT_HEADERS);

  await expect(page.getByText('매입부가세는 계산값이 아니라 영수증 기준 확인값입니다')).toBeVisible();

  const paymentMethod = page.locator('[data-testid="settlement-1-지출구분"]');
  const optionTexts = await paymentMethod.locator('option').allTextContents();
  expect(optionTexts).toContain('사업비카드');
  expect(optionTexts).toContain('개인법인카드');
  expect(optionTexts).not.toContain('법인카드(뒷번호1)');

  const vatInput = page.locator('[data-testid="settlement-1-매입부가세"]');
  await vatInput.fill('2,000');
  await expect(page.getByText('공급가액 9,000')).toBeVisible();

  const driveLink = page.getByRole('link', { name: '1행 증빙자료 드라이브 열기' });
  await expect(driveLink).toHaveAttribute('href', /drive\.google\.com/);
});

test('bank reconciliation smoke preserves headers for finance view', async ({ page }) => {
  await page.goto('/playwright/bank-reconciliation-smoke.html?role=finance');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BANK_CSV, 'utf8'),
  });

  await expect(page.getByText('현재 보기 기준:')).toContainText('도담/재경팀 기준');
  await expect(page.locator('[data-testid="bank-description-1"]')).toBeVisible();
  const headerTexts = (await page.locator('thead').locator('th').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(headerTexts).toEqual(BANK_HEADERS);
  await expect(page.locator('[data-testid="bank-description-1"]')).toContainText('Masion Viet (프랑스)');
  await expect(page.locator('[data-testid="system-counterparty-1"]')).toContainText('내부 메모:');
});

test('bank reconciliation smoke masks bank description for pm view', async ({ page }) => {
  await page.goto('/playwright/bank-reconciliation-smoke.html?role=pm');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BANK_CSV, 'utf8'),
  });

  await expect(page.getByText('현재 보기 기준:')).toContainText('사업팀 기준');
  await expect(page.locator('[data-testid="bank-description-1"]')).toBeVisible();
  const headerTexts = (await page.locator('thead').locator('th').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(headerTexts).toEqual(BANK_HEADERS);
  await expect(page.locator('[data-testid="bank-description-1"]')).toContainText('권한 필요');
});
