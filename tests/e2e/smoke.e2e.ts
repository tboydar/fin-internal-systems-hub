import { expect, test } from '@playwright/test';
import { menu, open, ROLES, signInAs } from './helpers';

// 冒煙測試：每個角色登入後，選單上的每一頁都開得起來；沒權限的頁面會看到說明。

const ALL_PAGES = ['/overview', '/rbac', '/about'];

for (const role of ROLES) {
  test(`${role}：選單上的每一頁都開得起來，而且沒有錯誤`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await open(page, '/overview');
    await signInAs(page, role);
    const allowed = await menu(page);
    expect(allowed).toContain('/overview');
    expect(allowed).toContain('/about');
    for (const path of allowed) {
      await open(page, path);
      await expect(page.locator('#view .notice')).toHaveCount(0);
    }
    for (const path of ALL_PAGES.filter((p) => !allowed.includes(p))) {
      await page.goto(`#${path}`);
      await expect(page.locator('#view .notice h1')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test('八個角色看到的選單與登入身分確實不同', async ({ page }) => {
  await open(page, '/overview');
  const seen = new Map<string, string>();
  for (const role of ROLES) {
    await signInAs(page, role);
    await expect(page.locator('#who b')).toBeVisible();
    seen.set(role, `${(await menu(page)).join(',')}|${await page.locator('#who').innerText()}`);
  }
  expect(new Set(seen.values()).size).toBe(ROLES.length);
});

test('技術角色看到介面編號；財務主管看到的說法沒有編號', async ({ page }) => {
  await open(page, '/overview');
  await expect(page.locator('#view')).toContainText('INT-055');
  await signInAs(page, 'finance');
  await expect(page.locator('#view h1')).toBeVisible();
  await expect(page.locator('#view')).not.toContainText('INT-');
  await expect(page.locator('#view')).toContainText('各據點當天的手續費收入入帳');
});

test('重新整理不會 404，而且留在同一頁、同一個身分', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'admin');
  await expect(page.locator('#view[data-page="/rbac"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('#view[data-page="/rbac"]')).toBeVisible();
  await expect(page.locator('#role-select')).toHaveValue('admin');
});

test('系統管理員改了權限矩陣，立刻生效並留下稽核軌跡；還原後恢復', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'admin');
  await page.check('#cb-engineer-release\\.approve');
  await expect(page.locator('#sod')).toContainText('SOD-1');
  await expect(page.locator('#audit')).toContainText('授予權限');
  await page.reload();
  await expect(page.locator('#sod')).toContainText('SOD-1');
  await page.click('[data-act="reset-matrix"]');
  await expect(page.locator('#sod')).not.toContainText('SOD-1');
});

test('稽核只能看權限矩陣，不能改', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'auditor');
  await expect(page.locator('#view[data-page="/rbac"]')).toBeVisible();
  await expect(page.locator('#view input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('[data-act="reset-matrix"]')).toHaveAttribute('aria-disabled', 'true');
});

test('切到英文後，畫面上沒有殘留的中文', async ({ page }) => {
  await open(page, '/overview');
  await page.click('[data-lang="en"]');
  for (const path of ALL_PAGES) {
    await open(page, path);
    const text = await page.locator('.shell').innerText();
    expect(text.match(/[一-鿿]+/g) ?? []).toEqual([]);
  }
});

test('瀏覽器只向網站本身拿靜態檔案，資料只存在 localStorage', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost/').origin;
  const requests: { url: string; method: string; type: string }[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  for (const path of ALL_PAGES) {
    await open(page, path);
    await page.waitForLoadState('networkidle');
  }
  const http = requests.filter((r) => /^https?:/.test(r.url));
  expect(http.length).toBeGreaterThan(3);
  expect(http.filter((r) => new URL(r.url).origin !== origin).map((r) => r.url)).toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`)).toEqual([]);
  expect(requests.filter((r) => ['xhr', 'fetch', 'websocket', 'eventsource', 'ping'].includes(r.type)).map((r) => `${r.type} ${r.url}`)).toEqual([]);
  const stored = await page.evaluate(() => ({ cookie: document.cookie, keys: Object.keys(localStorage), session: sessionStorage.length }));
  expect(stored.cookie).toBe('');
  expect(stored.session).toBe(0);
  expect(stored.keys.filter((key) => !key.startsWith('fish:'))).toEqual([]);
});

test('版號寫在 meta 與關於頁', async ({ page }) => {
  await open(page, '/about');
  const version = await page.locator('meta[name="app-version"]').getAttribute('content');
  expect(version).toMatch(/^v\d{8}\.(\d+|dev|r\d+)$/);
  await expect(page.locator('#about-version')).toContainText(version ?? '');
});
