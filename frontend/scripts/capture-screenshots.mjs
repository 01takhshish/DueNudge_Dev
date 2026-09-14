// Captures the landing-page screenshots from a running demo-mode frontend: node scripts/capture-screenshots.mjs

import { chromium } from '@playwright/test';
const base = 'http://localhost:3100';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await page.goto(`${base}/demo`);
await page.waitForURL(/\/app$/);
await page.waitForTimeout(500);
await page.screenshot({ path: 'public/screenshots/dashboard.png' });
await page.goto(`${base}/app/invoices?status=overdue`);
await page.locator('a[href^="/app/invoices/i-"]').first().click();
await page.waitForURL(/\/app\/invoices\/[^/]+$/);
await page.getByRole('button', { name: 'Draft with AI' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'public/screenshots/invoice.png' });
const pub = await page.locator('a[href*="/i/"]').first().getAttribute('href');
const anon = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p2 = await anon.newPage();
await p2.goto(pub);
await p2.waitForTimeout(300);
await p2.screenshot({ path: 'public/screenshots/public-invoice.png' });
await browser.close();
console.log('captured', pub);
