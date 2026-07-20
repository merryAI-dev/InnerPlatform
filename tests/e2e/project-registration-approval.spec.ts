import { expect, test } from '@playwright/test';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
}

test('pending review document keeps organization-head approval blank and shows memo history', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects/migration-audit');

  await expect(page.getByTestId('migration-review-search-bar')).toBeVisible();
  await expect(page.getByText('검토함', { exact: true })).toBeVisible();
  await expect(page.getByText('CIC 필터', { exact: true })).toBeVisible();
  await expect(page.getByText('상태 필터', { exact: true })).toBeVisible();
  await expect(page.getByText('검토대기', { exact: true })).toBeVisible();
  await expect(page.getByText('승인완료', { exact: true })).toBeVisible();
  await expect(page.getByText('반려', { exact: true })).toBeVisible();

  const fixtureRow = page.getByRole('row').filter({ hasText: 'E2E 결재선 검증 프로젝트' });
  await expect(fixtureRow).toBeVisible();
  const openDocument = fixtureRow.getByRole('button', { name: '문서 열기' });
  await expect(openDocument).toBeVisible();
  await openDocument.click();

  const document = page.getByTestId('migration-review-document');
  await expect(document).toBeVisible();
  await expect(document.getByText('프로젝트 등록 및 승인서', { exact: true })).toBeVisible();
  await expect(document.getByText('기안', { exact: true })).toBeVisible();
  await expect(document.getByText('조직장 승인', { exact: true })).toBeVisible();
  await expect(document.getByText('의견 및 처리 이력', { exact: true })).toBeVisible();
  const organizationHeadApprovalCell = document.getByTestId('organization-head-approval-pending').locator('xpath=..');
  await expect(organizationHeadApprovalCell).toBeAttached();
  await expect(organizationHeadApprovalCell.locator('.rounded-full')).toHaveCount(0);
  await expect(document.getByTestId('organization-head-approval-pending')).toContainText('테스트 조직장');

  const historySection = document.getByRole('heading', { name: '의견 및 처리 이력' }).locator('xpath=..');
  await expect(historySection.getByText('기안 메모: 계약 범위와 예산을 검토해 주세요.', { exact: true })).toBeVisible();
  await expect(historySection.getByText('초기 제출 메모: 계약 범위 확인 부탁드립니다.', { exact: true })).toBeVisible();
  await expect(historySection.getByText('반려 메모: 계약기간을 보완해 주세요.', { exact: true })).toBeVisible();
  await expect(historySection.getByText('재제출 메모: 계약기간을 보완했습니다.', { exact: true })).toBeVisible();

  const contractPreview = document.getByTestId('contract-document-preview');
  await expect(contractPreview).toBeVisible();
  await expect(contractPreview.getByTitle('E2E_프로젝트_계약서.pdf PDF 미리보기')).toHaveAttribute('src', /^data:application\/pdf;base64,/);
  await expect(document.getByText('기본정보', { exact: true })).toBeVisible();
  await expect(document.getByText('계약 및 정산 정보', { exact: true })).toBeVisible();
});
