import { audit, persona, vendorScope } from '../core/auth';
import { dayOf, fmtDay, fmtStamp, hoursBetween, TODAY, workdaysBetween } from '../core/date';
import { slaRisk } from '../core/derive';
import { L, T, tx } from '../core/i18n';
import { nextId } from '../core/mutations';
import { fmtHoursText } from '../core/narrative';
import { href, type Route, setQuery } from '../core/router';
import { advanceIf } from '../core/scenario';
import { PENALTY, PENALTY_CAP, penaltyOf, SLA_WINDOW_DAYS, ticketSla, type VendorMetrics, vendorMetrics } from '../core/sla';
import { store } from '../core/store';
import type { AppState, ChangeRequest, Deliverable, Milestone, Party, RaciRow, Ticket, Vendor, VendorId } from '../core/types';
import { $, html, nt, on, openModal, pct, type Safe, setHtml, toast } from '../ui/dom';
import type { PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, panel, personName, systemName, table, tabs, tag } from '../ui/widgets';

// 廠商管理：SLA、交付、責任邊界、合約里程碑、變更請求、違約與計罰試算。
// 每個百分比後面都跟著「幾張裡的幾張」，因為它是從工單與交付項算出來的。
// 委外廠商 PM 只看得到自家，連別家的名字都不會出現在這一頁。

const PARTY_NAME: Record<Party, [string, string]> = {
  internal: ['內部團隊', 'Internal team'],
  vendor: ['廠商', 'Vendor'],
  business: ['業務單位', 'Business unit'],
  audit: ['稽核', 'Audit'],
};
const CR_STAGE: Record<ChangeRequest['stage'], [string, string]> = {
  submitted: ['已提出', 'Submitted'],
  assessed: ['已評估，等核定', 'Assessed, awaiting decision'],
  approved: ['核准', 'Approved'],
  rejected: ['退回', 'Rejected'],
  done: ['已完成', 'Done'],
};
const TABS = ['tickets', 'deliverables', 'raci', 'milestones', 'cr', 'penalty'] as const;
type Tab = (typeof TABS)[number];

