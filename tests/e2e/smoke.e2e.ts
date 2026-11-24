import { expect, test } from '@playwright/test';
import { menu, open, ROLES, signInAs } from './helpers';

// 冒煙測試：每個角色登入後，選單上的每一頁都開得起來；沒權限的頁面會看到說明。

const ALL_PAGES = ['/overview', '/integration', '/consistency', '/vendors', '/team', '/roadmap', '/demands', '/incidents', '/rbac', '/about'];

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

test('版號寫在 meta、側欄與關於頁', async ({ page }) => {
  await open(page, '/about');
  const version = await page.locator('meta[name="app-version"]').getAttribute('content');
  expect(version).toMatch(/^v\d{8}\.(\d+|dev|r\d+)$/);
  await expect(page.locator('#about-version')).toContainText(version ?? '');
  // 每一頁的側欄底部也看得到同一個版號
  await expect(page.locator('#app-version')).toHaveText(version ?? '');
  await open(page, '/overview');
  await expect(page.locator('#app-version')).toHaveText(version ?? '');
});

test('整合架構：點清單上的介面會開明細；篩選條件留在網址裡，重新整理後還在', async ({ page }) => {
  await open(page, '/integration');
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await page.click('#iface-table a:has-text("INT-014")');
  await expect(page.locator('#int-side')).toContainText('欄位對應');
  await expect(page.locator('#int-side')).toContainText('COST_CENTER');
  await page.selectOption('#f-health', 'attention');
  await expect(page.locator('#iface-table tbody tr')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('#f-health')).toHaveValue('attention');
  await expect(page.locator('#iface-table tbody tr')).toHaveCount(4);
  await expect(page.locator('#int-side')).toContainText('INT-014');
});

test('整合架構：注入故障後，總覽上的數字跟著變；還原後恢復', async ({ page }) => {
  await open(page, '/integration?sys=hr');
  await expect(page.locator('#int-side')).toContainText('如果它停了');
  await page.click('[data-act="fault"]');
  await expect(page.locator('#page-sum')).toContainText('7 條中斷');
  await open(page, '/overview');
  await expect(page.locator('#page-sum')).toContainText('7 條中斷');
  await page.click('#reset-btn');
  await page.click('#do-reset');
  await expect(page.locator('#page-sum')).toContainText('1 條中斷');
});

test('財務主管看不到整合架構，也不能注入故障', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'finance');
  await page.goto('#/integration');
  await expect(page.locator('#view .notice h1')).toHaveText('這個角色看不到這一頁');
});

test('總覽上的數字點進去，看到的列數就是那個數字', async ({ page }) => {
  await open(page, '/overview');
  const health = Number(await page.locator('[data-stat="health"]').getAttribute('data-count'));
  await expect(page.locator('#pending-table tbody tr')).toHaveCount(Number(await page.locator('[data-stat="pending"]').getAttribute('data-count')));
  await expect(page.locator('#sla-table tbody tr')).toHaveCount(Number(await page.locator('[data-stat="sla"]').getAttribute('data-count')));
  // 月結倒數：日曆上到月結日為止的工作日列數（不含今天）
  await page.click('[data-stat="month-end"]');
  await expect(page.locator('#calendar')).toBeFocused();
  const rows = page.locator('#calendar-table tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(page.locator('#calendar-table tbody tr[data-workday="true"]')).toHaveCount(5);
  await page.click('[data-stat="pending"]');
  await expect(page.locator('#pending')).toBeFocused();
  await page.click('[data-stat="health"]');
  await expect(page.locator('#view[data-page="/integration"]')).toBeVisible();
  await expect(page.locator('#iface-table tbody tr')).toHaveCount(health);
});

test('財務主管點「關帳日」會到日曆，不會跳到找不到的頁面', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'finance');
  await page.click('[data-stat="close"]');
  await expect(page.locator('#view .notice')).toHaveCount(0);
  await expect(page.locator('#calendar')).toBeFocused();
  await expect(page.locator('#calendar-table')).toContainText('關帳日');
  await expect(page.locator('#calendar-table')).not.toContainText('INT-');
});

