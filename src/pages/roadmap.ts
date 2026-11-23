import { audit, can } from '../core/auth';
import { freezes } from '../core/derive';
import { L, T, tx } from '../core/i18n';
import { href, type Route, setQuery } from '../core/router';
import { store } from '../core/store';
import type { AppState, Risk, RoadmapItem } from '../core/types';
import { html, nt, num, on, type Safe, setHtml, toast } from '../ui/dom';
import { canOpen, type PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, panel, systemName, table, tag } from '../ui/widgets';

// 技術路徑圖：2027 年四季的項目、相依、預算、人月與風險，並標出月結與年結的凍結期。
// 同一批項目有兩種看法：財務版講的是哪個作業會變怎樣、花多少錢；工程版講的是相依、人月與做法。

const YEAR = 2027;
const MONTHS = Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, '0')}`);
const RISK: Record<Risk, [string, string]> = { low: ['低', 'Low'], med: ['中', 'Medium'], high: ['高', 'High'] };
const STATUS: Record<RoadmapItem['status'], [string, string]> = {
  committed: ['已承諾', 'Committed'],
  planned: ['規劃中', 'Planned'],
  proposed: ['提案', 'Proposed'],
};
const quarterOf = (month: string) => Math.ceil(Number(month.slice(5, 7)) / 3);

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  const two = (pair: [string, string]) => T(pair[0], pair[1]);
  const risk = (r: Risk) => mark(r === 'high' ? 'crit' : r === 'med' ? 'warn' : 'ok', two(RISK[r]));

  function gantt(state: AppState, finance: boolean, picked: string | null): Safe {
    const windows = freezes(MONTHS[0], MONTHS[11]);
    const freezeOf = (month: string) => windows.filter((f) => f.start.slice(0, 7) === month || (f.kind === 'yearEnd' && f.start.slice(0, 7) === month));
    return html`<div class="table-wrap" tabindex="0" role="group" aria-label="${T('{y} 年路徑圖', '{y} roadmap', { y: YEAR })}"><table class="table gantt" id="gantt">
      <thead>
        <tr><th scope="col" rowspan="2">${T('項目', 'Item')}</th>${[1, 2, 3, 4].map((qtr) => html`<th scope="colgroup" colspan="3" class="q">${YEAR} Q${qtr}</th>`)}</tr>
        <tr>${MONTHS.map((m) => html`<th scope="col" class="m num">${Number(m.slice(5))}</th>`)}</tr>
      </thead>
      <tbody>
        <tr class="freeze"><th scope="row">${T('凍結期（不排一般變更）', 'Freezes (no normal changes)')}</th>${MONTHS.map(
          (m) =>
            html`<td class="m">${freezeOf(m).map((f) => html`<span class="fz ${f.kind === 'yearEnd' ? 'is-year' : ''}" title="${tx(f.name)}">${f.start.slice(5).replace('-', '/')}–${f.end.slice(5).replace('-', '/')}</span>`)}</td>`,
        )}</tr>
        ${state.roadmap.map((item) => {
          const from = MONTHS.indexOf(item.start);
          const to = MONTHS.indexOf(item.end);
          return html`<tr class="${item.id === picked ? 'is-selected' : ''}"><th scope="row"><a href="${href('/roadmap', { ...Object.fromEntries(route.query), item: item.id })}" data-fk="rm:${item.id}">${finance ? '' : html`<span class="num">${item.id}</span> `}${tx(finance ? item.plain : item.title)}</a></th>${MONTHS.map(
            (_m, i) =>
              html`<td class="m">${i >= from && i <= to ? html`<span class="bar-cell is-${item.status} risk-${item.risk}" title="${two(STATUS[item.status])}">${i === from ? two(STATUS[item.status]) : ''}</span>` : ''}</td>`,
          )}</tr>`;
        })}
      </tbody></table></div>`;
  }

  function detail(state: AppState, item: RoadmapItem, finance: boolean): Safe {
    const blocks = state.roadmap.filter((r) => r.dependsOn.includes(item.id));
    const src = item.sourceId;
    const srcLink = !src
      ? null
      : src.startsWith('INC') && canOpen('/incidents')
        ? href('/incidents', { inc: src })
        : src.startsWith('DEC') && canOpen('/demands')
          ? href('/demands', { tab: 'decisions' })
          : null;
    return panel(
      finance ? tx(item.plain) : `${item.id} ${tx(item.title)}`,
      html`<div class="panel-body stack" id="item-detail">${facts([
        [T('期間', 'Period'), html`<span class="num">${item.start} – ${item.end}</span>${T('（Q{q}）', ' (Q{q})', { q: quarterOf(item.start) })}`],
        [T('狀態', 'Status'), two(STATUS[item.status])],
        [T('預算', 'Budget'), html`<span class="num">${item.budget ? nt(item.budget) : T('不另編預算', 'No separate budget')}</span>`],
        [T('對誰有影響', 'Who is affected'), tx(item.value)],
        [T('風險', 'Risk'), html`${risk(item.risk)} ${tx(item.riskNote)}`],
        ...(finance
          ? []
          : ([
              [T('做法', 'Approach'), tx(item.tech)],
              [
                T('人月', 'Person-months'),
                html`<span class="num">${T('內部 {i}、委外 {v}', 'internal {i}, vendor {v}', { i: item.internalPm, v: item.vendorPm })}</span>`,
              ],
              [T('系統', 'Systems'), item.systemIds.map((id) => systemName(state, id)).join(T('、', ', '))],
              [
                T('要先完成', 'Depends on'),
                item.dependsOn.length
                  ? html`${item.dependsOn.map((id, i) => html`${i ? T('、', ', ') : ''}<a class="num" href="${href('/roadmap', { item: id })}">${id}</a>`)}`
                  : T('沒有', 'None'),
              ],
              [
                T('擋住誰', 'Blocks'),
                blocks.length
                  ? html`${blocks.map((b, i) => html`${i ? T('、', ', ') : ''}<a class="num" href="${href('/roadmap', { item: b.id })}">${b.id}</a>`)}`
                  : T('沒有', 'None'),
              ],
              [
                T('從哪裡來', 'Origin'),
                src ? (srcLink ? html`<a class="num" href="${srcLink}">${src}</a>` : html`<span class="num">${src}</span>`) : T('年度規劃', 'Annual planning'),
              ],
            ] as [string, Safe | string][])),
      ])}
      ${item.status === 'proposed' ? html`<div class="callout"><p>${T('這是提案，還沒排進承諾的範圍。', 'This is a proposal and not yet part of the committed scope.')}</p>${actionBtn({ act: 'commit', label: T('列入承諾', 'Commit to it'), perm: 'roadmap.edit', primary: true, data: { item: item.id } })}</div>` : ''}
      </div>`,
      {
        id: 'item-panel',
        actions: html`<a class="btn btn-sm" href="${href('/roadmap', route.query.get('view') ? { view: route.query.get('view') ?? '' } : undefined)}" data-fk="close-item">${T('關閉', 'Close')}</a>`,
      },
    );
  }

  function render(): void {
    const state = store.state;
    const view = route.query.get('view') ?? (can('iface.detail') ? 'eng' : 'finance');
    const finance = view !== 'eng';
    const picked = state.roadmap.find((r) => r.id === route.query.get('item'));
    const budget = state.roadmap.reduce((sum, r) => sum + r.budget, 0);
    const internal = state.roadmap.reduce((sum, r) => sum + r.internalPm, 0);
    const vendor = state.roadmap.reduce((sum, r) => sum + r.vendorPm, 0);
    const quarters = [1, 2, 3, 4].map((qtr) => {
      const items = state.roadmap.filter((r) => quarterOf(r.start) === qtr);
      return {
        qtr,
        items,
        budget: items.reduce((s, r) => s + r.budget, 0),
        internal: items.reduce((s, r) => s + r.internalPm, 0),
        vendor: items.reduce((s, r) => s + r.vendorPm, 0),
      };
    });

    const list = table<RoadmapItem>({
      id: 'roadmap-table',
      caption: T('路徑圖項目', 'Roadmap items'),
      empty: T('路徑圖是空的。', 'The roadmap is empty.'),
      rows: state.roadmap,
      rowAttrs: (r) => html` class="${r.id === picked?.id ? 'is-selected' : ''}"`,
      cols: finance
        ? [
            { head: T('項目', 'Item'), cell: (r) => tx(r.plain), cls: 'wide' },
            {
              head: T('期間', 'Period'),
              cell: (r) => html`<span class="num">Q${quarterOf(r.start)} ${r.start.slice(5)}–${r.end.slice(5)}</span>`,
              cls: 'nowrap',
            },
            { head: T('預算', 'Budget'), cell: (r) => (r.budget ? nt(r.budget) : '–'), cls: 'num' },
            { head: T('對誰有影響', 'Who is affected'), cell: (r) => tx(r.value), cls: 'wide' },
            { head: T('風險', 'Risk'), cell: (r) => risk(r.risk), cls: 'nowrap' },
            { head: T('狀態', 'Status'), cell: (r) => tag(two(STATUS[r.status]), r.status === 'committed' ? 'primary' : 'plain'), cls: 'nowrap' },
          ]
        : [
            { head: T('編號', 'ID'), cell: (r) => html`<span class="num">${r.id}</span>`, cls: 'nowrap' },
            { head: T('項目', 'Item'), cell: (r) => tx(r.title), cls: 'wide' },
            { head: T('期間', 'Period'), cell: (r) => html`<span class="num">${r.start.slice(5)}–${r.end.slice(5)}</span>`, cls: 'nowrap' },
            { head: T('要先完成', 'Depends on'), cell: (r) => html`<span class="num">${r.dependsOn.join(T('、', ', ')) || '–'}</span>`, cls: 'nowrap' },
            { head: T('內部人月', 'Internal PM'), cell: (r) => r.internalPm, cls: 'num' },
            { head: T('委外人月', 'Vendor PM'), cell: (r) => r.vendorPm, cls: 'num' },
            { head: T('風險', 'Risk'), cell: (r) => html`${risk(r.risk)} <span class="muted">${tx(r.riskNote)}</span>`, cls: 'wide' },
            { head: T('狀態', 'Status'), cell: (r) => tag(two(STATUS[r.status]), r.status === 'committed' ? 'primary' : 'plain'), cls: 'nowrap' },
          ],
    });

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(
          T('技術路徑圖', 'Technology roadmap'),
          T('{y} 年 {n} 個項目，預算 {b}，內部 {i} 人月、委外 {v} 人月。', '{n} items in {y}: budget {b}, {i} internal and {v} vendor person-months.', {
            y: YEAR,
            n: state.roadmap.length,
            b: nt(budget),
            i: internal,
            v: vendor,
          }),
          html`<span class="seg" role="group" aria-label="${T('版本', 'Version')}">
            <a class="seg-a" href="${href('/roadmap', { view: 'finance' })}" aria-pressed="${String(finance)}" data-fk="view-finance">${T('財務看的版本', 'Finance version')}</a>
            <a class="seg-a" href="${href('/roadmap', { view: 'eng' })}" aria-pressed="${String(!finance)}" data-fk="view-eng">${T('工程看的版本', 'Engineering version')}</a>
          </span>`,
        )}
        <div class="stat-row" id="quarters">${quarters.map(
          (
            x,
          ) => html`<div class="stat"><span class="stat-k">${YEAR} Q${x.qtr}</span><span class="stat-v num">${finance ? nt(x.budget) : T('{i} + {v} 人月', '{i} + {v} PM', { i: x.internal, v: x.vendor })}</span>
            <span class="stat-n">${finance ? T('{n} 個項目', '{n} items', { n: x.items.length }) : T('{n} 個項目；內部 + 委外', '{n} items; internal + vendor', { n: x.items.length })}</span></div>`,
        )}</div>
        ${panel(T('時程', 'Timeline'), gantt(state, finance, picked?.id ?? null), { note: T('每個月的月結凍結期是月結日前一個工作日到次月關帳日；年底另有年結凍結', 'Each month-end freeze runs from the working day before month-end to the next closing day; a year-end freeze is added in December') })}
        ${picked ? detail(state, picked, finance) : ''}
        ${panel(finance ? T('每個項目花多少、影響誰', 'What each item costs and whom it affects') : T('相依、人月與風險', 'Dependencies, person-months and risk'), list, { note: T('合計 {b}', 'Total {b}', { b: finance ? nt(budget) : `${num(internal + vendor)} PM` }) })}
      </div>`,
    );
  }

  const offs = [
    on(root, 'click', '[data-act="commit"]', (_e, el) => {
      store.update((s) => {
        const item = s.roadmap.find((r) => r.id === el.dataset.item);
        if (!item) return;
        item.status = 'committed';
        audit(s, L('路徑圖項目列入承諾', 'Committed roadmap item'), item.id, item.title);
      });
      toast(T('已列入承諾', 'Committed'));
    }),
    on(root, 'click', '#roadmap-table tbody tr', (_e, el) => {
      const index = [...(el.parentElement?.children ?? [])].indexOf(el);
      const item = store.state.roadmap[index];
      if (item) setQuery({ item: item.id });
    }),
    store.subscribe(() => render()),
  ];
  render();
  return {
    destroy() {
      for (const off of offs) off();
    },
    route(next) {
      route = next;
      render();
    },
  };
}
