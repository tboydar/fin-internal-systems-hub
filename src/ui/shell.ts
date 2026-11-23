import { can, persona } from '../core/auth';
import { dayOf, fmtDate, timeOf } from '../core/date';
import { getLang, T, tx } from '../core/i18n';
import { type Perm, ROLE_NAME, ROLES } from '../core/rbac';
import { currentRoute, HOME, href, navigate, onRouteChange, type Route } from '../core/router';
import { endScenario, nextStep, SCENARIOS, scenarioStatus, startScenario } from '../core/scenario';
import { closeCountdown } from '../core/selectors';
import { store } from '../core/store';
import type { L10n, Lang, RoleId, ScenarioId, VendorId } from '../core/types';
import { APP_VERSION } from '../core/version';
import { ORG } from '../mock/org';
import { mount as mountOverview } from '../pages/overview';
import { $, html, on, openModal, raw, type Safe, setHtml, toast } from './dom';
import { icon } from './icons';

// 外殼分成兩層，刻意畫得不一樣：
//   最上面一條是「Demo 控制」：切換登入身分、語言、劇本、還原資料。這是看 Demo 的人在用的，不屬於那套內部工具。
//   下面才是工具本身：側欄選單與頁面。選單只列出目前角色有權限的頁面。

export interface PageHandle {
  destroy(): void;
  /** 同一頁只換查詢參數時呼叫；沒有實作就整頁重掛。 */
  route?(route: Route): void;
}
export type PageMount = (root: HTMLElement, route: Route) => PageHandle;

interface PageDef {
  path: string;
  perm: Perm;
  name: L10n;
  icon: string;
  load: () => Promise<{ mount: PageMount }>;
}

const page = (path: string, perm: Perm, zh: string, en: string, icon: string, load: PageDef['load']): PageDef => ({ path, perm, name: { zh, en }, icon, load });

// 總覽是預設頁，直接打包進主程式；其餘頁面各自切成獨立 chunk，點到才下載。
export const PAGES: PageDef[] = [
  page('/overview', 'page.overview', '總覽', 'Overview', 'overview', async () => ({ mount: mountOverview })),
  page('/integration', 'page.integration', '整合架構', 'Integration', 'integration', () => import('../pages/integration')),
  page('/consistency', 'page.consistency', '資料一致性', 'Data consistency', 'consistency', () => import('../pages/consistency')),
  page('/vendors', 'page.vendors', '廠商管理', 'Vendors', 'vendors', () => import('../pages/vendors')),
  page('/team', 'page.team', '團隊與規範', 'Team & standards', 'team', () => import('../pages/team')),
  page('/incidents', 'page.incidents', '事件與變更', 'Incidents & changes', 'incidents', () => import('../pages/incidents')),
  page('/rbac', 'page.rbac', '權限矩陣', 'Permissions', 'rbac', () => import('../pages/rbac')),
  page('/about', 'page.about', '關於這個 Demo', 'About this demo', 'about', () => import('../pages/about')),
];

/** 每個角色登入後先看到哪一頁。那一頁還沒有或沒權限時，退回總覽。 */
const LANDING: Record<RoleId, string> = {
  techlead: '/overview',
  engineer: '/overview',
  vendorpm: '/vendors',
  finance: '/overview',
  hr: '/overview',
  business: '/overview',
  auditor: '/rbac',
  admin: '/rbac',
};

export function landingOf(role: RoleId): string {
  const def = PAGES.find((p) => p.path === LANDING[role]);
  return def && store.state.rbac[role]?.includes(def.perm) ? def.path : HOME;
}

/** 目前的角色能不能開某一頁（那一頁存在，而且有權限）。 */
export function canOpen(path: string): boolean {
  const def = PAGES.find((p) => p.path === path);
  return !!def && can(def.perm);
}