test('資料一致性：技術角色看得到 SQL 與執行計畫；財務主管看不到 SQL', async ({ page }) => {
  await open(page, '/consistency?rule=RC-05');
  await expect(page.locator('#rule-detail')).toContainText('Seq Scan on voucher_line');
  await expect(page.locator('#rule-detail')).toContainText('Index Scan using idx_voucher_line_ap_ref');
  await signInAs(page, 'finance');
  await page.goto('#/consistency?rule=RC-07');
  await expect(page.locator('#rule-detail')).toContainText('台中分公司');
  await expect(page.locator('#diff-table tbody tr')).toHaveCount(3);
  await expect(page.locator('#rule-detail pre')).toHaveCount(0);
  await expect(page.locator('#view')).not.toContainText('SELECT');
});

test('不可逆的變更：把關清單沒勾完不能核准；落在凍結期的變更也不能', async ({ page }) => {
  await open(page, '/incidents?chg=CHG-245');
  const approve = page.locator('[data-act="approve"]');
  await expect(approve).toHaveAttribute('aria-disabled', 'true');
  for (const gate of ['rehearsal', 'signoff', 'abort']) await page.check(`#gate-${gate}`);
  await expect(approve).not.toHaveAttribute('aria-disabled', 'true');
  await approve.click();
  await expect(page.locator('#change-detail')).toContainText('已核准');
  await page.goto('#/incidents?chg=CHG-243');
  await expect(page.locator('#change-detail')).toContainText('月結凍結');
  await expect(page.locator('[data-act="approve"]')).toHaveAttribute('aria-disabled', 'true');
});

test('劇本 A 從頭走到尾：每個角色看到各自的說法，最後事件結案', async ({ page }) => {
  await open(page, '/overview');
  await page.click('#scenario-start');
  await expect(page.locator('#scenario-step')).toHaveText('0/8');

  await page.click('#scenario-next');
  await expect(page.locator('#demo-date')).toContainText('13:05');
  await expect(page.locator('#statements')).toContainText('INT-014 人事→ERP 員工主檔同步，HTTP 504，重試 3/3，37 筆進 DLQ');
  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await expect(page.locator('#scenario-step')).toHaveText('5/8');
  await expect(page.locator('#side-by-side')).toContainText('11 月薪資分錄會晚半天入帳，不影響 12/4 關帳');
  await expect(page.locator('#side-by-side')).toContainText('37 位新進與異動同仁的成本中心還沒更新');

  // 財務主管：沒有技術名詞
  await signInAs(page, 'finance');
  await expect(page.locator('#statements')).toContainText('11 月薪資分錄會晚半天入帳，不影響 12/4 關帳');
  await expect(page.locator('#view')).not.toContainText('INT-');
  await expect(page.locator('#view')).not.toContainText('DLQ');
  // 人資主管：37 位，點進去是 37 列
  await signInAs(page, 'hr');
  await expect(page.locator('#statements')).toContainText('37 位新進與異動同仁的成本中心還沒更新');
  await page.click('[data-fk="detail:INT-014"]');
  await expect(page.locator('#detail-table tbody tr')).toHaveCount(37);

  // 回到工程師：在整合架構頁按「重送 37 筆」，劇本跟著往前走
  await signInAs(page, 'engineer');
  await page.goto('#/integration?iface=INT-014');
  await page.click('[data-act="resend"]');
  await expect(page.locator('#scenario-step')).toHaveText('6/8');
  await expect(page.locator('#toast')).toContainText('已重送 37 筆');
  await page.goto('#/consistency?rule=RC-03');
  await expect(page.locator('#diff-table')).toContainText('37 筆差異都已經處理完');

  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await expect(page.locator('#scenario-bar')).toContainText('已經走完');
  await page.click('#scenario-look');
  await expect(page.locator('#incident-detail')).toContainText('ADR-009');
  await expect(page.locator('#incident-detail')).toContainText('RM-13');
  await expect(page.locator('#incident-detail .stages li.is-done')).toHaveCount(6);
  // 重新整理後還在
  await page.reload();
  await expect(page.locator('#scenario-step')).toHaveText('8/8');
  await expect(page.locator('#incident-detail')).toContainText('ADR-009');
});

