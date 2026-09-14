/**
 * The one end-to-end flow that matters commercially:
 * sign up -> onboard -> create client -> create invoice -> send it -> reminders scheduled -> record payment.
 * Runs against the full stack (web + api + postgres + redis). Email delivery is verified at the API level
 * in the integration suite; here we assert the product behaviour a user sees.
 */
import { expect, test } from '@playwright/test';

const unique = Date.now().toString(36);
const email = `e2e-${unique}@example.com`;

test('freelancer can sign up, onboard, invoice a client and get paid', async ({
  page,
  browser,
}) => {
  // Sign up
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByLabel('Workspace name').fill(`E2E Studio ${unique}`);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Onboarding: business -> first client -> schedule
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Business name').fill(`E2E Studio ${unique}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Contact name').fill('Globex AP');
  await page.getByLabel('Email').fill(`ap-${unique}@globex.test`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Finish/ }).click();

  // Lands on new-invoice with the client preselected
  await expect(page).toHaveURL(/\/app\/invoices\/new/);
  await page.getByPlaceholder('Design work — homepage').fill('Website redesign');
  await page.getByPlaceholder('0.00').fill('1500');
  await page.getByRole('button', { name: 'Create draft' }).click();

  // Draft page -> send
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: /INV-0001/ })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
  await expect(page.getByText(/before due|on due|overdue/).first()).toBeVisible();
  await expect(page.getByText('Public link:')).toBeVisible();

  // The public page works without auth (fresh browser context = no cookies)
  const publicHref = await page.locator('a', { hasText: /\/i\// }).first().getAttribute('href');
  expect(publicHref).toBeTruthy();
  const anonymous = await browser.newContext();
  const publicPage = await anonymous.newPage();
  await publicPage.goto(publicHref!);
  await expect(publicPage.getByText('INV-0001', { exact: true })).toBeVisible();
  await expect(publicPage.getByText('Website redesign')).toBeVisible();
  await anonymous.close();

  // Record full payment
  await page.reload();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('paid', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Paid — thank you!').or(page.getByText('skipped').first()),
  ).toBeVisible();

  // Dashboard reflects it
  await page.goto('/app');
  await expect(page.getByText('Collected this month')).toBeVisible();
  await expect(page.getByText('$1,500.00').first()).toBeVisible();
});

test('plan limits surface as an upgrade prompt, not an error page', async ({ page }) => {
  const e = `e2e-limit-${unique}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Limit Tester');
  await page.getByLabel('Email').fill(e);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: /Finish/ }).click();
  await expect(page).toHaveURL(/\/app$/); // wait for the post-onboarding redirect before navigating away

  for (let i = 1; i <= 4; i++) {
    await page.goto('/app/clients/new');
    await page.getByLabel('Contact name').fill(`Client ${i}`);
    await page.getByLabel('Email').fill(`c${i}-${unique}@example.com`);
    await page.getByRole('button', { name: 'Create client' }).click();
    if (i < 4) await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]+$/);
  }
  await expect(page.getByRole('dialog')).toContainText('Plan limit reached');
  await expect(page.getByRole('dialog')).toContainText('3 of 3 clients');
});
