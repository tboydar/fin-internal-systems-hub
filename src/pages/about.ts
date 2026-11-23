import { T, tx } from '../core/i18n';
import { href } from '../core/router';
import { store } from '../core/store';
import { APP_COMMIT, APP_VERSION } from '../core/version';
import { ORG } from '../mock/org';
import { html, type Safe, setHtml } from '../ui/dom';
import { canOpen, PAGES, type PageHandle } from '../ui/shell';
import { facts, pageHead, panel, table } from '../ui/widgets';

// 關於這個 Demo：職缺要求對照表、三分鐘看什麼、虛構聲明、技術說明、版號與作者。

const AUTHOR = { name: 'tboydar', profile: 'https://github.com/tboydar', repo: 'https://github.com/tboydar/fin-internal-systems-hub' };

interface Row {
  need: string;
  where: [path: string, query?: Record<string, string>][];
  how: string;
}

export function mount(root: HTMLElement): PageHandle {
  const pageName = (path: string) => tx(PAGES.find((p) => p.path === path)?.name);
  const links = (where: Row['where']): Safe =>
    html`${where.map(([path, query], i) => html`${i ? T('、', ', ') : ''}${canOpen(path) ? html`<a href="${href(path, query)}">${pageName(path)}</a>` : html`<span title="${T('目前登入的角色看不到這一頁', 'The current role cannot open this page')}">${pageName(path)}</span>`}`)}`;

  function render(): void {
    const rows: Row[] = [
      {
        need: T('帶領內部工程師與委外夥伴、訂技術標準', 'Lead internal engineers and outsourced partners; set technical standards'),
        where: [['/team'], ['/team', { tab: 'docs' }]],
        how: T(
          '負載由任務算出，改派立刻反映。技能矩陣標出只剩一個人會的系統。開發規範、API 原則、錯誤碼、Runbook 都有負責人與下次檢視日。',
          'Load is computed from tasks and reflects a reassignment at once. The skill matrix flags systems only one person knows. Standards, API principles, error codes and runbooks each have an owner and a next review date.',
        ),
      },
      {
        need: T('知識傳承與技術文件庫', 'Knowledge transfer and a technical document library'),
        where: [
          ['/team', { tab: 'docs' }],
          ['/team', { tab: 'adr' }],
          ['/team', { tab: 'onboarding' }],
        ],
        how: T(
          '15 份文件裡有 5 份過期，畫面上照實標出來。ADR 記下背景、決定與代價。新人上手路徑一天一步，連到要讀的文件。',
          '5 of the 15 documents are overdue for review and are shown as such. ADRs record context, decision and consequences. The onboarding path is one step a day, each linked to what to read.',
        ),
      },
      {
        need: T('年度技術路徑圖', 'Annual technology roadmap'),
        where: [
          ['/roadmap', { view: 'eng' }],
          ['/roadmap', { view: 'finance' }],
        ],
        how: T(
          '同一批項目有工程版（相依、人月、做法）與財務版（預算、影響到誰）。凍結期由日曆算出，避開國定假日。',
          'The same items come in an engineering version (dependencies, person-months, approach) and a finance version (budget, who is affected). Freezes are computed from the calendar and respect national holidays.',
        ),
      },
      {
        need: T('整合架構：資料流、API 管理、錯誤處理', 'Integration architecture: data flow, API management, error handling'),
        where: [['/integration'], ['/integration', { tab: 'apis' }]],
        how: T(
          '9 個系統、24 條介面的拓撲圖。每條介面有欄位對應、重試與 DLQ、補償做法、對帳規則。API 目錄有版本與停用日。',
          'A topology of 9 systems and 24 interfaces. Each interface has its field mapping, retry and DLQ policy, compensation and reconciliation rule. The API catalogue carries versions and sunset dates.',
        ),
      },
      {
        need: T('SQL 與跨系統資料一致性', 'SQL and cross-system data consistency'),
        where: [['/consistency'], ['/consistency', { rule: 'RC-05' }]],
        how: T(
          '10 條對帳規則都看得到 SQL，差異可以點到每一筆。RC-05 附查詢優化前後的執行計畫與加的索引。',
          'All 10 reconciliation rules show their SQL and every difference can be opened. RC-05 comes with the query plan before and after tuning and the indexes added.',
        ),
      },
      {
        need: T('廠商管理：責任邊界、SLA、交付品質', 'Vendor management: responsibility boundary, SLA, delivery quality'),
        where: [['/vendors'], ['/vendors', { tab: 'raci' }], ['/vendors', { tab: 'penalty' }]],
        how: T(
          'SLA 達成率由工單算出，後面跟著幾張裡的幾張。有 RACI、合約里程碑、變更請求流程與計罰試算。廠商 PM 只看得到自家。',
          'SLA attainment is computed from tickets and shown with its numerator and denominator. There is a RACI, contract milestones, a change-request flow and a penalty estimate. A vendor PM sees only their own company.',
        ),
      },
      {
        need: T('與財務、人資、業務單位對接', 'Working with Finance, HR and business units'),
        where: [['/demands'], ['/overview']],
        how: T(
          '需求走提出、評估、方案比較、決策紀錄。切換上方的登入身分：同一件事，財務、人資、業務看到的是各自聽得懂的說法。',
          'Requests go through submission, assessment, option comparison and a decision record. Switch identity above: the same event is described to Finance, HR and business units in their own terms.',
        ),
      },
      {
        need: T('職缺沒寫但我會做的', 'Not in the job description, but I would do it'),
        where: [['/incidents'], ['/rbac'], ['/overview', { at: 'twin' }]],
        how: T(
          '事件檢討與變更把關（凍結期、不可逆變更的清單）。權限矩陣加職責分離檢查與稽核軌跡。3D 總行可以注入故障，看哪幾層樓受影響。',
          'Incident reviews and change gates (freezes, a checklist for irreversible changes). A permission matrix with a segregation-of-duties check and an audit trail. A 3D head office where you can inject a fault and see which floors are affected.',
        ),
      },
    ];

    const tour: [string, string, string, Record<string, string>?][] = [
      [
        T('看總覽', 'Read the overview'),
        T('上面四個數字都點得進去；中間是 3D 總行。', 'The four numbers at the top all lead somewhere; the 3D head office sits in the middle.'),
        '/overview',
      ],
      [
        T('啟動劇本 A，按五次「下一步」', 'Start scenario A and press “Next” five times'),
        T(
          '在最上面的 Demo 控制列。月結前一天，員工主檔同步失敗。',
          'In the demo control bar at the very top. The day before month-end, the employee master sync fails.',
        ),
        '/overview',
      ],
      [
        T('換成「財務主管」，再換成「人資主管」', 'Switch to Finance manager, then HR manager'),
        T('同一件事，換了說法，而且沒有技術名詞。', 'The same event in different words, with no technical terms.'),
        '/overview',
      ],
      [
        T('換回 Tech Lead，到整合架構按「重送 37 筆」', 'Back as Tech Lead, press “Resend 37 records” on the integration page'),
        T('劇本會跟著往前走；對帳差異歸零。', 'The scenario moves on with you; the reconciliation differences return to zero.'),
        '/integration',
        { iface: 'INT-014' },
      ],
      [
        T('看一條對帳規則的 SQL 與執行計畫', 'Read the SQL and query plans of a reconciliation rule'),
        T('RC-05：18 秒變 142 毫秒。', 'RC-05: from 18 s to 142 ms.'),
        '/consistency',
        { rule: 'RC-05' },
      ],
      [
        T('看廠商', 'Look at the vendors'),
        T('一家表現好、一家普通。數字後面都有分子與分母。', 'One does well, one is middling. Every figure shows its numerator and denominator.'),
        '/vendors',
        { vendor: 'v-crm' },
      ],
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
          T('職缺要求在哪一頁、怎麼呈現', 'Where each job requirement is shown, and how'),
          table<Row>({
            id: 'map-table',
            caption: T('職缺要求對照表', 'Job requirement mapping'),
            empty: '',
            rows,
            cols: [
              { head: T('職缺要求', 'Requirement'), cell: (r) => html`<b>${r.need}</b>` },
              { head: T('在哪一頁', 'Where'), cell: (r) => links(r.where), cls: 'nowrap' },
              { head: T('怎麼呈現', 'How it is shown'), cell: (r) => r.how, cls: 'wide' },
            ],
          }),
          { note: T('這是一份作品集：應徵金融機構內部系統 Tech Lead', 'A portfolio piece for an internal-systems Tech Lead role at a financial institution') },
        )}
        ${panel(
          T('只有三分鐘的話', 'If you only have three minutes'),
          html`<ol class="path" id="tour">${tour.map(
            ([what, why, path, query], i) =>
              html`<li><b>${i + 1}</b><span>${what}</span><span class="path-docs"><span class="muted">${why}</span>${canOpen(path) ? html`<a class="btn btn-sm" href="${href(path, query)}">${T('打開', 'Open')}</a>` : ''}</span></li>`,
          )}</ol>`,
        )}
        ${panel(
          T('怎麼做的', 'How it is built'),
          html`<div class="panel-body">${facts([
            [
              T('沒有後端', 'No backend'),
              T(
                '純靜態網站。資料由固定種子產生，每次建置結果相同；你的操作存在 localStorage，可以一鍵還原。',
                'A static site. Data is generated from a fixed seed, identical on every build; your actions live in localStorage and can be restored in one click.',
              ),
            ],
            [
              T('首屏很輕', 'Light first load'),
              T(
                '介面是原生 TypeScript。流程圖（xyflow）與 3D（three）各自一包，進到那一頁才下載；CI 會檢查它們沒有混進首屏。',
                'The interface is plain TypeScript. The diagrams (xyflow) and the 3D scene (three) are separate chunks fetched only on the pages that use them; CI checks they stay out of the first load.',
              ),
            ],
            [
              T('一份狀態', 'One state'),
              T(
                '所有頁面與 3D 場景讀同一份狀態。劇本只是一串改這份狀態的步驟。',
                'Every page and the 3D scene read one state. A scenario is just a series of steps that change it.',
              ),
            ],
            [
              T('數字不是寫死的', 'No hard-coded figures'),
              T(
                'SLA 達成率來自工單，負載來自任務，倒數來自日曆。有測試守著「畫面上的數字等於來源的列數」。',
                'SLA attainment comes from tickets, load from tasks, countdowns from the calendar. Tests guard that every figure on screen equals the number of rows behind it.',
              ),
            ],
            [
              T('文字', 'Text'),
              T(
                '各角色看到的句子由規則從資料組出來，不是語言模型寫的。這個網站不呼叫任何模型。',
                'The lines each role sees are composed by rules from the data, not written by a language model. The site calls no model.',
              ),
            ],
          ])}</div>`,
        )}
        ${panel(
          T('版號與作者', 'Version and author'),
          html`<div class="panel-body" id="about-version">${facts([
            [T('版號', 'Version'), html`<span class="num">${APP_VERSION}</span>`],
            ['Commit', html`<span class="num">${APP_COMMIT || T('本機建置', 'local build')}</span>`],
            [
              T('版號的意思', 'What the version means'),
              T(
                '台灣日期，加上當天第幾次 CI；每個 commit 加一。也寫在這個網頁的 <meta name="app-version">。',
                'Taiwan date plus the CI run count for that day; each commit adds one. Also in this page’s <meta name="app-version">.',
              ),
            ],
            [T('作者', 'Author'), html`<a href="${AUTHOR.profile}" rel="noopener">${AUTHOR.name}</a>`],
            [T('原始碼', 'Source'), html`<a href="${AUTHOR.repo}" rel="noopener">${AUTHOR.repo.replace('https://', '')}</a>`],
          ])}</div>`,
        )}
      </div>`,
    );
  }

  const off = store.subscribe((kind) => {
    if (kind !== 'state') render();
  });
  render();
  return { destroy: off };
}