test('委外廠商 PM 只看得到自家；換一家廠商，內容跟著換', async ({ page }) => {
  await open(page, '/overview');
  await signInAs(page, 'vendorpm');
  await expect(page.locator('#view[data-page="/vendors"]')).toBeVisible();
  await expect(page.locator('#vendor-table')).toHaveCount(0);
  await expect(page.locator('#vendor-panel h2')).toHaveText('槿川科技');
  await expect(page.locator('#view')).not.toContainText('嶼衡資訊');
  await expect(page.locator('#who')).toContainText('闕定寰');
  await page.selectOption('#vendor-select', 'v-erp');
  await expect(page.locator('#vendor-panel h2')).toHaveText('嶼衡資訊');
  await expect(page.locator('#view')).not.toContainText('槿川科技');
  await expect(page.locator('#who')).toContainText('晏柏諺');
});

test('廠商的 SLA 達成率後面跟著「幾張裡的幾張」，而且等於工單表裡的列數', async ({ page }) => {
  await open(page, '/vendors?vendor=v-crm');
  const note = await page.locator('#vendor-stats .stat').first().locator('.stat-n').innerText();
  const [met, counted] = (note.match(/\d+/g) ?? []).map(Number);
  expect(counted).toBeGreaterThan(10);
  expect(met).toBeLessThan(counted);
  const onTime = await page.locator('#ticket-table tbody tr:has(.mark.is-ok:has-text("準時"))').count();
  expect(onTime).toBe(met);
});

test('核定變更請求要寫原因，核定後留下決策紀錄與稽核軌跡', async ({ page }) => {
  await open(page, '/vendors?vendor=v-crm&tab=cr');
  await page.click('[data-act="decide-cr"]');
  await page.click('[data-verdict="approved"]');
  await expect(page.locator('#toast')).toContainText('請寫原因');
  await page.fill('#cr-why', '晚到會壓到 23:30 的批次，值得花這筆錢');
  await page.click('[data-verdict="approved"]');
  await expect(page.locator('#cr-table')).toContainText('DEC-110');
  await page.goto('#/rbac');
  await expect(page.locator('#audit')).toContainText('核定變更請求');
});

test('3D 與架構圖互跳；在 3D 注入故障，架構圖與總覽的數字一起變', async ({ page }) => {
  await open(page, '/integration?sys=crm');
  await page.click('[data-fk="to-twin"]');
  await expect(page.locator('#view[data-page="/overview"]')).toBeVisible();
  await expect(page.locator('#twin-card')).toContainText('CRM');
  await expect(page.locator('#twin-stage canvas')).toBeVisible();
  await page.click('[data-act="twin-fault"]');
  await expect(page.locator('#twin-impact')).toContainText('1F 業務');
  await expect(page.locator('#page-sum')).toContainText('7 條中斷');
  await page.click('[data-fk="twin-to-map"]');
  await expect(page.locator('#view[data-page="/integration"]')).toBeVisible();
  await expect(page.locator('#page-sum')).toContainText('7 條中斷');
  await expect(page.locator('#int-side')).toContainText('停止（模擬）');
});

test('微縮總行：九個機櫃的標籤各有引線、互不重疊；樓層標籤帶著狀態；three 沒有丟警告', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && message.text().includes('THREE')) warnings.push(message.text());
  });
  await page.goto('#/overview');
  await expect(page.locator('#twin-stage canvas')).toBeVisible();
  const labels = page.locator('#twin-labels .twin-label.is-system');
  await expect(labels).toHaveCount(9);
  await expect(page.locator('#twin-labels .twin-stem')).toHaveCount(9);
  await expect(page.locator('#twin-labels .twin-label.is-floor[data-health]')).toHaveCount(5);
  await expect(page.locator('#twin-key .mark')).toHaveCount(3);
  const boxes = await labels.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
  );
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const apart = boxes[a].right <= boxes[b].left || boxes[b].right <= boxes[a].left || boxes[a].bottom <= boxes[b].top || boxes[b].bottom <= boxes[a].top;
      expect(apart, `第 ${a + 1} 與第 ${b + 1} 個機櫃標籤疊在一起`).toBe(true);
    }
  }
  expect(warnings).toEqual([]);
});