/** 交付項的逾期計罰：每逾期一個工作日罰該里程碑款項的 0.5%，上限 10%。 */
export function deliveryPenalty(state: AppState, d: Deliverable, milestone: Milestone | undefined): { days: number; amount: number; capped: boolean } | null {
  const end = d.deliveredAt ?? dayOf(state.clock);
  const days = workdaysBetween(d.due, end);
  if (!milestone?.amount || days <= 0) return null;
  const raw = milestone.amount * 0.005 * days;
  const cap = milestone.amount * 0.1;
  return { days, amount: Math.round(Math.min(raw, cap)), capped: raw > cap };
}

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  const two = (pair: [string, string]) => T(pair[0], pair[1]);
  const actor = () => persona().person?.id ?? persona().role;

  function scoreboard(state: AppState, selected: VendorId): Safe {
    const rows = state.vendors.map((v) => vendorMetrics(state, v.id));
    return panel(
      T('四家廠商', 'The four vendors'),
      table<VendorMetrics>({
        id: 'vendor-table',
        caption: T('廠商評分', 'Vendor scores'),
        empty: T('沒有廠商資料。', 'No vendors.'),
        rows,
        rowAttrs: (m) => html` class="${m.vendor.id === selected ? 'is-selected' : ''}"`,
        cols: [
          {
            head: T('廠商', 'Vendor'),
            cell: (m) => html`<a href="${href('/vendors', { vendor: m.vendor.id })}" data-fk="vendor:${m.vendor.id}">${tx(m.vendor.name)}</a>`,
            cls: 'nowrap',
          },
          {
            head: T('負責的系統', 'Systems'),
            cell: (m) =>
              state.systems
                .filter((s) => s.vendorId === m.vendor.id)
                .map((s) => tx(s.name))
                .join(T('、', ', ')),
          },
          {
            head: T('SLA 達成率', 'SLA attainment'),
            cell: (m) =>
              html`${mark(m.slaRate >= 0.95 ? 'ok' : m.slaRate >= 0.85 ? 'warn' : 'crit', pct(m.slaRate))} <span class="muted">${m.met.length}/${m.counted.length}</span>`,
            cls: 'num',
          },
          { head: T('回應（中位數）', 'Response (median)'), cell: (m) => tx(fmtHoursText(m.medianRespondMin / 60)), cls: 'num' },
          { head: T('解決（中位數）', 'Resolution (median)'), cell: (m) => tx(fmtHoursText(m.medianResolveHr)), cls: 'num' },
          {
            head: T('交付準時率', 'On-time delivery'),
            cell: (m) => html`${pct(m.onTimeRate)} <span class="muted">${m.onTime.length}/${m.delivered.length + m.lateOpen.length}</span>`,
            cls: 'num',
          },
          {
            head: T('驗收退件率', 'Rejection rate'),
            cell: (m) => html`${pct(m.rejectRate)} <span class="muted">${m.rejected.length}/${m.inspected.length}</span>`,
            cls: 'num',
          },
          { head: T('開著的工單', 'Open tickets'), cell: (m) => m.open.length, cls: 'num' },
          { head: T('合約到期', 'Contract ends'), cell: (m) => html`<span class="num">${m.vendor.contractEnd}</span>`, cls: 'nowrap' },
        ],
      }),
      {
        note: T('統計期間：最近 {n} 天。分母是已經有結果的工單。', 'Period: last {n} days. The denominator is tickets with an outcome.', {
          n: SLA_WINDOW_DAYS,
        }),
      },
    );
  }

  function ticketsTab(state: AppState, vendor: Vendor, m: VendorMetrics, picked: string | null): Safe {
    const rows = [...m.tickets].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
    return table<Ticket>({
      id: 'ticket-table',
      caption: T('工單', 'Tickets'),
      empty: T('最近 {n} 天沒有開過工單。', 'No tickets were opened in the last {n} days.', { n: SLA_WINDOW_DAYS }),
      rows,
      rowAttrs: (t) => html` class="${t.id === picked ? 'is-selected' : ''}"`,
      cols: [
        {
          head: 'SLA',
          cell: (t) => {
            const sla = ticketSla(t, vendor, state.clock);
            if (sla.state === 'met') return mark('ok', T('準時', 'On time'));
            if (sla.state === 'running')
              return mark(sla.used >= 0.75 ? 'warn' : 'ok', T('計時中，剩 {t}', 'Running, {t} left', { t: tx(fmtHoursText(sla.remainingHr ?? 0)) }));
            return mark(
              'crit',
              sla.state === 'overdue'
                ? T('已逾時 {t}，還沒解決', '{t} overdue, unresolved', { t: tx(fmtHoursText(sla.lateHr)) })
                : T('逾時 {t}', '{t} late', { t: tx(fmtHoursText(sla.lateHr)) }),
            );
          },
          cls: 'nowrap',
        },
        { head: T('編號', 'ID'), cell: (t) => html`<span class="num">${t.id}</span>`, cls: 'nowrap' },
        { head: T('優先', 'Priority'), cell: (t) => tag(t.priority, t.priority === 'P1' ? 'crit' : t.priority === 'P2' ? 'warn' : 'plain'), cls: 'nowrap' },
        { head: T('問題', 'Issue'), cell: (t) => tx(t.title), cls: 'wide' },
        { head: T('系統', 'System'), cell: (t) => systemName(state, t.systemId), cls: 'nowrap' },
        { head: T('開單', 'Opened'), cell: (t) => html`<span class="num">${fmtStamp(t.openedAt)}</span>`, cls: 'nowrap' },
        {
          head: T('回應', 'Responded in'),
          cell: (t) => (t.respondedAt ? tx(fmtHoursText(hoursBetween(t.openedAt, t.respondedAt))) : T('還沒回應', 'No response yet')),
          cls: 'num',
        },
        { head: T('解決', 'Resolved in'), cell: (t) => (t.resolvedAt ? tx(fmtHoursText(hoursBetween(t.openedAt, t.resolvedAt))) : '–'), cls: 'num' },
        {
          head: T('解決時限', 'Resolve by'),
          cell: (t) => html`<span class="num">${fmtStamp(ticketSla(t, vendor, state.clock).resolveDue)}</span>`,
          cls: 'nowrap',
        },
      ],
    });
  }

  function deliverablesTab(m: VendorMetrics): Safe {
    return table<Deliverable>({
      id: 'deliverable-table',
      caption: T('交付項', 'Deliverables'),
      empty: T('這家廠商目前沒有交付項。', 'This vendor has no deliverables at the moment.'),
      rows: m.deliverables,
      cols: [
        {
          head: T('狀態', 'Status'),
          cell: (d) => {
            if (!d.deliveredAt)
              return d.due < TODAY
                ? mark('crit', T('過期 {n} 個工作日未交', '{n} working {n|day|days} past due', { n: workdaysBetween(d.due, TODAY) }))
                : mark('ok', T('還沒到期', 'Not due yet'));
            if (d.acceptance === 'rejected') return mark('crit', T('驗收退件，等重交', 'Rejected, awaiting redelivery'));
            if (d.acceptance === 'pending') return mark('warn', T('已交付，等驗收', 'Delivered, awaiting acceptance'));
            return mark('ok', T('驗收通過', 'Accepted'));
          },
          cls: 'nowrap',
        },
        { head: T('編號', 'ID'), cell: (d) => html`<span class="num">${d.id}</span>`, cls: 'nowrap' },
        {
          head: T('交付項', 'Deliverable'),
          cell: (d) =>
            html`${tx(d.title)}${d.rejectReason ? html`<br /><span class="muted">${T('退件原因：', 'Rejected because: ')}${tx(d.rejectReason)}</span>` : ''}`,
          cls: 'wide',
        },
        { head: T('期限', 'Due'), cell: (d) => html`<span class="num">${fmtDay(d.due)}</span>`, cls: 'nowrap' },
        {
          head: T('交付日', 'Delivered'),
          cell: (d) =>
            d.deliveredAt
              ? html`<span class="num">${fmtDay(d.deliveredAt)}</span>${d.deliveredAt > d.due ? html` ${tag(T('遲 {n} 個工作日', '{n} working {n|day|days} late', { n: workdaysBetween(d.due, d.deliveredAt) }), 'warn')}` : ''}`
              : '–',
          cls: 'nowrap',
        },
        { head: T('退件次數', 'Rejections'), cell: (d) => d.rejects, cls: 'num' },
        {
          head: T('驗收', 'Acceptance'),
          cell: (d) =>
            d.deliveredAt && d.acceptance === 'pending'
              ? html`<span class="actions">${actionBtn({ act: 'accept', label: T('驗收通過', 'Accept'), perm: 'vendor.accept', small: true, data: { dl: d.id } })}${actionBtn({ act: 'reject', label: T('退件', 'Reject'), perm: 'vendor.accept', small: true, data: { dl: d.id } })}</span>`
              : '–',
          cls: 'nowrap',
        },
      ],
    });
  }

  function raciTab(state: AppState, vendor: Vendor): Safe {
    const rows = state.raci.filter((r) => r.vendorId === vendor.id);
    const parties = Object.keys(PARTY_NAME) as Party[];
    return html`${table<RaciRow>({
      id: 'raci-table',
      caption: T('責任邊界（RACI）', 'Responsibility boundary (RACI)'),
      empty: T('還沒有訂責任邊界。', 'No responsibility boundary is defined yet.'),
      rows,
      cols: [
        {
          head: T('工作', 'Activity'),
          cell: (r) =>
            html`${tx(r.activity)}${r.disputed ? html` ${tag(T('有爭議', 'Disputed'), 'crit')}<br /><span class="muted">${tx(r.disputed)}</span>` : ''}`,
          cls: 'wide',
        },
        ...parties.map((p) => ({
          head: two(PARTY_NAME[p]),
          cell: (r: RaciRow) => html`<span class="num">${r.cells[p] || '–'}</span>`,
          cls: 'nowrap' as const,
        })),
      ],
    })}<p class="panel-body hint">${T('R 負責做、A 最後負責（每一列只能有一個）、C 要先問過、I 事後告知。', 'R does the work, A is accountable (exactly one per row), C is consulted beforehand, I is informed afterwards.')}</p>`;
  }

  function milestonesTab(state: AppState, vendor: Vendor): Safe {
    const STATUS: Record<Milestone['status'], Safe> = {
      paid: mark('ok', T('已付款', 'Paid')),
      accepted: mark('ok', T('已驗收', 'Accepted')),
      due: mark('warn', T('到期', 'Due')),
      late: mark('crit', T('逾期', 'Late')),
      planned: html`<span class="muted">${T('還沒到', 'Upcoming')}</span>`,
    };
    return html`<div class="panel-body">${facts([
      [
        T('合約', 'Contract'),
        html`<span class="num">${vendor.contractNo}</span>${T('，', ', ')}<span class="num">${vendor.contractStart} – ${vendor.contractEnd}</span>`,
      ],
      [T('月服務費', 'Monthly fee'), html`<span class="num">${nt(vendor.monthlyFee)}</span>`],
      [T('窗口', 'Contact'), personName(state, vendor.pmId)],
      [
        T('SLA', 'SLA'),
        (['P1', 'P2', 'P3'] as const)
          .map(
            (p) =>
              `${p} ${T('回應', 'respond')} ${vendor.sla[p].respondMin} ${T('分', 'min')} / ${T('解決', 'resolve')} ${vendor.sla[p].resolveHr} ${T('小時', 'h')}`,
          )
          .join(T('；', '; ')),
      ],
      [T('備註', 'Note'), tx(vendor.note)],
    ])}</div>${table<Milestone>({
      id: 'milestone-table',
      caption: T('合約里程碑', 'Contract milestones'),
      empty: T('這份合約沒有登記里程碑。', 'No milestone is registered for this contract.'),
      rows: state.milestones.filter((x) => x.vendorId === vendor.id),
      cols: [
        { head: T('狀態', 'Status'), cell: (x) => STATUS[x.status], cls: 'nowrap' },
        { head: T('日期', 'Date'), cell: (x) => html`<span class="num">${x.date}</span>`, cls: 'nowrap' },
        { head: T('里程碑', 'Milestone'), cell: (x) => tx(x.title), cls: 'wide' },
        { head: T('金額', 'Amount'), cell: (x) => (x.amount ? nt(x.amount) : '–'), cls: 'num' },
      ],
    })}`;
  }

  function crTab(state: AppState, vendor: Vendor, picked: string | null): Safe {
    const flow: ChangeRequest['stage'][] = ['submitted', 'assessed', 'approved', 'done'];
    return html`<p class="panel-body hint">${T('流程：提出 → 評估成本與時程 → Tech Lead 核定（留下決策紀錄）→ 完成。提出的人不能自己核定。', 'Flow: raise → assess cost and schedule → Tech Lead decides (a decision record is kept) → done. Whoever raises a request cannot decide it.')}</p>${table<ChangeRequest>(
      {
        id: 'cr-table',
        caption: T('變更請求', 'Change requests'),
        empty: T('這家廠商沒有變更請求。', 'This vendor has no change requests.'),
        rows: state.changeRequests.filter((c) => c.vendorId === vendor.id),
        rowAttrs: (c) => html` class="${c.id === picked ? 'is-selected' : ''}"`,
        cols: [
          {
            head: T('階段', 'Stage'),
            cell: (c) =>
              c.stage === 'rejected'
                ? mark('crit', two(CR_STAGE.rejected))
                : mark(
                    c.stage === 'assessed' || c.stage === 'submitted' ? 'warn' : 'ok',
                    `${Math.max(flow.indexOf(c.stage), 0) + 1}/4 ${two(CR_STAGE[c.stage])}`,
                  ),
            cls: 'nowrap',
          },
          { head: T('編號', 'ID'), cell: (c) => html`<span class="num">${c.id}</span>`, cls: 'nowrap' },
          { head: T('變更請求', 'Change request'), cell: (c) => html`${tx(c.title)}<br /><span class="muted">${tx(c.reason)}</span>`, cls: 'wide' },
          { head: T('提出人', 'Raised by'), cell: (c) => personName(state, c.raisedBy), cls: 'nowrap' },
          { head: T('成本', 'Cost'), cell: (c) => (c.cost ? nt(c.cost) : T('不加價', 'No charge')), cls: 'num' },
          { head: T('時程', 'Schedule'), cell: (c) => (c.days ? T('多 {n} 天', '+{n} days', { n: c.days }) : T('不影響', 'No impact')), cls: 'num' },
          { head: T('決策紀錄', 'Decision'), cell: (c) => (c.decisionId ? html`<span class="num">${c.decisionId}</span>` : '–'), cls: 'nowrap' },
          {
            head: T('核定', 'Decide'),
            cell: (c) =>
              c.stage === 'assessed' ? actionBtn({ act: 'decide-cr', label: T('核定', 'Decide'), perm: 'cr.decide', small: true, data: { cr: c.id } }) : '–',
            cls: 'nowrap',
          },
        ],
      },
    )}`;
  }

  function penaltyTab(state: AppState, vendor: Vendor): Safe {
    const calc = penaltyOf(state, vendor.id);
    const late = state.deliverables.filter(
      (d) => d.vendorId === vendor.id && workdaysBetween(d.due, d.deliveredAt ?? TODAY) > 0 && (d.deliveredAt ?? TODAY).slice(0, 7) === TODAY.slice(0, 7),
    );
    const milestone = state.milestones.find((x) => x.vendorId === vendor.id && x.status === 'late');
    return html`<div class="panel-body stack">
      <p>${T(
        '工單：每逾時一個單位，罰月服務費的一個比例。P1 每 1 小時 {a}，P2 每 4 小時 {b}，P3 每 24 小時 {c}；單月上限是月服務費的 {cap}。',
        'Tickets: each unit of delay costs a share of the monthly fee. P1 {a} per hour, P2 {b} per 4 hours, P3 {c} per 24 hours; capped at {cap} of the monthly fee per month.',
        { a: pct(PENALTY.P1.rate), b: pct(PENALTY.P2.rate), c: pct(PENALTY.P3.rate), cap: pct(PENALTY_CAP) },
      )}</p>
      ${table({
        id: 'penalty-table',
        caption: T('本月的 SLA 違約', 'SLA breaches this month'),
        empty: T('這個月沒有逾時的工單。', 'No ticket breached its SLA this month.'),
        rows: calc.rows,
        cols: [
          { head: T('解決時限', 'Resolve by'), cell: (r) => html`<span class="num">${fmtStamp(r.sla.resolveDue)}</span>`, cls: 'nowrap' },
          {
            head: T('工單', 'Ticket'),
            cell: (r) =>
              html`<span class="num">${r.ticket.id}</span> ${tx(r.ticket.title)}${r.ticket.resolvedAt ? '' : html` ${tag(T('還沒解決，算到現在', 'Unresolved; counted to now'), 'crit')}`}`,
            cls: 'wide',
          },
          { head: T('優先', 'Priority'), cell: (r) => r.ticket.priority, cls: 'nowrap' },
          { head: T('逾時', 'Late by'), cell: (r) => tx(fmtHoursText(r.sla.lateHr)), cls: 'num' },
          { head: T('單位數', 'Units'), cell: (r) => r.units, cls: 'num' },
          { head: T('試算', 'Estimate'), cell: (r) => nt(r.amount), cls: 'num' },
        ],
      })}
      ${facts([
        [T('小計', 'Subtotal'), html`<span class="num">${nt(calc.subtotal)}</span>`],
        [T('單月上限', 'Monthly cap'), html`<span class="num">${nt(calc.cap)}</span>`],
        [
          T('工單計罰試算', 'Ticket penalty estimate'),
          html`<b class="num" id="penalty-total">${nt(calc.total)}</b>${calc.subtotal > calc.cap ? T('（已達上限）', ' (cap reached)') : ''}`,
        ],
      ])}
      <h3>${T('交付逾期', 'Late deliveries')}</h3>
      <p>${T('交付項每逾期一個工作日，罰該里程碑款項的 0.5%，上限 10%。', 'Each working day a deliverable is late costs 0.5% of that milestone payment, capped at 10%.')}</p>
      ${table<Deliverable>({
        id: 'late-table',
        caption: T('本月逾期的交付項', 'Deliverables late this month'),
        empty: T('這個月沒有逾期的交付項。', 'No deliverable was late this month.'),
        rows: late,
        cols: [
          { head: T('交付項', 'Deliverable'), cell: (d) => html`<span class="num">${d.id}</span> ${tx(d.title)}`, cls: 'wide' },
          { head: T('期限', 'Due'), cell: (d) => html`<span class="num">${fmtDay(d.due)}</span>`, cls: 'nowrap' },
          {
            head: T('逾期', 'Late by'),
            cell: (d) =>
              T('{n} 個工作日', '{n} working {n|day|days}', {
                n: deliveryPenalty(state, d, milestone)?.days ?? workdaysBetween(d.due, d.deliveredAt ?? TODAY),
              }),
            cls: 'num',
          },
          { head: T('里程碑款項', 'Milestone payment'), cell: () => (milestone ? nt(milestone.amount) : '–'), cls: 'num' },
          {
            head: T('試算', 'Estimate'),
            cell: (d) => (deliveryPenalty(state, d, milestone) ? nt(deliveryPenalty(state, d, milestone)?.amount ?? 0) : '–'),
            cls: 'num',
          },
        ],
      })}
      <p class="hint">${T('這是試算，不是請款。實際計罰要 Tech Lead 與廠商確認責任歸屬後才成立。', 'This is an estimate, not a claim. A penalty stands only after the Tech Lead and the vendor agree on responsibility.')}</p>
    </div>`;
  }

  function render(): void {
    const state = store.state;
    const scope = vendorScope();
    const all = !scope;
    const tabQuery = route.query.get('tab');
    const selectedId = (scope ??
      (state.vendors.find((v) => v.id === route.query.get('vendor'))?.id as VendorId | undefined) ??
      (tabQuery === 'risk' ? slaRisk(state).overdue[0]?.vendorId : undefined) ??
      state.vendors[0].id) as VendorId;
    const vendor = state.vendors.find((v) => v.id === selectedId) ?? state.vendors[0];
    const m = vendorMetrics(state, vendor.id);
    const tab: Tab = (TABS as readonly string[]).includes(tabQuery ?? '') ? (tabQuery as Tab) : tabQuery === 'risk' ? 'tickets' : 'tickets';
    const risk = slaRisk(state, scope);
    const body =
      tab === 'deliverables'
        ? deliverablesTab(m)
        : tab === 'raci'
          ? raciTab(state, vendor)
          : tab === 'milestones'
            ? milestonesTab(state, vendor)
            : tab === 'cr'
              ? crTab(state, vendor, route.query.get('cr'))
              : tab === 'penalty'
                ? penaltyTab(state, vendor)
                : ticketsTab(state, vendor, m, route.query.get('ticket'));
    const disputed = state.raci.filter((r) => r.vendorId === vendor.id && r.disputed).length;

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(
          T('廠商管理', 'Vendors'),
          all
            ? T(
                '{n} 家廠商。{o} 張工單已逾時、{r} 張快到期、{d} 個交付項過期未交。',
                '{n} vendors. {o} {o|ticket|tickets} overdue, {r} near due, {d} {d|deliverable|deliverables} past due.',
                {
                  n: state.vendors.length,
                  o: risk.overdue.length,
                  r: risk.atRisk.length,
                  d: risk.lateDeliverables.length,
                },
              )
            : T(
                '{v}：{o} 張工單已逾時、{d} 個交付項過期未交。你只看得到自己公司的資料。',
                '{v}: {o} {o|ticket|tickets} overdue, {d} {d|deliverable|deliverables} past due. You only see your own company’s data.',
                {
                  v: tx(vendor.name),
                  o: risk.overdue.length,
                  d: risk.lateDeliverables.length,
                },
              ),
        )}
        ${all ? scoreboard(state, vendor.id) : ''}
        <section class="panel" id="vendor-panel">
          <div class="panel-head"><h2>${tx(vendor.name)}</h2><span class="panel-note">${tx(vendor.product)}</span></div>
          <div class="stat-row is-flat" id="vendor-stats">
            <div class="stat"><span class="stat-k">${T('SLA 達成率', 'SLA attainment')}</span><span class="stat-v num">${pct(m.slaRate)}</span><span class="stat-n">${T('{m}/{n} 張準時解決', '{m} of {n} resolved on time', { m: m.met.length, n: m.counted.length })}</span></div>
            <div class="stat"><span class="stat-k">${T('回應與解決（中位數）', 'Response and resolution (median)')}</span><span class="stat-v num">${tx(fmtHoursText(m.medianRespondMin / 60))} / ${tx(fmtHoursText(m.medianResolveHr))}</span><span class="stat-n">${T('回應準時 {p}', '{p} responded on time', { p: pct(m.respondRate) })}</span></div>
            <div class="stat"><span class="stat-k">${T('交付準時率', 'On-time delivery')}</span><span class="stat-v num">${pct(m.onTimeRate)}</span><span class="stat-n">${T('{m}/{n} 個準時，{l} 個過期未交', '{m} of {n} on time, {l} past due', { m: m.onTime.length, n: m.delivered.length + m.lateOpen.length, l: m.lateOpen.length })}</span></div>
            <div class="stat"><span class="stat-k">${T('驗收退件率', 'Rejection rate')}</span><span class="stat-v num">${pct(m.rejectRate)}</span><span class="stat-n">${T('{m}/{n} 個被退過', '{m} of {n} were rejected at least once', { m: m.rejected.length, n: m.inspected.length })}</span></div>
          </div>
          ${tabs(
            [
              { id: 'tickets', label: T('工單', 'Tickets'), count: m.tickets.length },
              { id: 'deliverables', label: T('交付項', 'Deliverables'), count: m.deliverables.length },
              { id: 'raci', label: T('責任邊界', 'Responsibility'), count: disputed || undefined },
              { id: 'milestones', label: T('合約里程碑', 'Milestones') },
              { id: 'cr', label: T('變更請求', 'Change requests'), count: state.changeRequests.filter((c) => c.vendorId === vendor.id).length },
              { id: 'penalty', label: T('違約與計罰試算', 'Breaches and penalty estimate') },
            ],
            tab,
          )}
          ${body}
        </section>
      </div>`,
    );
  }

  const offs = [
    on(root, 'click', '[data-tab]', (_e, el) => setQuery({ tab: el.dataset.tab ?? null, ticket: null, cr: null })),
    on(root, 'click', '[data-act="accept"]', (_e, el) => {
      store.update((s) => {
        const d = s.deliverables.find((x) => x.id === el.dataset.dl);
        if (!d) return;
        d.acceptance = 'accepted';
        audit(s, L('驗收通過', 'Accepted deliverable'), d.id, d.title);
      });
      toast(T('已驗收通過', 'Accepted'));
    }),
    on(root, 'click', '[data-act="reject"]', (_e, el) => {
      const id = el.dataset.dl ?? '';
      if (advanceIf(`reject:${id}`)) {
        toast(T('已退件，原因記在交付項上', 'Rejected; the reason is recorded on the deliverable'), 'warn');
        return;
      }
      openModal(
        html`<div class="modal-head"><h2>${T('退件：{id}', 'Reject {id}', { id })}</h2></div>
        <div class="modal-body stack"><label for="reject-why">${T('哪一項沒過、怎麼重現（必填）', 'Which item failed and how to reproduce it (required)')}</label><textarea id="reject-why" rows="4"></textarea></div>
        <div class="modal-foot"><button type="button" class="btn" data-close>${T('取消', 'Cancel')}</button><button type="button" class="btn btn-primary" id="do-reject">${T('退件', 'Reject')}</button></div>`,
        (dialog, close) => {
          $('#do-reject', dialog).addEventListener('click', () => {
            const why = $<HTMLTextAreaElement>('#reject-why', dialog).value.trim();
            if (!why) {
              $<HTMLTextAreaElement>('#reject-why', dialog).focus();
              toast(T('請寫退件原因，廠商才知道要改什麼', 'Write the reason so the vendor knows what to fix'), 'warn');
              return;
            }
            store.update((s) => {
              const d = s.deliverables.find((x) => x.id === id);
              if (!d) return;
              d.acceptance = 'rejected';
              d.rejects += 1;
              d.rejectReason = { zh: why, en: why };
              audit(s, L('驗收退件', 'Rejected deliverable'), d.id, { zh: why, en: why });
            });
            close();
            toast(T('已退件，原因記在交付項上', 'Rejected; the reason is recorded on the deliverable'), 'warn');
          });
        },
      );
    }),
    on(root, 'click', '[data-act="decide-cr"]', (_e, el) => {
      const id = el.dataset.cr ?? '';
      if (advanceIf(`decide:${id}`)) {
        toast(T('已核定，留下一筆決策紀錄', 'Decided; a decision record was kept'));
        return;
      }
      openModal(
        html`<div class="modal-head"><h2>${T('核定 {id}', 'Decide {id}', { id })}</h2></div>
        <div class="modal-body stack"><label for="cr-why">${T('為什麼這樣決定（必填，會寫進決策紀錄）', 'Why (required; goes into the decision record)')}</label><textarea id="cr-why" rows="4"></textarea></div>
        <div class="modal-foot"><button type="button" class="btn" data-close>${T('取消', 'Cancel')}</button><button type="button" class="btn" data-verdict="rejected">${T('退回', 'Reject')}</button><button type="button" class="btn btn-primary" data-verdict="approved">${T('核准', 'Approve')}</button></div>`,
        (dialog, close) => {
          dialog.addEventListener('click', (event) => {
            const verdict = (event.target as Element).closest<HTMLElement>('[data-verdict]')?.dataset.verdict as 'approved' | 'rejected' | undefined;
            if (!verdict) return;
            const why = $<HTMLTextAreaElement>('#cr-why', dialog).value.trim();
            if (!why) {
              $<HTMLTextAreaElement>('#cr-why', dialog).focus();
              toast(
                T('請寫原因。沒有原因的決定，三個月後沒有人記得為什麼', 'Write the reason. A decision without one is a mystery three months later'),
                'warn',
              );
              return;
            }
            store.update((s) => {
              const cr = s.changeRequests.find((c) => c.id === id);
              if (!cr) return;
              const decisionId = nextId(s.decisions, 'DEC-');
              cr.stage = verdict;
              cr.decisionId = decisionId;
              s.decisions.push({
                id: decisionId,
                title: cr.title,
                date: TODAY,
                decidedBy: actor(),
                chosen: verdict === 'approved' ? L(`核准 ${cr.id}`, `${cr.id} approved`) : L(`退回 ${cr.id}`, `${cr.id} rejected`),
                why: { zh: why, en: why },
                crId: cr.id,
              });
              audit(
                s,
                L('核定變更請求', 'Decided change request'),
                cr.id,
                verdict === 'approved'
                  ? L(`核准；決策紀錄 ${decisionId}`, `Approved; decision ${decisionId}`)
                  : L(`退回；決策紀錄 ${decisionId}`, `Rejected; decision ${decisionId}`),
              );
            });
            close();
            toast(T('已核定，留下一筆決策紀錄', 'Decided; a decision record was kept'));
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
    },
    route(next) {
      route = next;
      render();
    },
  };
}
