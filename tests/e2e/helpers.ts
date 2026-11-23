import { expect, type Page } from '@playwright/test';

export const ROLES = ['techlead', 'engineer', 'vendorpm', 'finance', 'hr', 'business', 'auditor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** 開啟某一頁（hash 路由）。每個測試都是全新的瀏覽器環境，所以資料一定是初始狀態。 */
export async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`#${hash}`);
  // 在站內換頁時，上一頁的畫面會留到新頁面的程式載入完成。等 #view 標上新的路徑，才是真的換過去了。
  await expect(page.locator(`#view[data-page="${hash.split('?')[0]}"]`)).toBeVisible();
  await expect(page.locator('#view h1')).toBeVisible();
}

/** 用某個角色登入。登入後會被帶到那個角色的首頁。 */
export async function signInAs(page: Page, role: Role): Promise<void> {
  await page.selectOption('#role-select', role);
  await expect(page.locator('#role-select')).toHaveValue(role);
}

/** 選單上目前列出的頁面路徑。 */
export function menu(page: Page): Promise<string[]> {
  return page.locator('.nav a').evaluateAll((links) => links.map((a) => (a.getAttribute('href') ?? '').replace('#', '')));
}