test('微縮總行：拖曳會轉動模型，按「重設視角」回到原位', async ({ page }) => {
  await page.goto('#/overview');
  const canvas = page.locator('#twin-stage canvas');
  await expect(canvas).toBeVisible();
  const label = page.locator('#twin-labels [data-system="hr"]');
  const box = await canvas.boundingBox();
  const before = await label.boundingBox();
  if (!box || !before) throw new Error('畫布或標籤還沒出現');
  // 從左上角的空白處往右拖，不會點到機櫃
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(((await label.boundingBox())?.x ?? before.x) - before.x)).toBeGreaterThan(3);
  await expect(page).toHaveURL(/#\/overview$/);
  await page.click('#twin-reset');
  await expect.poll(async () => Math.abs(((await label.boundingBox())?.x ?? 0) - before.x)).toBeLessThan(1);
});

test('微縮總行：點樓層只列那個單位的介面；方向鍵在機櫃標籤之間移動', async ({ page }) => {
  await open(page, '/overview');
  await expect(page.locator('#twin-stage canvas')).toBeVisible();
  await page.click('#twin-labels [data-pick="floor:hr"]');
  await expect(page).toHaveURL(/floor=hr/);
  await expect(page.locator('#twin-floor-card')).toContainText('3F 人資');
  await expect(page.locator('#twin-labels [data-pick="floor:hr"]')).toHaveAttribute('aria-pressed', 'true');
  const rows = page.locator('#twin-flows tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#twin-flows')).toContainText('INT-014');
  await expect(page.locator('#twin-flows')).not.toContainText('INT-021');
  // 再點一次是取消
  await page.click('#twin-labels [data-pick="floor:hr"]');
  await expect(page.locator('#twin-floor-card')).toHaveCount(0);
  await page.locator('#twin-labels [data-system="hr"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#twin-labels [data-system="crm"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#twin-card')).toContainText('CRM');
  await expect(page.locator('#twin-card')).toContainText('廠商代管機房');
});

test('三個比例尺：全台有三個機房與 8 處據點，海外有 6 處據點的時鐘；3D 沒有丟警告', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) warnings.push(message.text());
  });
  await open(page, '/overview');
  await expect(page.locator('#twin-stage canvas')).toBeVisible();
  // 總行 → 全台
  await page.click('#twin-views [data-view="tw"]');
  await expect(page).toHaveURL(/view=tw/);
  await expect(page.locator('#twin-labels .twin-label.is-site')).toHaveCount(11);
  await expect(page.locator('#twin-labels .twin-label.is-region')).toHaveCount(3);
  await expect(page.locator('#twin-sites tbody tr')).toHaveCount(11);
  await expect(page.locator('#twin-dr tbody tr')).toHaveCount(9);
  const pins = await page
    .locator('#twin-labels .twin-label.is-site')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
  for (let a = 0; a < pins.length; a++) {
    for (let b = a + 1; b < pins.length; b++) {
      const apart = pins[a].right <= pins[b].left || pins[b].right <= pins[a].left || pins[a].bottom <= pins[b].top || pins[b].bottom <= pins[a].top;
      expect(apart, `第 ${a + 1} 與第 ${b + 1} 個據點標籤疊在一起`).toBe(true);
    }
  }
  // 點據點的標籤出資料卡；點區域只列那一區
  await page.click('#twin-labels [data-pick="site:br-tc"]');
  await expect(page.locator('#twin-site-card')).toContainText('台中分公司');
  await expect(page.locator('#twin-site-card')).toContainText('中區');
  await page.click('#twin-labels [data-pick="region:south"]');
  await expect(page.locator('#twin-region-card')).toContainText('南區');
  await expect(page.locator('#twin-sites tbody tr')).toHaveCount(3);
  await page.click('#twin-sites [data-site="br-kh"]');
  await expect(page.locator('#twin-site-card')).toContainText('高雄分公司');
  // 全台 → 海外
  await page.click('#twin-views [data-view="world"]');
  await expect(page.locator('#twin-labels .twin-label.is-site')).toHaveCount(7);
  await expect(page.locator('#twin-clocks tbody tr')).toHaveCount(7);
  await expect(page.locator('#twin-day-table tbody tr')).toHaveCount(7);
  await expect(page.locator('#twin-day-sum')).toContainText('26 小時');
  await expect(page.locator('#twin-world-now')).toContainText('海外 3 處上班中');
  // 回到總行
  await page.click('#twin-views [data-view="hq"]');
  await expect(page.locator('#twin-labels .twin-label.is-system')).toHaveCount(9);
  await expect(page.locator('#twin-day')).toBeEmpty();
  expect(warnings).toEqual([]);
});

