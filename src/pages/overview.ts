import { can, persona, vendorScope } from '../core/auth';
import { addDays, addWorkdays, fmtDay, fmtStamp, holidayName, isWorkday, TODAY } from '../core/date';
import { attentionIfaces, monthEndFreeze, openDiffs, openTasksOf, pendingFor, slaRisk } from '../core/derive';
import { T, tx } from '../core/i18n';
import { queued } from '../core/mutations';
import { AUDIENCE_NAME, AUDIENCE_OF, type Audience, type Statement, sideBySide, statementsFor } from '../core/narrative';
import { PERMS, ROLES, sodConflicts } from '../core/rbac';
import { href, type Route } from '../core/router';
import { closeCountdown, ifaceStatus, ifacesByHealth, runsOf } from '../core/selectors';
import { vendorMetrics } from '../core/sla';
import { store } from '../core/store';
import type { AppState, Branch, Demand, DlqItem, Domain, Health, Iface, Review, Task } from '../core/types';
import { $, html, pct, type Safe, setHtml } from '../ui/dom';
import { canOpen, type PageHandle } from '../ui/shell';
import { mountTwinPanel } from '../ui/twinPanel';
import { mark, pageHead, panel, personName, runStrip, systemName, table, tag } from '../ui/widgets';

// 總覽。同一份資料，每個角色看到不同的內容與不同的說法：
// 技術角色看到編號與原因；財務、人資、業務看到的是「哪件事會受影響」，畫面上沒有技術名詞。
// 上面那排數字都是連結，點進去看到的列數就是那個數字（tests/unit/overview.test.ts 守著）。

const RUN_HEALTH: Record<string, Health> = { ok: 'ok', retried: 'warn', late: 'warn', held: 'warn', fail: 'crit' };
const DOMAINS_OF: Partial<Record<Audience, Domain[]>> = { finance: ['finance', 'procurement'], hr: ['hr'], business: ['sales'] };

export interface Stat {
  id: string;
  label: string;
  value: Safe | string;
  note: string;
  /** 點下去到哪裡；沒有對應的頁面可開時是 null。 */
  to: string | null;
  /** 這個數字是幾列資料算出來的。 */
  count: number;
}