export function mountShell(app: HTMLElement): void {
  setHtml(
    app,
    html`<a class="skip-link" href="#view" id="skip"></a>
    <div class="demo-bar" id="demo-bar"></div>
    <div class="shell"><aside class="sidebar" id="side"></aside><main id="view" tabindex="-1"></main></div>`,
  );
  const bar = $('#demo-bar', app);
  const side = $('#side', app);
  const view = $('#view', app);
  const skip = $('#skip', app);

  function scenarioControls(): Safe {
    const status = scenarioStatus(store.state);
    if (!status) {
      const ids = Object.keys(SCENARIOS) as ScenarioId[];
      return html`<span class="demo-row" id="scenario-bar">
        <label for="scenario-select">${T('劇本', 'Scenario')}</label>
        <select id="scenario-select">${ids.map((id) => html`<option value="${id}">${id}. ${tx(SCENARIOS[id]?.name)}</option>`)}</select>
        <button type="button" class="btn btn-sm" id="scenario-start">${icon('play', 13)}${T('開始（資料會先還原）', 'Start (data is restored first)')}</button>
      </span>`;
    }
    const { def, step, total, last, next, done } = status;
    const look = last && canOpen(last.look.path) ? last.look : null;
    return html`<span class="demo-row is-running" id="scenario-bar" role="status">
      <b>${T('劇本 {id}', 'Scenario {id}', { id: def.id })}</b>
      <span class="num" id="scenario-step">${step}/${total}</span>
      <span id="scenario-last">${last ? tx(last.title) : tx(def.brief)}</span>
      ${look ? html`<a class="btn btn-sm" href="${href(look.path, look.query)}" id="scenario-look">${T('去看：', 'See: ')}${tx(look.label)}</a>` : ''}
      ${
        done
          ? html`<span>${T('已經走完。', 'Finished.')}</span>`
          : html`<button type="button" class="btn btn-sm btn-primary" id="scenario-next">${icon('next', 13)}${T('下一步：', 'Next: ')}${tx(next?.title)}</button>`
      }
      <button type="button" class="btn btn-sm" id="scenario-end">${icon('stop', 13)}${T('結束劇本', 'End scenario')}</button>
    </span>`;
  }

  function renderBar(): void {
    const { role, lang, vendorId } = store.prefs;
    const c = closeCountdown(store.state);
    skip.textContent = T('跳到主要內容', 'Skip to main content');
    setHtml(
      bar,
      html`<span class="demo-row">
        <span class="demo-tag">${T('Demo 控制', 'Demo controls')}</span>
        <span class="demo-date" id="demo-date">${T('Demo 日期', 'Demo date')} <b class="num">${fmtDate(dayOf(c.now))} ${timeOf(c.now)}</b>${T(
          '，月結前 {n} 個工作日。這是固定的示範日期。',
          ', {n} working {n|day|days} before month-end. This date is fixed for the demo.',
          { n: c.toMonthEnd },
        )}</span>
        <span class="demo-tools">
          <label for="role-select">${T('登入身分', 'Signed in as')}</label>
          <select id="role-select">${ROLES.map((r) => html`<option value="${r}" ${r === role ? raw('selected') : ''}>${tx(ROLE_NAME[r])}</option>`)}</select>
          ${
            role === 'vendorpm'
              ? html`<label for="vendor-select" class="sr-only">${T('代表哪一家廠商', 'Which vendor')}</label>
                <select id="vendor-select">${store.state.vendors.map((v) => html`<option value="${v.id}" ${v.id === vendorId ? raw('selected') : ''}>${tx(v.name)}</option>`)}</select>`
              : ''
          }
          <span class="seg" role="group" aria-label="${T('語言', 'Language')}">
            <button type="button" data-lang="zh" lang="zh-Hant" aria-pressed="${String(lang === 'zh')}">中文</button>
            <button type="button" data-lang="en" lang="en" aria-pressed="${String(lang === 'en')}">EN</button>
          </span>
          <button type="button" class="btn btn-sm" id="reset-btn">${icon('reset', 14)}${T('還原 Demo 資料', 'Restore demo data')}</button>
        </span>
      </span>
      ${scenarioControls()}`,
    );
  }

  function renderSide(): void {
    const active = currentRoute().path;
    const who = persona();
    setHtml(
      side,
      html`<a class="brand" href="${href(HOME)}"><b>${tx(ORG.name)}</b><span>${tx(ORG.product)}</span></a>
      <p class="who" id="who"><b>${tx(who.name)}</b><span>${tx(who.title)}</span></p>
      <nav class="nav" aria-label="${T('主選單', 'Main menu')}">
        ${PAGES.filter((p) => can(p.perm)).map(
          (p) =>
            html`<a href="${href(p.path)}" class="${p.path === active ? 'is-active' : ''}" ${p.path === active ? raw('aria-current="page"') : ''}>${icon(p.icon)}<span>${tx(p.name)}</span></a>`,
        )}
      </nav>
      <p class="sidebar-foot">${T('機構、廠商、人名與數字全部虛構。', 'The institution, vendors, people and numbers are all fictional.')}
        <a class="ver num" id="app-version" href="${href('/about')}" title="${T('版號：台灣日期，加上當天第幾次 CI', 'Version: Taiwan date plus the CI run count for that day')}">${APP_VERSION}</a></p>`,
    );
  }

  let handle: PageHandle | null = null;
  let token = 0;
  let lastPath = '';

  function notice(title: string, body: string, path: string): void {
    setHtml(
      view,
      html`<div class="page"><div class="notice"><h1>${title}</h1><p>${body}</p><a class="btn" href="${href(landingOf(store.prefs.role))}">${T('回到我的首頁', 'Back to my home page')}</a></div></div>`,
    );
    view.dataset.page = path;
  }

  async function show(): Promise<void> {
    const route = currentRoute();
    const def = PAGES.find((p) => p.path === route.path);
    // 同一頁只換查詢參數：交給頁面自己更新，流程圖與 3D 場景不必重建
    if (def && handle?.route && route.path === lastPath && can(def.perm)) {
      handle.route(route);
      return;
    }
    handle?.destroy();
    handle = null;
    const mine = ++token;
    renderSide();
    const sep = getLang() === 'zh' ? '｜' : ' | ';
    document.title = `${def ? tx(def.name) : T('找不到這一頁', 'Page not found')}${sep}${tx(ORG.name)} ${tx(ORG.product)}`;
    if (!def) {
      lastPath = '';
      notice(T('找不到這一頁', 'Page not found'), T('網址可能打錯了，或這一頁已經改名。', 'The address may be mistyped, or the page was renamed.'), route.path);
      return;
    }
    if (!can(def.perm)) {
      lastPath = '';
      notice(
        T('這個角色看不到這一頁', 'This role cannot open this page'),
        T(
          '「{role}」沒有「{page}」的檢視權限。可以在上方換一個登入身分，或請系統管理員到權限矩陣開啟。',
          '“{role}” has no permission to view “{page}”. Switch identity above, or ask the system administrator to grant it in the permission matrix.',
          { role: tx(ROLE_NAME[store.prefs.role]), page: tx(def.name) },
        ),
        route.path,
      );
      return;
    }
    const mod = await def.load();
    if (mine !== token) return; // 載入期間使用者又切到別頁
    view.replaceChildren();
    if (route.path !== lastPath) window.scrollTo(0, 0);
    lastPath = route.path;
    handle = mod.mount(view, route);
    // 新頁面的程式載入完之前，畫面上還是上一頁。標上路徑，才知道現在畫面上是哪一頁。
    view.dataset.page = route.path;
  }

  on(bar, 'change', '#role-select', (_e, el) => {
    const role = (el as HTMLSelectElement).value as RoleId;
    store.setPrefs({ role });
    navigate(landingOf(role));
  });
  on(bar, 'change', '#vendor-select', (_e, el) => store.setPrefs({ vendorId: (el as HTMLSelectElement).value as VendorId }));
  on(bar, 'click', '[data-lang]', (_e, el) => store.setPrefs({ lang: el.dataset.lang as Lang }));
  on(bar, 'click', '#scenario-start', () => {
    const id = $<HTMLSelectElement>('#scenario-select', bar).value as ScenarioId;
    startScenario(id);
    toast(
      T('劇本 {id} 已啟動，資料已還原成初始狀態。按「下一步」開始。', 'Scenario {id} started and data restored to its initial state. Press “Next” to begin.', {
        id,
      }),
    );
    $('#scenario-next', bar).focus();
  });
  on(bar, 'click', '#scenario-next', () => {
    const step = nextStep();
    if (step) toast(tx(step.title));
    (bar.querySelector<HTMLElement>('#scenario-next') ?? bar.querySelector<HTMLElement>('#scenario-end'))?.focus();
  });
  on(bar, 'click', '#scenario-end', () => {
    endScenario();
    toast(
      T(
        '劇本已結束。發生過的變化會留著，要回到最初請按「還原 Demo 資料」。',
        'Scenario ended. What happened stays; press “Restore demo data” to go back to the start.',
      ),
    );
    $('#scenario-start', bar).focus();
  });
  on(bar, 'click', '#reset-btn', () => {
    openModal(
      html`<div class="modal-head"><h2>${T('還原 Demo 資料', 'Restore demo data')}</h2></div>
      <div class="modal-body"><p>${T(
        '你在這個瀏覽器做過的所有操作都會清掉，資料回到最初的樣子，進行中的劇本也會結束。登入身分與語言不變。',
        'Everything you did in this browser is cleared, the data returns to its initial state and any running scenario ends. Identity and language stay as they are.',
      )}</p></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>${T('取消', 'Cancel')}</button><button type="button" class="btn btn-primary" id="do-reset">${T('還原', 'Restore')}</button></div>`,
      (dialog, close) => {
        $('#do-reset', dialog).addEventListener('click', () => {
          store.reset();
          close();
          toast(T('已還原 Demo 資料', 'Demo data restored'));
        });
      },
    );
  });

  // 上鎖或停用的按鈕（aria-disabled）：在捕獲階段攔下點擊，改成說明原因。
  document.addEventListener(
    'click',
    (event) => {
      const locked = (event.target as Element | null)?.closest<HTMLElement>('[aria-disabled="true"]');
      if (!locked) return;
      event.preventDefault();
      event.stopPropagation();
      if (locked.dataset.why) toast(locked.dataset.why, 'warn');
    },
    true,
  );

  const snapshot = () => ({
    role: store.prefs.role,
    lang: store.prefs.lang,
    vendor: store.prefs.vendorId,
    rbac: JSON.stringify(store.state.rbac),
    clock: store.state.clock,
    scenario: JSON.stringify(store.state.scenario),
  });
  let seen = snapshot();
  store.subscribe((kind) => {
    const next = snapshot();
    const identityChanged = next.role !== seen.role || next.lang !== seen.lang || next.vendor !== seen.vendor;
    const rbacChanged = next.rbac !== seen.rbac;
    const barChanged = next.clock !== seen.clock || next.scenario !== seen.scenario;
    seen = next;
    if (kind === 'reset' || identityChanged) {
      renderBar();
      lastPath = ''; // 身分或語言換了，整頁重掛
      void show();
    } else {
      if (rbacChanged) renderSide();
      if (barChanged) renderBar();
    }
  });

  // 「跳到主要內容」：不改網址（網址的 # 已經用來做路由），直接把焦點移到內容區
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    view.focus();
  });
  onRouteChange(() => void show());
  renderBar();
  void show();
}
