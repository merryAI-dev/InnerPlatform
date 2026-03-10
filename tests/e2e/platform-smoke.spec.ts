import { readFile } from 'node:fs/promises';
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

const HANA_BANK_CSV = [
  '거래일시,적요,입금액,출금액,거래 후 잔액',
  '2026-02-12 09:00,Masion Viet (프랑스),0,11520000,1216329459',
].join('\n');

const KOOKMIN_BANK_CSV = [
  '거래일자,기재내용,맡기신금액,찾으신금액,잔액',
  '2026.02.12,Masion Viet (프랑스),0,11520000,1216329459',
].join('\n');

const SHINHAN_BANK_CSV = [
  '거래일,내용,입출금액,거래구분,잔액',
  '20260212,Masion Viet (프랑스),11520000,출금,1216329459',
].join('\n');

test('settlement smoke keeps headers and exposes enhanced helpers', async ({ page }) => {
  await page.goto('/playwright/settlement-smoke.html');
  await expect(page.locator('[data-testid="settlement-1-지출구분"]')).toBeVisible();
  await expect(page.locator('[data-testid="settlement-view-tabs"]')).toBeVisible();

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

  const progressSelect = page.locator('[data-testid="settlement-1-비고-status"]');
  await progressSelect.selectOption('COMPLETE');
  await expect(progressSelect).toHaveValue('COMPLETE');

  await page.locator('[data-testid="settlement-1-거래일시"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="settlement-2-거래일시"]')).toBeFocused();

  await page.locator('[data-testid="settlement-row-insert-1"]').click();
  await expect(page.locator('[data-testid="settlement-21-거래일시"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="settlement-2-no"]')).toHaveValue('2');

  await page.locator('[data-testid="settlement-download-start"]').fill('2026-03-01');
  await page.locator('[data-testid="settlement-download-end"]').fill('2026-03-31');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-testid="settlement-download-range-csv"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('2026-03-01_2026-03-31');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, 'utf8');
  expect(csv).toContain('[완료] 확인 대기');
  expect(csv).not.toContain('출장 파트너');

  const driveLink = page.getByRole('link', { name: '1행 증빙자료 드라이브 열기' });
  await expect(driveLink).toHaveAttribute('href', /drive\.google\.com/);

  await page.locator('[data-testid="settlement-tab-weekly"]').click();
  await expect(page.getByText('26-3-1').first()).toBeVisible();
});

test('bank reconciliation smoke preserves headers and bank policy matrix for finance view', async ({ page }) => {
  const cases = [
    { csv: HANA_BANK_CSV, label: '하나은행 빠른조회', field: '거래일시' },
    { csv: KOOKMIN_BANK_CSV, label: '국민은행 빠른조회', field: '기재내용' },
    { csv: SHINHAN_BANK_CSV, label: '신한은행 빠른조회', field: '거래구분' },
  ];

  for (const bankCase of cases) {
    await page.goto('/playwright/bank-reconciliation-smoke.html?role=finance');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bank.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bankCase.csv, 'utf8'),
    });

    await expect(page.getByText('현재 보기 기준:')).toContainText('도담/재경팀 기준');
    await expect(page.locator('[data-testid="bank-description-1"]')).toContainText('Masion Viet (프랑스)');
    await expect(page.locator('[data-testid="system-counterparty-1"]')).toContainText('내부 메모:');
    await expect(page.locator('[data-testid="bank-policy-profile"]')).toContainText(bankCase.label);
    await expect(page.locator('[data-testid="bank-policy-fields"]')).toContainText(bankCase.field);
    await expect(page.locator('[data-testid="bank-policy-action-빠른조회"]')).toBeVisible();
  }

  const headerTexts = (await page.locator('thead').locator('th').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(headerTexts).toEqual(BANK_HEADERS);
});

test('bank reconciliation smoke masks bank description for pm view', async ({ page }) => {
  await page.goto('/playwright/bank-reconciliation-smoke.html?role=pm');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(HANA_BANK_CSV, 'utf8'),
  });

  await expect(page.getByText('현재 보기 기준:')).toContainText('사업팀 기준');
  await expect(page.locator('[data-testid="bank-description-1"]')).toBeVisible();
  const headerTexts = (await page.locator('thead').locator('th').allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(headerTexts).toEqual(BANK_HEADERS);
  await expect(page.locator('[data-testid="bank-policy-profile"]')).toContainText('하나은행 빠른조회');
  await expect(page.locator('[data-testid="bank-description-1"]')).toContainText('권한 필요');
  await expect(page.locator('[data-testid="bank-policy-fields"]')).not.toContainText('적요');
});