test('海外：重播到 23 點，紐約在上班、撞到夜間批次，台北只剩值班', async ({ page }) => {
  await open(page, '/overview?view=world&site=os-nyc');
  await expect(page.locator('#twin-site-card')).toContainText('紐約分行');
  await expect(page.locator('#twin-site-card')).toContainText('休息');
  await page.locator('#twin-hour').fill('23');
  await expect(page.locator('#twin-site-card')).toContainText('上班中');
  await expect(page.locator('#twin-site-card')).toContainText('週一 10:00');
  await expect(page.locator('#twin-site-card')).toContainText('比台北慢 13 小時');
  await expect(page.locator('#twin-site-card')).toContainText('INT-061');
  await expect(page.locator('#twin-site-card')).toContainText('只有值班');
  await expect(page.locator('#twin-world-now')).toContainText('台北只有值班');
  await expect(page.locator('#twin-labels [data-pick="site:os-nyc"]')).toContainText('紐約 週一 10:00');
});

test('演練總行機房停擺：時間往後，回來的系統變多；簽呈最慢，它回來之前每層樓都受影響；結束後恢復原狀', async ({ page }) => {
  await open(page, '/overview');
  await page.click('#twin-drill-toggle');
  await expect(page.locator('#twin-drill')).toContainText('8 個還沒回來');
  await expect(page.locator('#twin-drill')).toContainText('CRM 放在廠商機房');
  await expect(page.locator('#twin-impact')).toContainText('5F 資訊');
  await page.click('#twin-drill-steps [data-drill="3"]');
  await expect(page.locator('#twin-drill')).toContainText('停擺後 4 小時');
  await expect(page.locator('#twin-drill')).toContainText('5 個系統已在備援中心接手');
  await expect(page.locator('#twin-drill')).toContainText('全部回來要 3 天');
  await expect(page.locator('#twin-impact')).toContainText('1F 業務');
  // 同一個演練，換到全台看：據點改連備援中心，備援等級的表多一欄演練
  await page.click('#twin-views [data-view="tw"]');
  await expect(page.locator('#twin-drill')).toContainText('停擺後 4 小時');
  await expect(page.locator('#twin-dr')).toContainText('還沒回來');
  await expect(page.locator('#twin-dr')).toContainText('已接手');
  await expect(page.locator('#twin-labels [data-pick="site:dc-dr"]')).toContainText('接手 5');
  await page.click('#twin-drill-steps [data-drill="6"]');
  await expect(page.locator('#twin-drill')).toContainText('都在備援中心接手了');
  await expect(page.locator('#twin-impact')).toHaveCount(0);
  await page.click('#twin-drill-toggle');
  await expect(page.locator('#twin-drill')).toHaveCount(0);
  // 演練沒有改資料：總覽上的數字跟一開始一樣
  await page.click('#twin-views [data-view="hq"]');
  await expect(page.locator('#twin-impact')).toHaveCount(0);
});

test('時間軸重播月結日：拉到 23 點，清單換成夜間批次', async ({ page }) => {
  await open(page, '/overview');
  await expect(page.locator('#twin-flows')).toContainText('INT-014');
  await page.locator('#twin-hour').fill('23');
  await expect(page.locator('#twin-hour-out')).toHaveText('23:00');
  await expect(page.locator('#twin-flows')).toContainText('INT-061');
  await expect(page.locator('#twin-flows')).not.toContainText('INT-021');
  await page.click('#twin-now');
  await expect(page.locator('#twin-flows')).toContainText('INT-021');
});

