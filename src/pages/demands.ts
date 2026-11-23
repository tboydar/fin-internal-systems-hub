import { audit, can, persona } from '../core/auth';
import { TODAY } from '../core/date';
import { DOMAIN_NAME } from '../core/derive';
import { L, T, tx } from '../core/i18n';
import { nextId } from '../core/mutations';
import { href, type Route, setQuery } from '../core/router';
import { store } from '../core/store';
import type { AppState, Decision, Demand, DemandOption, DemandStage, Domain, L10n, Risk } from '../core/types';
import type { FlowHandle, FlowSpec } from '../flow/FlowIsland';
import { $, html, nt, on, openModal, raw, type Safe, setHtml, toast } from '../ui/dom';
import { attachFlow } from '../ui/lazy';
import { canOpen, type PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, panel, personName, systemName, table, tabs, tag } from '../ui/widgets';

// 需求與決策：財務、人資、業務提需求 → 評估 → 方案比較 → 決策紀錄（誰決定、為什麼）→ 排進路徑圖。
// 上面的流程圖每一格是一個階段，數字是目前停在那個階段的需求數；點一格就篩出那些需求。

const STAGE: Record<DemandStage, L10n> = {
  submitted: L('提出', 'Submitted'),
  assessing: L('評估', 'Assessing'),
  options: L('方案比較', 'Comparing options'),
  decided: L('已決定', 'Decided'),
  scheduled: L('排進路徑圖', 'On the roadmap'),
  declined: L('不做', 'Declined'),
};
const FLOW: [DemandStage, number, number][] = [
  ['submitted', 0, 60],
  ['assessing', 230, 60],
  ['options', 460, 60],
  ['decided', 690, 60],
  ['scheduled', 920, 0],
  ['declined', 920, 130],
];
const RISK: Record<Risk, [string, string]> = { low: ['低', 'Low'], med: ['中', 'Medium'], high: ['高', 'High'] };
/** 業務單位的角色只看自己單位的需求。 */
const DEPTS: Record<string, Domain[]> = { finance: ['finance', 'procurement'], hr: ['hr'], business: ['sales'] };

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  let flow: FlowHandle | null = null;
  const actor = () => persona().person?.id ?? persona().role;
  const scope = () => DEPTS[store.prefs.role] ?? null;
  const visible = (state: AppState) => state.demands.filter((d) => !scope() || scope()?.includes(d.dept));

  setHtml(
    root,
    html`<div class="page"><div id="dm-head"></div><section class="panel" aria-label="${T('需求流程', 'Request flow')}"><div class="flow is-short" id="dm-flow"></div></section><div class="stack-lg" id="dm-body"></div></div>`,
  );

  function spec(list: Demand[], picked: string): FlowSpec {
    const count = (stage: DemandStage) => list.filter((d) => d.stage === stage).length;
    return {
      nodes: FLOW.map(([stage, x, y], i) => ({
        id: stage,
        x,
        y,
        width: 168,
        code: stage === 'scheduled' || stage === 'declined' ? undefined : String(i + 1),
        title: tx(STAGE[stage]),
        stat: T('{n} 件', '{n} requests', { n: count(stage) }),
        tone: stage === 'options' && count(stage) ? 'warn' : 'plain',
        toneLabel: stage === 'options' && count(stage) ? T('等決定', 'Awaiting decision') : undefined,
        dim: !!picked && picked !== stage,
      })),
      edges: [
        { id: 'e1', source: 'submitted', target: 'assessing' },
        { id: 'e2', source: 'assessing', target: 'options' },
        { id: 'e3', source: 'options', target: 'decided', label: T('留下決策紀錄', 'Decision record kept') },
        { id: 'e4', source: 'decided', target: 'scheduled' },
        { id: 'e5', source: 'decided', target: 'declined' },
      ],
    };
  }

  function optionsTable(demand: Demand, decision: Decision | undefined): Safe {
    return table<DemandOption>({
      id: 'option-table',
      caption: T('方案比較', 'Option comparison'),
      empty: T('還在評估，方案還沒整理出來。', 'Still being assessed; the options are not written up yet.'),
      rows: demand.options,
      cols: [
        {
          head: T('方案', 'Option'),
          cell: (o) =>
            html`<b class="num">${o.key}</b> ${tx(o.title)}${decision?.chosen.zh.includes(`方案 ${o.key}`) ? html` ${tag(T('選了這個', 'Chosen'), 'primary')}` : ''}`,
          cls: 'wide',
        },
        { head: T('成本', 'Cost'), cell: (o) => (o.cost ? nt(o.cost) : T('不花錢', 'No cost')), cls: 'num' },
        { head: T('時程', 'Time'), cell: (o) => (o.weeks ? T('{n} 週', '{n} weeks', { n: o.weeks }) : T('維持現況', 'As is')), cls: 'num' },
        {
          head: T('風險', 'Risk'),
          cell: (o) => mark(o.risk === 'high' ? 'crit' : o.risk === 'med' ? 'warn' : 'ok', T(RISK[o.risk][0], RISK[o.risk][1])),
          cls: 'nowrap',
        },
        { head: T('說明', 'Note'), cell: (o) => tx(o.note), cls: 'wide' },
      ],
    });
  }

  function detail(state: AppState, demand: Demand): Safe {
    const decision = state.decisions.find((d) => d.id === demand.decisionId);
    const item = state.roadmap.find((r) => r.id === demand.roadmapId);
    return panel(
      `${demand.id} ${tx(demand.title)}`,
      html`<div class="panel-body stack" id="demand-detail">
        ${facts([
          [T('為什麼提', 'Why it was raised'), tx(demand.summary)],
          [
            T('提出', 'Raised by'),
            `${personName(state, demand.requesterId)}${T('，', ', ')}${tx(DOMAIN_NAME[demand.dept])}${T('，', ', ')}${demand.createdAt}`,
          ],
          [
            T('牽涉的系統', 'Systems involved'),
            demand.systemIds.map((id) => (can('iface.detail') ? systemName(state, id) : tx(state.systems.find((s) => s.id === id)?.plain))).join(T('、', ', ')),
          ],
          [T('現在在哪一步', 'Current stage'), tx(STAGE[demand.stage])],
          ...(item
            ? [
                [
                  T('路徑圖項目', 'Roadmap item'),
                  canOpen('/roadmap') ? html`<a href="${href('/roadmap', { item: item.id })}">${item.id}</a> ${tx(item.plain)}` : tx(item.plain),
                ] as [string, Safe | string],
              ]
            : []),
        ])}
        <h3>${T('方案比較', 'Option comparison')}</h3>
        ${optionsTable(demand, decision)}
        ${
          decision
            ? html`<h3>${T('決策紀錄', 'Decision record')}</h3>${facts([
                [T('編號', 'ID'), html`<span class="num">${decision.id}</span>`],
                [T('誰決定', 'Decided by'), `${personName(state, decision.decidedBy)}${T('，', ', ')}${decision.date}`],
                [T('決定', 'Decision'), tx(decision.chosen)],
                [T('為什麼', 'Why'), tx(decision.why)],
              ])}`
            : demand.stage === 'options'
              ? html`<div class="callout is-warn"><p>${T('方案整理好了，等決定。決定時要寫原因，會留在決策紀錄裡。', 'The options are ready and await a decision. A reason is required and is kept in the decision record.')}</p>
                  ${actionBtn({ act: 'decide', label: T('做決定', 'Decide'), perm: 'decision.write', primary: true, data: { req: demand.id } })}</div>`
              : ''
        }
      </div>`,
      { id: 'demand-panel', actions: html`<a class="btn btn-sm" href="${href('/demands')}" data-fk="close-req">${T('關閉', 'Close')}</a>` },
    );
  }

  function render(): void {
    const state = store.state;
    const list = visible(state);
    const stage = route.query.get('stage') ?? '';
    const tab = route.query.get('tab') === 'decisions' ? 'decisions' : 'list';
    const picked = list.find((d) => d.id === route.query.get('req'));
    const shown = stage ? list.filter((d) => d.stage === stage) : list;
    const waiting = list.filter((d) => d.stage === 'options').length;
    const decisions = state.decisions
      .filter((d) => !scope() || !d.demandId || list.some((x) => x.id === d.demandId))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    setHtml(
      $('#dm-head', root),
      pageHead(
        T('需求與決策', 'Requests & decisions'),
        T('{n} 件需求，{w} 件等決定。', '{n} requests, {w} awaiting a decision.', { n: list.length, w: waiting }),
        actionBtn({ act: 'new', label: T('提出需求', 'Submit a request'), perm: 'demand.create', primary: true }),
      ),
    );

    const next = spec(list, stage);
    if (flow) flow.update(next, stage || null);
    else
      flow = attachFlow($('#dm-flow', root), next, {
        layoutKey: 'demands',
        selected: stage || null,
        onNodeClick: (id) => setQuery({ stage: id === (route.query.get('stage') ?? '') ? null : id, tab: null }),
      });

    const requests = table<Demand>({
      id: 'demand-table',
      caption: T('需求清單', 'Requests'),
      empty: stage
        ? T('目前沒有需求停在「{s}」。', 'No request is at “{s}” right now.', { s: tx(STAGE[stage as DemandStage]) })
        : T('還沒有人提過需求。', 'Nobody has submitted a request yet.'),
      rows: shown,
      rowAttrs: (d) => html` class="${d.id === picked?.id ? 'is-selected' : ''}"`,
      cols: [
        {
          head: T('階段', 'Stage'),
          cell: (d) => tag(tx(STAGE[d.stage]), d.stage === 'options' ? 'warn' : d.stage === 'scheduled' || d.stage === 'decided' ? 'ok' : 'plain'),
          cls: 'nowrap',
        },
        {
          head: T('編號', 'ID'),
          cell: (d) => html`<a class="num" href="${href('/demands', { ...(stage ? { stage } : {}), req: d.id })}" data-fk="req:${d.id}">${d.id}</a>`,
          cls: 'nowrap',
        },
        { head: T('需求', 'Request'), cell: (d) => tx(d.title), cls: 'wide' },
        { head: T('單位', 'Unit'), cell: (d) => tx(DOMAIN_NAME[d.dept]), cls: 'nowrap' },
        { head: T('提出人', 'Raised by'), cell: (d) => personName(state, d.requesterId), cls: 'nowrap' },
        { head: T('提出日', 'Raised on'), cell: (d) => html`<span class="num">${d.createdAt}</span>`, cls: 'nowrap' },
        { head: T('方案數', 'Options'), cell: (d) => d.options.length || '–', cls: 'num' },
        { head: T('決策紀錄', 'Decision'), cell: (d) => (d.decisionId ? html`<span class="num">${d.decisionId}</span>` : '–'), cls: 'nowrap' },
      ],
    });

    const log = table<Decision>({
      id: 'decision-table',
      caption: T('決策紀錄', 'Decision records'),
      empty: T('還沒有決策紀錄。', 'No decision records yet.'),
      rows: decisions,
      cols: [
        { head: T('編號', 'ID'), cell: (d) => html`<span class="num">${d.id}</span>`, cls: 'nowrap' },
        { head: T('日期', 'Date'), cell: (d) => html`<span class="num">${d.date}</span>`, cls: 'nowrap' },
        { head: T('誰決定', 'Decided by'), cell: (d) => personName(state, d.decidedBy), cls: 'nowrap' },
        { head: T('決定了什麼', 'What was decided'), cell: (d) => html`<b>${tx(d.title)}</b><br />${tx(d.chosen)}`, cls: 'wide' },
        { head: T('為什麼', 'Why'), cell: (d) => tx(d.why), cls: 'wide' },
        { head: T('來源', 'Origin'), cell: (d) => html`<span class="num">${d.demandId ?? d.crId ?? d.incidentId ?? '–'}</span>`, cls: 'nowrap' },
      ],
    });

    setHtml(
      $('#dm-body', root),
      html`<section class="panel">${tabs(
        [
          {
            id: 'list',
            label: stage ? T('需求：{s}', 'Requests: {s}', { s: tx(STAGE[stage as DemandStage]) }) : T('全部需求', 'All requests'),
            count: shown.length,
          },
          { id: 'decisions', label: T('決策紀錄', 'Decision records'), count: decisions.length },
        ],
        tab,
      )}${stage && tab === 'list' ? html`<p class="panel-body hint"><a href="${href('/demands')}" data-fk="clear-stage">${T('看全部需求', 'Show all requests')}</a></p>` : ''}${tab === 'decisions' ? log : requests}</section>
      ${picked && tab === 'list' ? detail(state, picked) : ''}`,
    );
  }

  const offs = [
    on(root, 'click', '[data-tab]', (_e, el) => setQuery({ tab: el.dataset.tab === 'decisions' ? 'decisions' : null, req: null })),
    on(root, 'click', '[data-act="new"]', () => {
      openModal(
        html`<div class="modal-head"><h2>${T('提出需求', 'Submit a request')}</h2></div>
        <div class="modal-body stack">
          <div class="form-row"><label for="new-title">${T('想要什麼（一句話）', 'What you need (one sentence)')}</label><input id="new-title" type="text" maxlength="60" /></div>
          <div class="form-row"><label for="new-why">${T('現在的問題是什麼', 'What the problem is today')}</label><textarea id="new-why" rows="3"></textarea></div>
          <p class="hint">${T('送出後會進到「提出」階段，資訊處評估後會回覆方案。資料只存在這個瀏覽器。', 'It enters the “Submitted” stage; IT replies with options after assessing it. Stored in this browser only.')}</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-close>${T('取消', 'Cancel')}</button><button type="button" class="btn btn-primary" id="do-new">${T('送出', 'Submit')}</button></div>`,
        (dialog, close) => {
          $('#do-new', dialog).addEventListener('click', () => {
            const title = $<HTMLInputElement>('#new-title', dialog).value.trim();
            const why = $<HTMLTextAreaElement>('#new-why', dialog).value.trim();
            if (!title || !why) {
              toast(T('兩欄都要寫，資訊處才知道要解決什麼', 'Fill in both so IT knows what to solve'), 'warn');
              (title ? $('#new-why', dialog) : $('#new-title', dialog)).focus();
              return;
            }
            let id = '';
            store.update((s) => {
              const dept = scope()?.[0] ?? 'finance';
              id = nextId(s.demands, 'REQ-');
              s.demands.unshift({
                id,
                title: { zh: title, en: title },
                dept,
                requesterId: actor(),
                createdAt: TODAY,
                stage: 'submitted',
                systemIds: [],
                summary: { zh: why, en: why },
                options: [],
              });
              audit(s, L('提出需求', 'Submitted request'), id, { zh: title, en: title });
            });
            close();
            toast(T('已送出 {id}', '{id} submitted', { id }));
            setQuery({ req: id, stage: null, tab: null });
          });
        },
      );
    }),
    on(root, 'click', '[data-act="decide"]', (_e, el) => {
      const demand = store.state.demands.find((d) => d.id === el.dataset.req);
      if (!demand) return;
      openModal(
        html`<div class="modal-head"><h2>${T('決定：{id}', 'Decide {id}', { id: demand.id })}</h2></div>
        <div class="modal-body stack">
          <fieldset class="stack"><legend>${T('選哪一個方案', 'Which option')}</legend>${demand.options.map(
            (o, i) =>
              html`<label class="check"><input type="radio" name="opt" value="${o.key}" ${i === 0 ? raw('checked') : ''} /> <b class="num">${o.key}</b> ${tx(o.title)}</label>`,
          )}</fieldset>
          <div class="form-row"><label for="decide-why">${T('為什麼（必填，會寫進決策紀錄）', 'Why (required; goes into the decision record)')}</label><textarea id="decide-why" rows="4"></textarea></div>
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-close>${T('取消', 'Cancel')}</button><button type="button" class="btn btn-primary" id="do-decide">${T('記下這個決定', 'Record this decision')}</button></div>`,
        (dialog, close) => {
          $('#do-decide', dialog).addEventListener('click', () => {
            const why = $<HTMLTextAreaElement>('#decide-why', dialog).value.trim();
            const key = dialog.querySelector<HTMLInputElement>('input[name="opt"]:checked')?.value ?? '';
            const option = demand.options.find((o) => o.key === key);
            if (!why || !option) {
              toast(
                T('請寫原因。沒有原因的決定，三個月後沒有人記得為什麼', 'Write the reason. A decision without one is a mystery three months later'),
                'warn',
              );
              $('#decide-why', dialog).focus();
              return;
            }
            store.update((s) => {
              const target = s.demands.find((d) => d.id === demand.id);
              if (!target) return;
              const id = nextId(s.decisions, 'DEC-');
              s.decisions.push({
                id,
                title: target.title,
                date: TODAY,
                decidedBy: actor(),
                chosen: L(`方案 ${option.key}：${option.title.zh}`, `Option ${option.key}: ${option.title.en}`),
                why: { zh: why, en: why },
                demandId: target.id,
              });
              target.stage = 'decided';
              target.decisionId = id;
              audit(s, L('寫決策紀錄', 'Wrote decision record'), id, L(`${target.id} 選方案 ${option.key}`, `${target.id}: option ${option.key}`));
            });
            close();
            toast(T('已記下決定', 'Decision recorded'));
          });
        },
      );
    }),
    store.subscribe(() => render()),
  ];
  render();
  return {
    destroy() {
      for (const off of offs) off();
      flow?.destroy();
    },
    route(next) {
      route = next;
      render();
    },
  };
}
