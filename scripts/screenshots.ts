// 產生 docs/screenshots/ 的截圖（1280 寬）。
// 執行：bun run build && bun run preview --port 4173 &  然後  bun scripts/screenshots.ts http://localhost:4173/
// 也可以對線上版拍：bun scripts/screenshots.ts https://<帳號>.github.io/<repo>/

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4173/';
// 第二個參數可以只拍檔名開頭符合的那幾張，例如 bun scripts/screenshots.ts http://localhost:4173/ 22
const only = process.argv[3];
const OUT = 'docs/screenshots';

interface Shot {
  file: string;
  hash: string;
  role?: string;
  lang?: 'zh' | 'en';
  width?: number;
  /** 3D 的時間軸要拉到幾點。 */
  hour?: number;
}

const SHOTS: Shot[] = [
  { file: '01-overview-techlead', hash: '/overview' },
  { file: '02-overview-finance', hash: '/overview', role: 'finance' },
  { file: '16-twin-impact', hash: '/overview?focus=hr&what=if' },
  { file: '22-twin-night', hash: '/overview?focus=erp-gl', hour: 23 },
  { file: '23-twin-taiwan', hash: '/overview?view=tw&site=br-tc' },
  { file: '24-twin-drill', hash: '/overview?view=tw&drill=3' },
  { file: '25-twin-overseas', hash: '/overview?view=world&site=os-nyc', hour: 23 },
  { file: '07-integration', hash: '/integration' },
  { file: '08-integration-iface', hash: '/integration?iface=INT-014' },
  { file: '09-integration-impact', hash: '/integration?sys=hr&impact=hr' },
  { file: '10-consistency-plan', hash: '/consistency?rule=RC-05' },
  { file: '11-incidents', hash: '/incidents?inc=INC-2606' },
  { file: '12-changes', hash: '/incidents?chg=CHG-245' },
  { file: '13-overview-hr', hash: '/overview', role: 'hr' },
  { file: '14-vendors', hash: '/vendors?vendor=v-crm' },
  { file: '15-vendors-penalty', hash: '/vendors?vendor=v-crm&tab=penalty' },
  { file: '17-team-skills', hash: '/team?tab=skills' },
  { file: '18-team-docs', hash: '/team?tab=docs' },
  { file: '19-roadmap-eng', hash: '/roadmap?view=eng' },
  { file: '20-roadmap-finance', hash: '/roadmap', role: 'finance' },
  { file: '21-demands', hash: '/demands?req=REQ-303' },
  { file: '03-rbac-admin', hash: '/rbac', role: 'admin' },
  { file: '04-about', hash: '/about' },
  { file: '05-overview-en', hash: '/overview', lang: 'en' },
  { file: '06-overview-mobile', hash: '/overview', width: 390 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
for (const shot of SHOTS) {
  if (only && !shot.file.startsWith(only)) continue;
  const context = await browser.newContext({ viewport: { width: shot.width ?? 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${base}#/overview`);
  await page.waitForSelector('#view h1');
  if (shot.lang === 'en') await page.click('[data-lang="en"]');
  if (shot.role) await page.selectOption('#role-select', shot.role);
  await page.goto(`${base}#${shot.hash}`);
  await page.waitForSelector(`#view[data-page="${shot.hash.split('?')[0]}"] h1`);
  await page.waitForLoadState('networkidle');
  // 流程圖是延遲載入的，等它畫出節點
  if (shot.hash.startsWith('/integration') || shot.hash.startsWith('/demands')) await page.waitForSelector('.react-flow__node');
  // 3D 場景也是延遲載入的，等畫布出現
  if (shot.hash.startsWith('/overview')) await page.waitForSelector('#twin-stage canvas, #twin-fallback', { timeout: 15000 });
  if (shot.hour !== undefined) {
    await page.locator('#twin-hour').fill(String(shot.hour));
    // 拉時間軸會把頁面捲下去，拍之前捲回最上面
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // 3D 的光線漸變要半秒多
  await page.waitForTimeout(shot.hash.startsWith('/overview') ? 1200 : 400);
  await page.screenshot({ path: `${OUT}/${shot.file}.png`, fullPage: true });
  console.log(`${OUT}/${shot.file}.png`);
  await context.close();
}
await browser.close();