/** 某個角色的總覽上面那一排數字。 */
export function statsFor(state: AppState, audience: Audience, tech: boolean, vendorId: string | null): Stat[] {
  const c = closeCountdown(state);
  const link = (path: string, query?: Record<string, string>) => (canOpen(path) ? href(path, query) : null);
  // 同一頁裡的區塊：網址的 # 已經拿去做路由，所以用查詢參數指出要捲到哪一塊
  const here = (at: string) => href('/overview', { at });
  const monthEnd: Stat = {
    id: 'month-end',
    label: T('月結日', 'Month-end'),
    value: html`<span class="num">${fmtDay(c.monthEnd)}</span>`,
    note: c.toMonthEnd ? T('還有 {n} 個工作日', '{n} working {n|day|days} left', { n: c.toMonthEnd }) : T('就是今天', 'Today'),
    to: here('calendar'),
    count: c.toMonthEnd,
  };
  const close: Stat = {
    id: 'close',
    label: T('關帳日', 'Book closing'),
    value: html`<span class="num">${fmtDay(c.closeDay)}</span>`,
    note: T('還有 {n} 個工作日', '{n} working {n|day|days} left', { n: c.toClose }),
    to: here('calendar'),
    count: c.toClose,
  };
  if (tech) {
    const by = ifacesByHealth(state);
    const risk = slaRisk(state);
    const pending = pendingFor(state, 'tl');
    const mine = audience === 'engineer' && !can('task.assign');
    return [
      {
        id: 'health',
        label: T('今日介面健康', 'Interface health today'),
        value: html`${mark('ok', String(by.ok.length))}${mark('warn', String(by.warn.length))}${mark('crit', String(by.crit.length))}`,
        note: T('{n} 條要注意', '{n} need attention', { n: by.warn.length + by.crit.length }),
        to: link('/integration', { health: 'attention' }),
        count: by.warn.length + by.crit.length,
      },
      monthEnd,
      {
        id: 'sla',
        label: T('SLA 風險', 'SLA risk'),
        value: html`<span class="num">${risk.total}</span>`,
        note: T('逾時工單 {o}、快到期 {r}、過期未交 {d}', '{o} overdue, {r} near due, {d} late deliveries', {
          o: risk.overdue.length,
          r: risk.atRisk.length,
          d: risk.lateDeliverables.length,
        }),
        to: link('/vendors', { tab: 'risk' }) ?? here('sla-risk'),
        count: risk.total,
      },
      mine
        ? {
            id: 'tasks',
            label: T('我的任務', 'My tasks'),
            value: html`<span class="num">${openTasksOf(state, persona().person?.id ?? '').length}</span>`,
            note: T('還沒做完的', 'not finished yet'),
            to: here('my-tasks'),
            count: openTasksOf(state, persona().person?.id ?? '').length,
          }
        : {
            id: 'pending',
            label: T('等我決定的事', 'Waiting on my decision'),
            value: html`<span class="num">${pending.total}</span>`,
            note: T('變更 {c}、需求 {d}、變更請求 {r}、驗收 {a}、Review {v}', '{c} changes, {d} requests, {r} change requests, {a} acceptances, {v} reviews', {
              c: pending.changes.length,
              d: pending.demands.length,
              r: pending.crs.length,
              a: pending.acceptances.length,
              v: pending.reviews.length,
            }),
            to: here('pending'),
            count: pending.total,
          },
    ];
  }
  if (audience === 'vendor' && vendorId) {
    const m = vendorMetrics(state, vendorId as never);
    const risk = slaRisk(state, vendorId as never);
    return [
      {
        id: 'open',
        label: T('開著的工單', 'Open tickets'),
        value: html`<span class="num">${m.open.length}</span>`,
        note: T('其中 {n} 張已逾時', '{n} overdue', { n: risk.overdue.length }),
        to: link('/vendors', { tab: 'tickets' }),
        count: m.open.length,
      },
      {
        id: 'sla',
        label: T('近 90 天 SLA 達成率', 'SLA attainment, last 90 days'),
        value: html`<span class="num">${pct(m.slaRate)}</span>`,
        note: T('{m}/{n} 張準時', '{m} of {n} on time', { m: m.met.length, n: m.counted.length }),
        to: link('/vendors', { tab: 'tickets' }),
        count: m.counted.length,
      },
      {
        id: 'late',
        label: T('過期未交的交付項', 'Deliverables past due'),
        value: html`<span class="num">${m.lateOpen.length}</span>`,
        note: T('共 {n} 個交付項', '{n} deliverables in total', { n: m.deliverables.length }),
        to: link('/vendors', { tab: 'deliverables' }),
        count: m.lateOpen.length,
      },
      monthEnd,
    ];
  }
  if (audience === 'audit') {
    const conflicts = sodConflicts(state.rbac);
    const leavers = openDiffs(state, 'RC-10');
    return [
      {
        id: 'sod',
        label: T('職責分離衝突', 'Segregation-of-duties conflicts'),
        value: html`<span class="num">${conflicts.length}</span>`,
        note: T('8 個角色的權限矩陣', 'across the 8-role matrix'),
        to: link('/rbac'),
        count: conflicts.length,
      },
      {
        id: 'trail',
        label: T('稽核軌跡', 'Audit trail'),
        value: html`<span class="num">${state.audit.length}</span>`,
        note: T('筆紀錄', 'entries'),
        to: link('/rbac'),
        count: state.audit.length,
      },
      canOpen('/incidents')
        ? {
            id: 'changes',
            label: T('等核准的變更', 'Changes awaiting approval'),
            value: html`<span class="num">${state.changes.filter((x) => x.status === 'requested').length}</span>`,
            note: T('共 {n} 張變更', '{n} changes in total', { n: state.changes.length }),
            to: link('/incidents', { tab: 'changes' }),
            count: state.changes.filter((x) => x.status === 'requested').length,
          }
        : {
            id: 'roles',
            label: T('角色與權限', 'Roles and permissions'),
            value: html`<span class="num">${ROLES.length}</span>`,
            note: T('{n} 項權限', '{n} permissions', { n: PERMS.length }),
            to: link('/rbac'),
            count: ROLES.length,
          },
      {
        id: 'leavers',
        label: T('離職未停用的帳號', 'Leavers with active accounts'),
        value: html`<span class="num">${leavers.length}</span>`,
        note: T('每天比對一次', 'checked daily'),
        to: null,
        count: leavers.length,
      },
    ];
  }
  // 財務、人資、業務
  const scope = DOMAINS_OF[audience] ?? [];
  const mineIfaces = state.ifaces.filter((i) => scope.includes(i.domain));
  const bad = mineIfaces.filter((i) => ifaceStatus(state, i).health !== 'ok');
  const demands = state.demands.filter((d) =>
    audience === 'business' ? d.dept === 'sales' : audience === 'hr' ? d.dept === 'hr' : d.dept === 'finance' || d.dept === 'procurement',
  );
  const active = demands.filter((d) => d.stage !== 'declined' && d.stage !== 'scheduled');
  const exchange: Stat = {
    id: 'exchange',
    label: T('跟你有關的資料交換', 'Data exchanges that concern you'),
    value: html`${mark('ok', String(mineIfaces.length - bad.length))}${mark(bad.some((i) => ifaceStatus(state, i).health === 'crit') ? 'crit' : 'warn', String(bad.length))}`,
    note: T('共 {n} 項，{b} 項要注意', '{n} in total, {b} need attention', { n: mineIfaces.length, b: bad.length }),
    to: here('exchanges'),
    count: bad.length,
  };
  const reqs: Stat = {
    id: 'demands',
    label: T('我們單位提的需求', 'Requests from our unit'),
    value: html`<span class="num">${demands.length}</span>`,
    note: T('{n} 件還在進行', '{n} still in progress', { n: active.length }),
    to: here('requests'),
    count: demands.length,
  };
  if (audience === 'finance') {
    const diffs = openDiffs(state);
    return [
      monthEnd,
      close,
      {
        id: 'diffs',
        label: T('還沒結的對帳差異', 'Open reconciliation differences'),
        value: html`<span class="num">${diffs.length}</span>`,
        note: T('{n} 條規則有差異', '{n} rules have differences', { n: new Set(diffs.map((d) => d.ruleId)).size }),
        to: link('/consistency'),
        count: diffs.length,
      },
      exchange,
    ];
  }
  return [exchange, monthEnd, reqs, close];
}

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;

  function statRow(stats: Stat[]): Safe {
    return html`<div class="stat-row" id="stats">${stats.map((s) => {
      const inner = html`<span class="stat-k">${s.label}</span><span class="stat-v">${s.value}</span><span class="stat-n">${s.note}</span>`;
      return s.to
        ? html`<a class="stat" href="${s.to}" data-stat="${s.id}" data-count="${s.count}">${inner}</a>`
        : html`<div class="stat" data-stat="${s.id}" data-count="${s.count}">${inner}</div>`;
    })}</div>`;
  }

  function statements(state: AppState, lines: Statement[], tech: boolean, empty: string): Safe {
    return table<Statement>({
      id: 'statements',
      caption: T('現在要知道的事', 'What to know right now'),
      empty,
      rows: lines,
      cols: [
        { head: T('狀態', 'Status'), cell: (s) => mark(s.health, s.health === 'ok' ? T('已處理', 'Settled') : undefined), cls: 'nowrap' },
        { head: T('現況', 'What is happening'), cell: (s) => tx(s.text), cls: 'wide' },
        {
          head: T('看明細', 'Details'),
          cell: (s) => {
            if (tech && s.ifaceId && canOpen('/integration')) return html`<a href="${href('/integration', { iface: s.ifaceId })}">${s.ifaceId}</a>`;
            if (s.ifaceId && (queued(state, s.ifaceId).length || state.dlq.some((d) => d.ifaceId === s.ifaceId)))
              return html`<a href="${href('/overview', { detail: s.ifaceId })}" data-fk="detail:${s.ifaceId}">${T('是哪些人', 'Who is affected')}</a>`;
            if (s.ticketId && canOpen('/vendors')) return html`<a href="${href('/vendors', { tab: 'tickets', ticket: s.ticketId })}">${s.ticketId}</a>`;
            return '–';
          },
          cls: 'nowrap',
        },
        ...(tech
          ? [
              {
                head: T('負責人', 'Owner'),
                cell: (s: Statement) => personName(state, state.ifaces.find((i) => i.id === s.ifaceId)?.ownerId),
                cls: 'nowrap' as const,
              },
              {
                head: T('最近 12 次', 'Last 12 runs'),
                cell: (s: Statement) =>
                  runStrip(
                    runsOf(state, s.ifaceId ?? '')
                      .slice(0, 12)
                      .reverse()
                      .map((r) => RUN_HEALTH[r.status]),
                    T('最近 12 次執行的結果，由舊到新', 'Results of the last 12 runs, oldest first'),
                  ),
              },
            ]
          : []),
      ],
    });
  }

  function detailPanel(state: AppState, ifaceId: string): Safe {
    const iface = state.ifaces.find((i) => i.id === ifaceId);
    const rows = state.dlq.filter((d) => d.ifaceId === ifaceId);
    if (!iface) return html``;
    return panel(
      tx(iface.plain),
      table<DlqItem>({
        id: 'detail-table',
        caption: T('受影響的資料', 'Affected records'),
        empty: T('這件事目前沒有待處理的資料。', 'Nothing is waiting to be processed for this.'),
        rows,
        cols: [
          { head: T('員工編號', 'Employee no.'), cell: (d) => html`<span class="num">${d.key}</span>`, cls: 'nowrap' },
          { head: T('類別', 'Type'), cell: (d) => tx(d.kind), cls: 'nowrap' },
          { head: T('要更新的內容', 'What should be updated'), cell: (d) => tx(d.detail), cls: 'wide' },
          {
            head: T('狀態', 'Status'),
            cell: (d) => (d.status === 'queued' ? mark('warn', T('還沒更新', 'Not updated yet')) : mark('ok', T('已更新', 'Updated'))),
            cls: 'nowrap',
          },
        ],
      }),
      {
        id: 'detail',
        note: T('{n} 位', '{n} people', { n: rows.length }),
        actions: html`<a class="btn btn-sm" href="${href('/overview')}" data-fk="close-detail">${T('關閉', 'Close')}</a>`,
      },
    );
  }

  /** 到關帳日為止的每一天。月結與關帳的倒數，就是這張表裡工作日的列數。 */
  function calendar(state: AppState, tech: boolean): Safe {
    const c = closeCountdown(state);
    const days: string[] = [];
    for (let d = c.today; d <= c.closeDay; d = addDays(d, 1)) days.push(d);
    const freeze = monthEndFreeze(c.today.slice(0, 7));
    const batches = state.ifaces.filter((i) => i.schedule.kind === 'monthly');
    const notes = (day: string): string[] => {
      const out: string[] = [];
      if (day === c.today) out.push(T('今天', 'Today'));
      for (const iface of batches) {
        const due = iface.id === 'INT-015' ? addWorkdays(c.monthEnd, -1) : c.monthEnd;
        if (due === day) out.push(`${tech ? `${iface.id} ` : ''}${tx(iface.plain)} ${iface.schedule.at ?? ''}`);
      }
      if (day === c.monthEnd) out.push(T('月結日，晚上跑月底批次', 'Month-end; month-end batches run tonight'));
      if (day === c.closeDay) out.push(T('關帳日', 'Book closing'));
      const holiday = holidayName(day);
      if (holiday) out.push(tx(holiday));
      return out;
    };
    return panel(
      T('到關帳日為止的日曆', 'Calendar up to book closing'),
      table<string>({
        id: 'calendar-table',
        caption: T('到關帳日為止的日曆', 'Calendar up to book closing'),
        empty: '',
        rows: days,
        rowAttrs: (d) => html` data-workday="${String(isWorkday(d) && d !== c.today)}"`,
        cols: [
          { head: T('日期', 'Date'), cell: (d) => html`<span class="num">${fmtDay(d)}</span>`, cls: 'nowrap' },
          { head: T('上班日', 'Working day'), cell: (d) => (isWorkday(d) ? T('是', 'Yes') : html`<span class="muted">${T('否', 'No')}</span>`), cls: 'nowrap' },
          { head: T('變更凍結', 'Change freeze'), cell: (d) => (d >= freeze.start && d <= freeze.end ? tag(tx(freeze.name), 'warn') : '–'), cls: 'nowrap' },
          { head: T('這天有什麼', 'What happens'), cell: (d) => notes(d).join(T('；', '; ')) || '–', cls: 'wide' },
        ],
      }),
      { id: 'calendar', note: T('倒數的工作日不含今天', 'The countdown excludes today') },
    );
  }

  /** 網址帶了 at 參數：捲到那個區塊，並把鍵盤焦點移過去。 */
  function reveal(): void {
    const at = route.query.get('at') ?? (route.query.get('detail') ? 'detail' : null);
    const target = at ? root.querySelector<HTMLElement>(`#${CSS.escape(at)}`) : null;
    if (!target) return;
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }

  function render(): void {
    const state = store.state;
    const role = store.prefs.role;
    const audience = AUDIENCE_OF[role];
    const tech = can('iface.detail');
    const who = persona();
    const scope = vendorScope();
    const lines = statementsFor(state, tech ? 'engineer' : audience, audience === 'vendor' ? (who.vendorId ?? scope) : null);
    const stats = statsFor(state, audience, tech, who.vendorId ?? null);
    const by = ifacesByHealth(state);
    const worst = attentionIfaces(state)[0];
    const sections: Safe[] = [];

    const summary = tech
      ? T('{total} 條介面：{ok} 條正常、{warn} 條注意、{crit} 條中斷。', '{total} interfaces: {ok} OK, {warn} need attention, {crit} down.', {
          total: state.ifaces.length,
          ok: by.ok.length,
          warn: by.warn.length,
          crit: by.crit.length,
        })
      : lines.filter((l) => l.health !== 'ok').length
        ? T('有 {n} 件事要知道。', '{n} {n|thing|things} to know about.', { n: lines.filter((l) => l.health !== 'ok').length })
        : T('跟你有關的事目前都正常。', 'Everything that concerns you is in order.');

    sections.push(
      panel(
        tech ? T('需要注意的介面', 'Interfaces needing attention') : T('現在要知道的事', 'What to know right now'),
        statements(
          state,
          lines,
          tech,
          tech
            ? T('目前沒有需要注意的介面，24 條最近一次執行都成功。', 'Nothing needs attention: all 24 interfaces succeeded on their last run.')
            : T('目前沒有需要你知道的事。', 'There is nothing you need to know about right now.'),
        ),
        {
          note: tech ? T('{n} 條', '{n} interfaces', { n: lines.length }) : T('這些句子由規則從資料算出來', 'These lines are composed by rules from the data'),
          id: 'attention',
        },
      ),
    );

    const detailId = route.query.get('detail');
    if (detailId) sections.push(detailPanel(state, detailId));

    if (can('task.assign') && worst) {
      const rows = sideBySide(state, worst).filter((r) => r.text);
      sections.push(
        panel(
          T('同一件事，不同說法：{id}', 'One event, different accounts: {id}', { id: worst.id }),
          table({
            id: 'side-by-side',
            caption: T('同一件事，不同說法', 'One event, different accounts'),
            empty: '',
            rows,
            cols: [
              { head: T('誰在看', 'Reader'), cell: (r) => tx(AUDIENCE_NAME[r.audience]), cls: 'nowrap' },
              { head: T('他們看到的', 'What they see'), cell: (r) => tx(r.text), cls: 'wide' },
            ],
          }),
          { note: T('切換上方的登入身分，可以看到各自的畫面', 'Switch identity above to see each view'), id: 'accounts' },
        ),
      );
    }

    if (can('task.assign')) {
      const p = pendingFor(state, who.person?.id ?? 'tl');
      type Row = { kind: string; id: string; title: string; to: string | null };
      const to = (path: string, query: Record<string, string>) => (canOpen(path) ? href(path, query) : null);
      const rows: Row[] = [
        ...p.changes.map((x) => ({ kind: T('核准變更', 'Approve change'), id: x.id, title: tx(x.title), to: to('/incidents', { chg: x.id }) })),
        ...p.demands.map((x) => ({ kind: T('選方案', 'Choose an option'), id: x.id, title: tx(x.title), to: to('/demands', { req: x.id }) })),
        ...p.crs.map((x) => ({ kind: T('核定變更請求', 'Decide change request'), id: x.id, title: tx(x.title), to: to('/vendors', { tab: 'cr', cr: x.id }) })),
        ...p.acceptances.map((x) => ({
          kind: T('驗收', 'Accept delivery'),
          id: x.id,
          title: tx(x.title),
          to: to('/vendors', { tab: 'deliverables', dl: x.id }),
        })),
        ...p.reviews.map((x) => ({ kind: 'Code Review', id: x.id, title: tx(x.title), to: null })),
      ];
      sections.push(
        panel(
          T('等我決定的事', 'Waiting on my decision'),
          table<Row>({
            id: 'pending-table',
            caption: T('等我決定的事', 'Waiting on my decision'),
            empty: T('沒有等你決定的事。', 'Nothing is waiting on you.'),
            rows,
            cols: [
              { head: T('要做什麼', 'What to do'), cell: (r) => r.kind, cls: 'nowrap' },
              {
                head: T('編號', 'ID'),
                cell: (r) => (r.to ? html`<a class="num" href="${r.to}">${r.id}</a>` : html`<span class="num">${r.id}</span>`),
                cls: 'nowrap',
              },
              { head: T('內容', 'Subject'), cell: (r) => r.title, cls: 'wide' },
            ],
          }),
          { note: T('{n} 件', '{n} items', { n: rows.length }), id: 'pending' },
        ),
      );
    }

    if (tech) {
      const risk = slaRisk(state);
      const rows = [
        ...risk.overdue.map((t) => ({ health: 'crit' as Health, id: t.id, vendorId: t.vendorId, what: tx(t.title), state: T('工單已逾時', 'Ticket overdue') })),
        ...risk.atRisk.map((t) => ({ health: 'warn' as Health, id: t.id, vendorId: t.vendorId, what: tx(t.title), state: T('工單快到期', 'Ticket near due') })),
        ...risk.lateDeliverables.map((d) => ({
          health: 'crit' as Health,
          id: d.id,
          vendorId: d.vendorId,
          what: tx(d.title),
          state: T('交付項過期未交（期限 {d}）', 'Deliverable past due ({d})', { d: fmtDay(d.due) }),
        })),
      ];
      sections.push(
        panel(
          T('SLA 風險', 'SLA risk'),
          table({
            id: 'sla-table',
            caption: T('SLA 風險', 'SLA risk'),
            empty: T('沒有逾時或快到期的工單，也沒有過期未交的交付項。', 'No overdue or near-due tickets, and no deliverables past due.'),
            rows,
            cols: [
              { head: T('狀態', 'Status'), cell: (r) => mark(r.health, r.state), cls: 'nowrap' },
              { head: T('編號', 'ID'), cell: (r) => html`<span class="num">${r.id}</span>`, cls: 'nowrap' },
              { head: T('廠商', 'Vendor'), cell: (r) => tx(state.vendors.find((v) => v.id === r.vendorId)?.name), cls: 'nowrap' },
              { head: T('內容', 'Subject'), cell: (r) => r.what, cls: 'wide' },
            ],
          }),
          { note: T('{n} 項', '{n} items', { n: rows.length }), id: 'sla-risk' },
        ),
      );
    }

    if (audience === 'engineer' && who.person) {
      const me = who.person.id;
      sections.push(
        panel(
          T('我的任務', 'My tasks'),
          table<Task>({
            id: 'task-table',
            caption: T('我的任務', 'My tasks'),
            empty: T('沒有指派給你的任務。', 'No tasks are assigned to you.'),
            rows: openTasksOf(state, me),
            cols: [
              { head: T('編號', 'ID'), cell: (t) => html`<span class="num">${t.id}</span>`, cls: 'nowrap' },
              { head: T('任務', 'Task'), cell: (t) => tx(t.title), cls: 'wide' },
              { head: T('系統', 'System'), cell: (t) => systemName(state, t.systemId), cls: 'nowrap' },
              { head: T('人天', 'Days'), cell: (t) => t.effortDays, cls: 'num' },
              { head: T('期限', 'Due'), cell: (t) => html`<span class="num">${fmtDay(t.due)}</span>`, cls: 'nowrap' },
              {
                head: T('狀態', 'Status'),
                cell: (t) =>
                  tag(t.status === 'doing' ? T('進行中', 'In progress') : t.status === 'review' ? T('等 Review', 'In review') : T('還沒開始', 'Not started')),
                cls: 'nowrap',
              },
            ],
          }),
          { id: 'my-tasks' },
        ),
        panel(
          T('等我 Review', 'Waiting for my review'),
          table<Review>({
            id: 'review-table',
            caption: T('Code Review 佇列', 'Code review queue'),
            empty: T('沒有等你 Review 的變更。', 'No changes are waiting for your review.'),
            rows: state.reviews.filter((r) => r.reviewerId === me && r.status === 'open'),
            cols: [
              { head: T('編號', 'ID'), cell: (r) => html`<span class="num">${r.id}</span>`, cls: 'nowrap' },
              { head: T('變更', 'Change'), cell: (r) => tx(r.title), cls: 'wide' },
              { head: T('作者', 'Author'), cell: (r) => personName(state, r.authorId), cls: 'nowrap' },
              { head: T('行數', 'Lines'), cell: (r) => r.lines, cls: 'num' },
              { head: T('送出時間', 'Opened'), cell: (r) => html`<span class="num">${fmtStamp(r.openedAt)}</span>`, cls: 'nowrap' },
            ],
          }),
        ),
      );
    }

    const scopeDomains = DOMAINS_OF[audience];
    if (!tech && scopeDomains) {
      sections.push(
        panel(
          T('跟你有關的資料交換', 'Data exchanges that concern you'),
          table<Iface>({
            id: 'exchange-table',
            caption: T('跟你有關的資料交換', 'Data exchanges that concern you'),
            empty: T('沒有跟你的單位有關的資料交換。', 'No data exchange concerns your unit.'),
            rows: state.ifaces.filter((i) => scopeDomains.includes(i.domain)),
            cols: [
              { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(state, i).health), cls: 'nowrap' },
              { head: T('哪件事', 'What'), cell: (i) => tx(i.plain), cls: 'wide' },
              {
                head: T('最近一次', 'Last done'),
                cell: (i) => html`<span class="num">${fmtStamp(ifaceStatus(state, i).run?.at ?? state.clock)}</span>`,
                cls: 'nowrap',
              },
              { head: T('資訊處的負責人', 'IT contact'), cell: (i) => personName(state, i.ownerId), cls: 'nowrap' },
            ],
          }),
          { id: 'exchanges' },
        ),
      );
    }

    if (audience === 'business') {
      const sync = state.ifaces.find((i) => i.id === 'INT-013');
      const syncAt = sync ? ifaceStatus(state, sync).run?.at : undefined;
      sections.push(
        panel(
          T('各據點狀態', 'Branch status'),
          table<Branch>({
            id: 'branch-table',
            caption: T('各據點狀態', 'Branch status'),
            empty: T('沒有據點資料。', 'No branches.'),
            rows: state.branches,
            cols: [
              { head: T('據點', 'Branch'), cell: (b) => tx(b.name), cls: 'nowrap' },
              { head: T('區域', 'Region'), cell: (b) => tx(b.region), cls: 'nowrap' },
              { head: T('人數', 'Staff'), cell: (b) => b.staff, cls: 'num' },
              { head: T('等核准的簽呈', 'Approvals pending'), cell: (b) => b.pendingApprovals, cls: 'num' },
              {
                head: T('客戶名單與人員歸屬', 'Customer lists and staff assignment'),
                cell: () =>
                  sync && syncAt ? html`${mark(ifaceStatus(state, sync).health, T('已更新', 'Up to date'))} <span class="num">${fmtStamp(syncAt)}</span>` : '–',
              },
              { head: T('這個據點的需求', 'Requests for this branch'), cell: (b) => state.demands.filter((d) => d.branchId === b.id).length, cls: 'num' },
            ],
          }),
        ),
      );
    }

    if (!tech && (audience === 'finance' || audience === 'hr' || audience === 'business')) {
      const dept = (d: Demand) =>
        audience === 'business' ? d.dept === 'sales' : audience === 'hr' ? d.dept === 'hr' : d.dept === 'finance' || d.dept === 'procurement';
      const STAGE: Record<Demand['stage'], string> = {
        submitted: T('已提出', 'Submitted'),
        assessing: T('評估中', 'Being assessed'),
        options: T('等決定', 'Awaiting decision'),
        decided: T('已決定', 'Decided'),
        scheduled: T('已排程', 'Scheduled'),
        declined: T('不做', 'Declined'),
      };
      sections.push(
        panel(
          audience === 'business'
            ? T('CRM 與業務系統的需求進度', 'Progress of CRM and sales system requests')
            : T('我們單位提的需求', 'Requests from our unit'),
          table<Demand>({
            id: 'demand-table',
            caption: T('需求進度', 'Request progress'),
            empty: T('你們單位還沒有提過需求。', 'Your unit has not submitted any request yet.'),
            rows: state.demands.filter(dept),
            cols: [
              {
                head: T('編號', 'ID'),
                cell: (d) =>
                  canOpen('/demands') ? html`<a class="num" href="${href('/demands', { req: d.id })}">${d.id}</a>` : html`<span class="num">${d.id}</span>`,
                cls: 'nowrap',
              },
              { head: T('需求', 'Request'), cell: (d) => tx(d.title), cls: 'wide' },
              {
                head: T('進度', 'Stage'),
                cell: (d) => tag(STAGE[d.stage], d.stage === 'options' ? 'warn' : d.stage === 'scheduled' || d.stage === 'decided' ? 'ok' : 'plain'),
                cls: 'nowrap',
              },
              { head: T('提出人', 'Raised by'), cell: (d) => personName(state, d.requesterId), cls: 'nowrap' },
              { head: T('提出日', 'Raised on'), cell: (d) => html`<span class="num">${d.createdAt}</span>`, cls: 'nowrap' },
            ],
          }),
          { id: 'requests' },
        ),
      );
    }

    setHtml(
      $('#ov-top', root),
      html`${pageHead(T('總覽', 'Overview'), html`${summary} <span class="muted">${T('資料時間 {t}', 'As of {t}', { t: `${fmtDay(TODAY)} ${fmtStamp(state.clock).split(' ')[1]}` })}</span>`)}
        ${statRow(stats)}`,
    );
    setHtml(
      $('#ov-rest', root),
      html`${sections}
        ${calendar(state, tech)}`,
    );
  }

  // 上、下兩塊跟著資料重畫；中間的 3D 區塊只建立一次，自己訂閱資料
  setHtml(root, html`<div class="page"><div class="stack-lg" id="ov-top"></div><div id="twin-slot"></div><div class="stack-lg" id="ov-rest"></div></div>`);
  const twin = mountTwinPanel($('#twin-slot', root), route);
  const off = store.subscribe(() => render());
  render();
  reveal();
  return {
    destroy() {
      off();
      twin.destroy();
    },
    route(next) {
      route = next;
      twin.route(next);
      render();
      reveal();
    },
  };
}
