// 產生 docs/screenshots/ 的截圖（1280 寬）。
// 執行：bun run build && bun run preview --port 4173 &  然後  bun scripts/screenshots.ts http://localhost:4173/
// 也可以對線上版拍：bun scripts/screenshots.ts https://<帳號>.github.io/<repo>/

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
const OUT = 'docs/screenshots';

interface Shot {
  file: string;
  hash: string;
  role?: string;
  lang?: 'zh' | 'en';
  width?: number;
}

const SHOTS: Shot[] = [
  { file: '01-overview-techlead', hash: '/overview' },
  { file: '02-overview-finance', hash: '/overview', role: 'finance' },
  { file: '03-rbac-admin', hash: '/rbac', role: 'admin' },
  { file: '04-about', hash: '/about' },
  { file: '05-overview-en', hash: '/overview', lang: 'en' },
  { file: '06-overview-mobile', hash: '/overview', width: 390 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
for (const shot of SHOTS) {
  const context = await browser.newContext({ viewport: { width: shot.width ?? 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${base}#/overview`);
  await page.waitForSelector('#view h1');
  if (shot.lang === 'en') await page.click('[data-lang="en"]');
  if (shot.role) await page.selectOption('#role-select', shot.role);
  await page.goto(`${base}#${shot.hash}`);
  await page.waitForSelector(`#view[data-page="${shot.hash.split('?')[0]}"] h1`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${shot.file}.png`, fullPage: true });
  console.log(`${OUT}/${shot.file}.png`);
  await context.close();
}
await browser.close();