test.describe('關閉 WebGL', () => {
  test.beforeEach(async ({ page }) => {
    // 讓瀏覽器拿不到任何 WebGL context，跟使用者關掉硬體加速或被群組原則封鎖時一樣
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl') || type === 'experimental-webgl') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
  });

  test('3D 換成同一份資料的清單，其他功能照常', async ({ page }) => {
    await open(page, '/overview');
    await expect(page.locator('#twin-fallback')).toContainText('沒有開啟 WebGL');
    await expect(page.locator('#twin-fallback tbody tr')).toHaveCount(14);
    await page.click('#twin-fallback [data-system="hr"]');
    await expect(page.locator('#twin-card')).toContainText('人事薪資');
    await page.click('[data-act="twin-fault"]');
    await expect(page.locator('#twin-fallback')).toContainText('受影響');
    // 另外兩個比例尺也有清單可以看
    await page.click('#twin-views [data-view="tw"]');
    await expect(page.locator('#twin-fallback-sites tbody tr')).toHaveCount(11);
    await page.click('#twin-views [data-view="world"]');
    await expect(page.locator('#twin-fallback-clocks tbody tr')).toHaveCount(7);
    await page.click('#twin-fallback [data-site="os-lon"]');
    await expect(page.locator('#twin-site-card')).toContainText('倫敦分行');
    for (const path of ALL_PAGES) {
      await open(page, path);
      await expect(page.locator('#view .notice')).toHaveCount(0);
    }
    await open(page, '/integration');
    await expect(page.locator('.react-flow__node')).toHaveCount(9);
  });

  test('劇本 A 照樣走得完', async ({ page }) => {
    await open(page, '/overview');
    await page.click('#scenario-start');
    for (let i = 0; i < 8; i++) await page.click('#scenario-next');
    await expect(page.locator('#scenario-bar')).toContainText('已經走完');
    await expect(page.locator('#twin-fallback')).toBeVisible();
  });
});

test('劇本 B：在頁面上按「退件」與「核定」，劇本跟著走，最後留下決策紀錄', async ({ page }) => {
  await open(page, '/overview');
  await page.selectOption('#scenario-select', 'B');
  await page.click('#scenario-start');
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await expect(page.locator('#deliverable-table')).toContainText('等驗收');
  await page.click('[data-act="reject"][data-dl="DL-415"]');
  await expect(page.locator('#scenario-step')).toHaveText('2/6');
  await expect(page.locator('#deliverable-table')).toContainText('312 位客戶');
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await expect(page.locator('#late-table')).toContainText('DL-415');
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await expect(page.locator('#raci-table')).toContainText('有爭議');
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await page.click('[data-act="decide-cr"][data-cr="CR-035"]');
  await expect(page.locator('#scenario-bar')).toContainText('已經走完');
  await page.click('#scenario-look');
  await expect(page.locator('#decision-table')).toContainText('DEC-110');
  await expect(page.locator('#decision-table')).toContainText('兩邊都有責任');
});

test('劇本 C：並行對帳、切換日與回滾條件，最後寫進路徑圖', async ({ page }) => {
  await open(page, '/overview');
  await page.selectOption('#scenario-select', 'C');
  await page.click('#scenario-start');
  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await expect(page.locator('#rule-detail')).toContainText('新簽呈（試行）');
  await expect(page.locator('#diff-table tbody tr')).toHaveCount(3);
  await page.click('#scenario-next');
  await page.click('#scenario-look');
  await expect(page.locator('#change-detail .gates li')).toHaveCount(5);
  await expect(page.locator('[data-act="approve"]')).toHaveAttribute('aria-disabled', 'true');
  await page.click('#scenario-next');
  await page.click('#scenario-next');
  await expect(page.locator('#scenario-bar')).toContainText('已經走完');
  await page.click('#scenario-look');
  await expect(page.locator('#item-detail')).toContainText('2027-03-13');
  await expect(page.locator('#item-detail')).toContainText('RC-11');
});

test('關於頁的對照表：八項職缺要求，每一項都連得到那一頁', async ({ page }) => {
  await open(page, '/about');
  await expect(page.locator('#map-table tbody tr')).toHaveCount(8);
  const hrefs = await page.locator('#map-table a').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThanOrEqual(16);
  for (const target of [...new Set(hrefs)]) {
    await page.goto(target);
    await expect(page.locator('#view .notice')).toHaveCount(0);
    await expect(page.locator('#view h1')).toBeVisible();
  }
});
