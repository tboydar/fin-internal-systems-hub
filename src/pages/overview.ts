import { can } from '../core/auth';
import { fmtDay, fmtStamp } from '../core/date';
import { T, tx } from '../core/i18n';
import { closeCountdown, ifaceStatus, ifacesByHealth, ifacesOf, runsOf, systemHealth } from '../core/selectors';
import { store } from '../core/store';
import type { Domain, Health, Iface, RoleId, System } from '../core/types';
import { html, type Safe, setHtml } from '../ui/dom';
import type { PageHandle } from '../ui/shell';
import { mark, pageHead, panel, personName, runStrip, table, vendorName } from '../ui/widgets';

// 總覽。同一份資料，技術角色看到編號與原因，業務單位看到的是「哪件事會受影響」。

/** 業務單位的角色只看跟自己有關的領域。 */
const DOMAINS_OF: Partial<Record<RoleId, Domain[]>> = {
  finance: ['finance', 'procurement'],
  hr: ['hr'],
  business: ['sales'],
};

const RUN_HEALTH: Record<string, Health> = { ok: 'ok', retried: 'warn', late: 'warn', held: 'warn', fail: 'crit' };

export function mount(root: HTMLElement): PageHandle {
  function render(): void {
    const s = store.state;
    const role = store.prefs.role;
    const tech = can('iface.detail');
    const scope = DOMAINS_OF[role];
    const inScope = (i: Iface) => !scope || scope.includes(i.domain);
    const by = ifacesByHealth(s);
    const counts = { ok: by.ok.filter(inScope).length, warn: by.warn.filter(inScope).length, crit: by.crit.filter(inScope).length };
    const total = counts.ok + counts.warn + counts.crit;
    const c = closeCountdown();
    const attention = [...by.crit, ...by.warn].filter(inScope);

    const summary = tech
      ? T('{total} 條介面：{ok} 條正常、{warn} 條注意、{crit} 條中斷。', '{total} interfaces: {ok} OK, {warn} need attention, {crit} down.', {
          total,
          ...counts,
        })
      : T(
          '跟你有關的 {total} 項資料交換：{ok} 項正常、{warn} 項注意、{crit} 項中斷。',
          '{total} data exchanges that concern you: {ok} OK, {warn} need attention, {crit} down.',
          {
            total,
            ...counts,
          },
        );

    const strip = html`<div class="stat-row">
      <div class="stat"><span class="stat-k">${tech ? T('介面健康', 'Interface health') : T('資料交換', 'Data exchanges')}</span>
        <span class="stat-v">${mark('ok', String(counts.ok))}${mark('warn', String(counts.warn))}${mark('crit', String(counts.crit))}</span>
        <span class="stat-n">${tech ? T('共 {n} 條', '{n} in total', { n: total }) : T('共 {n} 項', '{n} in total', { n: total })}</span></div>
      <div class="stat"><span class="stat-k">${T('月結日', 'Month-end')}</span>
        <span class="stat-v num">${fmtDay(c.monthEnd)}</span>
        <span class="stat-n">${T('還有 {n} 個工作日', '{n} working {n|day|days} left', { n: c.toMonthEnd })}</span></div>
      <div class="stat"><span class="stat-k">${T('關帳日', 'Book closing')}</span>
        <span class="stat-v num">${fmtDay(c.closeDay)}</span>
        <span class="stat-n">${T('還有 {n} 個工作日', '{n} working {n|day|days} left', { n: c.toClose })}</span></div>
      <div class="stat"><span class="stat-k">${T('系統', 'Systems')}</span>
        <span class="stat-v num">${s.systems.length}</span>
        <span class="stat-n">${T('{n} 家委外廠商', '{n} outsourced {n|vendor|vendors}', { n: s.vendors.length })}</span></div>
    </div>`;

    const attentionTable = tech
      ? table<Iface>({
          caption: T('需要注意的介面', 'Interfaces needing attention'),
          empty: T('目前沒有需要注意的介面，24 條最近一次執行都成功。', 'Nothing needs attention: all 24 interfaces succeeded on their last run.'),
          rows: attention,
          cols: [
            { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(s, i).health), cls: 'nowrap' },
            { head: T('編號', 'ID'), cell: (i) => html`<span class="num">${i.id}</span>`, cls: 'nowrap' },
            { head: T('介面', 'Interface'), cell: (i) => tx(i.name) },
            { head: T('原因', 'Reason'), cell: (i) => tx(ifaceStatus(s, i).reason), cls: 'wide' },
            { head: T('最近一次', 'Last run'), cell: (i) => html`<span class="num">${fmtStamp(ifaceStatus(s, i).run?.at ?? '')}</span>`, cls: 'nowrap' },
            {
              head: T('最近 12 次', 'Last 12 runs'),
              cell: (i) =>
                runStrip(
                  runsOf(s, i.id)
                    .slice(0, 12)
                    .reverse()
                    .map((r) => RUN_HEALTH[r.status]),
                  T('最近 12 次執行的結果，由舊到新', 'Results of the last 12 runs, oldest first'),
                ),
            },
            { head: T('內部負責人', 'Owner'), cell: (i) => personName(s, i.ownerId), cls: 'nowrap' },
            { head: T('廠商', 'Vendor'), cell: (i) => vendorName(s, i.vendorId), cls: 'nowrap' },
          ],
        })
      : table<Iface>({
          caption: T('需要注意的事', 'Things that need attention'),
          empty: T('跟你有關的資料交換目前都正常。', 'All data exchanges that concern you are OK.'),
          rows: attention,
          cols: [
            { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(s, i).health), cls: 'nowrap' },
            { head: T('哪件事', 'What'), cell: (i) => tx(i.plain), cls: 'wide' },
            { head: T('資訊處的負責人', 'IT contact'), cell: (i) => personName(s, i.ownerId), cls: 'nowrap' },
          ],
        });

    const systems = table<System>({
      caption: T('系統清單', 'Systems'),
      empty: T('沒有系統資料。', 'No systems.'),
      rows: s.systems,
      cols: [
        { head: T('狀態', 'Status'), cell: (x) => mark(systemHealth(s, x)), cls: 'nowrap' },
        { head: T('系統', 'System'), cell: (x): Safe => (tech ? html`<span class="num muted">${x.code}</span> ${tx(x.name)}` : html`${tx(x.plain)}`) },
        { head: T('用途', 'Used for'), cell: (x) => tx(x.note), cls: 'wide' },
        { head: T('廠商', 'Vendor'), cell: (x) => vendorName(s, x.vendorId), cls: 'nowrap' },
        { head: T('內部負責人', 'Owner'), cell: (x) => personName(s, x.ownerId), cls: 'nowrap' },
        { head: T('介面數', 'Interfaces'), cell: (x) => ifacesOf(s, x.id).length, cls: 'num' },
      ],
    });

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(T('總覽', 'Overview'), summary)}
        ${strip}
        ${panel(tech ? T('需要注意的介面', 'Interfaces needing attention') : T('需要注意的事', 'Things that need attention'), attentionTable, {
          note: T('{n} 項', '{n} {n|item|items}', { n: attention.length }),
        })}
        ${panel(T('系統', 'Systems'), systems, { note: T('{n} 個', '{n} systems', { n: s.systems.length }) })}
      </div>`,
    );
  }

  const off = store.subscribe(() => render());
  render();
  return { destroy: off };
}
