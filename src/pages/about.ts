import { T, tx } from '../core/i18n';
import { APP_COMMIT, APP_VERSION } from '../core/version';
import { ORG } from '../mock/org';
import { html, setHtml } from '../ui/dom';
import type { PageHandle } from '../ui/shell';
import { facts, mark, pageHead, panel, table } from '../ui/widgets';

// 關於這個 Demo：虛構聲明、目前做到哪裡、版號、作者。
// 職缺要求的對照表會在各頁上線後補上，這裡只列已經做出來的東西。

const AUTHOR = { name: 'tboydar', profile: 'https://github.com/tboydar', repo: 'https://github.com/tboydar/fin-internal-systems-hub' };

interface Stage {
  id: string;
  what: string;
  done: boolean;
}

export function mount(root: HTMLElement): PageHandle {
  const stages: Stage[] = [
    { id: 'M1', what: T('骨架、資料模型、8 個角色、權限矩陣、自動部署', 'Skeleton, data model, 8 roles, permission matrix, automated deploy'), done: true },
    {
      id: 'M2',
      what: T('整合架構、資料一致性、劇本 A（月結前一天同步失敗）', 'Integration map, data consistency, scenario A (sync failure the day before month-end)'),
      done: false,
    },
    { id: 'M3', what: T('3D 微縮總行，與架構圖共用同一份狀態', '3D miniature head office, sharing one state with the integration map'), done: false },
    { id: 'M4', what: T('廠商管理、團隊與規範、技術路徑圖、需求與決策', 'Vendors, team and standards, roadmap, requests and decisions'), done: false },
    {
      id: 'M5',
      what: T('稽核、英文版校對、無障礙、效能、職缺要求對照表', 'Audit, English proofreading, accessibility, performance, job-requirement mapping'),
      done: false,
    },
  ];

  setHtml(
    root,
    html`<div class="page">
      ${pageHead(T('關於這個 Demo', 'About this demo'))}
      <section class="notice-box">
        <h2>${T('全部都是虛構的', 'Everything here is fictional')}</h2>
        <p class="prose">${T(
          '「{org}」不存在。站上的廠商、產品、人名、工單、金額與事件都是編出來的，沒有任何一筆來自真實的機構、公司或個人；名稱如果剛好與真實的公司或人物相同，純屬巧合。這個網站沒有後端，不會把資料送到任何地方；你的操作只存在這個瀏覽器。',
          '“{org}” does not exist. The vendors, products, people, tickets, amounts and incidents on this site are made up; none of it comes from a real institution, company or person, and any resemblance in names is coincidental. The site has no backend and sends nothing anywhere; what you do stays in this browser.',
          { org: tx(ORG.name) },
        )}</p>
      </section>
      ${panel(
        T('這是什麼', 'What this is'),
        html`<div class="panel-body"><p class="prose">${T(
          '這是應徵金融機構內部系統 Tech Lead 用的作品集。它做成一套內部工具的樣子：ERP、CRM、人事薪資與簽呈系統之間的介面、對帳、廠商與變更，用同一份資料呈現給不同的人看。上方的「登入身分」可以切換八個角色。',
          'A portfolio piece for an internal-systems Tech Lead role at a financial institution. It is built as an internal tool: interfaces, reconciliation, vendors and changes across ERP, CRM, HR & payroll and e-approval, shown from one set of data to different people. Use “Signed in as” above to switch between eight roles.',
        )}</p></div>`,
      )}
      ${panel(
        T('目前做到哪裡', 'Progress'),
        table<Stage>({
          caption: T('里程碑', 'Milestones'),
          empty: '',
          rows: stages,
          cols: [
            { head: T('里程碑', 'Milestone'), cell: (m) => html`<span class="num">${m.id}</span>`, cls: 'nowrap' },
            { head: T('內容', 'Scope'), cell: (m) => m.what, cls: 'wide' },
            {
              head: T('狀態', 'Status'),
              cell: (m) => (m.done ? mark('ok', T('已上線', 'Live')) : html`<span class="muted">${T('還沒做', 'Not built yet')}</span>`),
              cls: 'nowrap',
            },
          ],
        }),
      )}
      ${panel(
        T('版號與作者', 'Version and author'),
        html`<div class="panel-body" id="about-version">${facts([
          [T('版號', 'Version'), html`<span class="num">${APP_VERSION}</span>`],
          ['Commit', html`<span class="num">${APP_COMMIT || T('本機建置', 'local build')}</span>`],
          [
            T('版號的意思', 'What the version means'),
            T(
              '台灣日期，加上當天第幾次 CI。也寫在這個網頁的 <meta name="app-version">。',
              'Taiwan date plus the CI run count for that day. Also in this page’s <meta name="app-version">.',
            ),
          ],
          [T('作者', 'Author'), html`<a href="${AUTHOR.profile}" rel="noopener">${AUTHOR.name}</a>`],
          [T('原始碼', 'Source'), html`<a href="${AUTHOR.repo}" rel="noopener">${AUTHOR.repo.replace('https://', '')}</a>`],
        ])}</div>`,
      )}
    </div>`,
  );
  return { destroy() {} };
}
