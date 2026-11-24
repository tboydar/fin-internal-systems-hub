import { fmtDay, fmtHours, MONTH_END, two, weekdayName } from '../core/date';
import { T, tx } from '../core/i18n';
import { businessDay, type LocalClock, OPEN_HOURS, type SitesModel, type SiteView, SUPPORT_HOURS, sitesModel, tzOffsetMin } from '../core/sites';
import type { TwinModel } from '../core/twin';
import type { AppState, DcId, DrMode, L10n, RegionId, SystemId } from '../core/types';
import type { TwinLabel, TwinPlaces, TwinView } from '../three/twin';
import type { esc, html, num, raw, Safe } from './dom';
import type { facts, mark, table, tag } from './widgets';

// 「全台」與「海外」兩個比例尺的面板：標籤、資料卡、清單與營業日對照圖。
// 這個檔案跟 3D 的程式一樣是延遲載入的：首屏只帶「總行」需要的東西，
// 等首屏畫完才下載這一塊，所以首屏的大小不會因為多了兩個比例尺而變大。
//
// 畫 HTML 用的小工具（html、table、mark…）不直接 import，而是由面板借過來（ctx.ui）：
// 這一包如果自己去 import 首屏的 UI 模組，打包工具會把首屏拆成好幾個檔，壓縮之後反而比較大。

const REGION_IDS: RegionId[] = ['north', 'central', 'south'];

/** 面板（twinPanel.ts）借給這個模組用的東西：目前的路由、權限與共用的小工具。 */
export interface ScaleContext {
  view(): TwinView;
  query(key: string): string | null;
  /** 留在這一頁、只改查詢參數的連結。 */
  link(patch: Record<string, string | null>): string;
  tech(): boolean;
  sysLabel(state: AppState, id: SystemId): string;
  sysList(state: AppState, ids: SystemId[]): string;
  drMode: Record<DrMode, L10n>;
  ui: { html: typeof html; raw: typeof raw; esc: typeof esc; num: typeof num; facts: typeof facts; mark: typeof mark; table: typeof table; tag: typeof tag };
}

/** 據點在 3D 標籤上的短名稱：板橋分公司 → 板橋。 */
function shortName(name: L10n): string {
  if (name.zh === '總公司營業部') return T('營業部', 'HO Branch');
  return tx(name)
    .replace(/(分公司|分行|辦事處)$/, '')
    .replace(/ (Branch|Office)$/, '');
}

const clockText = (clock: LocalClock) => `${T('週', '')}${weekdayName(clock.weekday)} ${two(clock.hour)}:${two(clock.minute)}`;

/** 把「從月結日 00:00 起算的小時數」寫成時間：22.5 → 22:30；31 → 隔天 07:00。 */
function atText(hours: number): string {
  const h = Math.floor(hours);
  const time = `${two(h % 24)}:${two(Math.round((hours - h) * 60))}`;
  return h >= 24 ? T('隔天 {t}', '{t} next day', { t: time }) : time;
}

function gapText(offsetMin: number): string {
  const hours = (offsetMin - 480) / 60;
  if (hours === 0) return T('跟台北同一個時區', 'Same zone as Taipei');
  return hours > 0 ? T('比台北快 {n} 小時', '{n} h ahead of Taipei', { n: hours }) : T('比台北慢 {n} 小時', '{n} h behind Taipei', { n: -hours });
}

export function createScales(ctx: ScaleContext) {
  const { html, raw, esc, num, facts, mark, table, tag } = ctx.ui;
  const region = (): RegionId | null => (ctx.view() === 'tw' ? (REGION_IDS.find((id) => id === ctx.query('region')) ?? null) : null);

  /** 網址上選的據點；不屬於目前這個比例尺的不算。 */
  function pickedSite(sites: SitesModel): string | null {
    const id = ctx.query('site');
    if (ctx.view() === 'hq' || !id) return null;
    const known =
      ctx.view() === 'tw'
        ? [...sites.dcs.map((d) => d.id as string), ...sites.sites.filter((s) => s.kind === 'branch').map((s) => s.id)]
        : ['dc-hq', ...sites.sites.filter((s) => s.kind === 'overseas').map((s) => s.id)];
    return known.includes(id) ? id : null;
  }

  /** 3D 要蓋模型用的位置。海外據點站在哪一格，由月結日中午的時差決定。 */
  function places(state: AppState): TwinPlaces {
    const noon = `${MONTH_END}T12:00:00+08:00`;
    return {
      island: {
        branches: state.branches.map((b) => ({ id: b.id, lon: b.lon, lat: b.lat, staff: b.staff, regionId: b.regionId })),
        dcs: state.dataCentres.map((d) => ({ id: d.id, lon: d.lon, lat: d.lat })),
      },
      zones: [
        { id: 'dc-hq', offsetHr: tzOffsetMin('Asia/Taipei', noon) / 60, lat: 25.04, staff: 0, hq: true },
        ...state.overseas.map((o) => ({ id: o.id, offsetHr: tzOffsetMin(o.tz, noon) / 60, lat: o.lat, staff: o.staff, hq: false })),
      ],
    };
  }

  function labels(model: TwinModel, sites: SitesModel): TwinLabel[] {
    const picked = pickedSite(sites);
    if (ctx.view() === 'tw') {
      const dcShort: Record<DcId, string> = { 'dc-hq': T('總行', 'Head office'), 'dc-dr': T('備援中心', 'DR centre'), 'dc-vendor': T('廠商機房', 'Vendor DC') };
      return [
        ...sites.dcs.map(
          (dc): TwinLabel => ({
            key: `site:${dc.id}`,
            kind: 'site',
            text: dc.id === 'dc-dr' && model.drill ? T('備援中心 接手 {n}', 'DR centre: {n} running', { n: dc.running.length }) : dcShort[dc.id],
            title: T('{name}（{role}）', '{name} ({role})', { name: tx(dc.name), role: tx(dc.role) }),
            health: dc.health,
            selected: dc.id === picked,
            pick: { kind: 'site', id: dc.id },
          }),
        ),
        ...sites.sites
          .filter((s) => s.kind === 'branch')
          .map(
            (s): TwinLabel => ({
              key: `site:${s.id}`,
              kind: 'site',
              text: shortName(s.name),
              title: tx(s.name),
              health: s.health,
              selected: s.id === picked,
              quiet: !s.open,
              pick: { kind: 'site', id: s.id },
            }),
          ),
        ...sites.regions
          .filter((r) => r.id !== 'overseas')
          .map(
            (r): TwinLabel => ({
              key: `region:${r.id}`,
              kind: 'region',
              text: T('{name} {n} 處', '{name}: {n}', { name: tx(r.name), n: r.sites.length }),
              title: T('{name}：只看這一區的據點', '{name}: show only this region', { name: tx(r.name) }),
              selected: r.id === region(),
              affected: r.health === 'crit',
              pick: { kind: 'region', id: r.id },
            }),
          ),
        { key: 'note:north', kind: 'note', text: T('北', 'N'), title: T('北方', 'North') },
      ];
    }
    const hq = sites.dcs.find((d) => d.id === 'dc-hq');
    return [
      {
        key: 'site:dc-hq',
        kind: 'site',
        text: `${T('台北', 'Taipei')} ${clockText(sites.taipei)}`,
        title: T('總行（台北）', 'Head office (Taipei)'),
        health: hq?.health,
        selected: picked === 'dc-hq',
        pick: { kind: 'site', id: 'dc-hq' },
      },
      ...sites.sites
        .filter((s) => s.kind === 'overseas')
        .map(
          (s): TwinLabel => ({
            key: `site:${s.id}`,
            kind: 'site',
            text: `${tx(s.city)} ${clockText(s.clock)}`,
            title: s.open ? T('{name}：上班中', '{name}: open', { name: tx(s.name) }) : T('{name}：休息', '{name}: closed', { name: tx(s.name) }),
            health: s.health,
            selected: s.id === picked,
            quiet: !s.open,
            pick: { kind: 'site', id: s.id },
          }),
        ),
      ...sites.strips.map(
        (strip): TwinLabel => ({
          key: `tick:${strip.offset}`,
          kind: 'tick',
          text: two(strip.hour),
          title: T('UTC{o}：當地 {h} 點', 'UTC{o}: {h}:00 local', { o: `${strip.offset >= 0 ? '+' : ''}${strip.offset}`, h: two(strip.hour) }),
          quiet: !strip.working,
        }),
      ),
      { key: 'note:noon', kind: 'note', text: T('正午', 'Noon'), title: T('當地正午在這一格', 'Local noon is on this strip') },
    ];
  }

  function dcCard(state: AppState, id: string, sites: SitesModel): Safe {
    const dc = sites.dcs.find((d) => d.id === id);
    if (!dc) return html``;
    const rebuilt = state.systems.filter((s) => s.dcId === 'dc-hq' && s.dr.mode === 'backup').map((s) => s.id);
    return html`<div class="twin-card" id="twin-site-card">
      <h3>${tx(dc.name)} ${tag(tx(dc.role), 'primary')}</h3>
      <p>${mark(dc.health)} ${tx(dc.note)}</p>
      ${facts([
        [T('城市', 'City'), tx(dc.city)],
        [T('現在在這裡跑的系統', 'Systems running here now'), ctx.sysList(state, dc.running)],
        ...(dc.down.length ? [[T('停著的系統', 'Systems down'), ctx.sysList(state, dc.down)] as [string, string]] : []),
        ...(dc.id === 'dc-dr'
          ? ([
              [T('有待命環境的', 'With a standby environment'), ctx.sysList(state, dc.standby)],
              [T('只有備份、要在這裡重建的', 'Backup only, rebuilt here'), ctx.sysList(state, rebuilt)],
            ] as [string, string][])
          : []),
      ])}
      <div class="actions">
        ${dc.id === 'dc-hq' ? html`<a class="btn btn-sm" href="${ctx.link({ focus: null, what: null, floor: null, site: null, region: null, view: null })}" data-fk="twin-to-hq">${T('進總行看剖面', 'Open the head office section')}</a>` : ''}
        <a class="btn btn-sm" href="${ctx.link({ site: null })}" data-fk="twin-site-close">${T('關閉', 'Close')}</a>
      </div>
    </div>`;
  }

  function siteCard(state: AppState, s: SiteView, sites: SitesModel): Safe {
    const home = sites.dcs.find((d) => d.id === s.home);
    const row = s.kind === 'overseas' ? businessDay(state).rows.find((r) => r.id === s.id) : undefined;
    const demands = state.demands.filter((d) => d.branchId === s.id).length;
    const status = s.blockedBy.length ? T('連不上：{list} 停了', 'Cut off: {list} down', { list: ctx.sysList(state, s.blockedBy) }) : undefined;
    return html`<div class="twin-card" id="twin-site-card">
      <h3>${tx(s.name)} ${s.open ? tag(T('上班中', 'Open'), 'ok') : tag(T('休息', 'Closed'))}</h3>
      <p>${mark(s.health, status)} ${T('連到{dc}。', 'Connected to the {dc}.', { dc: tx(home?.name) })}</p>
      ${facts([
        ...(s.kind === 'overseas'
          ? ([
              [T('當地時間', 'Local time'), T('{t}（{gap}）', '{t} ({gap})', { t: clockText(s.clock), gap: gapText(s.clock.offsetMin) })],
              [T('時區', 'Time zone'), s.tz],
            ] as [string, string][])
          : ([[T('區域', 'Region'), tx(sites.regions.find((r) => r.id === s.regionId)?.name)]] as [string, string][])),
        [T('人數', 'Staff'), num(s.staff)],
        [T('等核准的簽呈', 'Approvals pending'), T('{n} 件', '{n}', { n: s.pendingApprovals })],
        ...(s.kind === 'branch' ? ([[T('這個據點的需求', 'Requests for this branch'), T('{n} 件', '{n}', { n: demands })]] as [string, string][]) : []),
        [
          T('每天在用的系統', 'Systems used daily'),
          ctx.sysList(
            state,
            state.systems.filter((x) => x.usedBy.includes('sales')).map((x) => x.id),
          ),
        ],
        ...(s.open && s.overlaps.length
          ? ([
              [
                T('這個小時撞到的批次', 'Batches running this hour'),
                ctx.tech() ? s.overlaps.join(T('、', ', ')) : T('{n} 條', '{n}', { n: s.overlaps.length }),
              ],
            ] as [string, string][])
          : []),
        ...(s.uncovered
          ? ([[T('台北的支援', 'Taipei support'), T('一般支援不在，只有值班', 'Regular support is off; on-call only')]] as [string, string][])
          : []),
        ...(row
          ? ([
              [
                T('月結日的上班時間', 'Working hours on month-end day'),
                T('台北時間 {a} 到 {b}', '{a} to {b} Taipei time', { a: atText(row.openAt), b: atText(row.closeAt) }),
              ],
              [T('上班時會遇到的批次', 'Batches during working hours'), T('{n} 條', '{n}', { n: row.overlaps.length })],
              [
                T('台北一般支援不在', 'Without regular Taipei support'),
                T('{n}／{all} 小時', '{n} of {all} h', { n: row.uncoveredHr, all: OPEN_HOURS.to - OPEN_HOURS.from }),
              ],
            ] as [string, string][])
          : []),
      ])}
      <div class="actions"><a class="btn btn-sm" href="${ctx.link({ site: null })}" data-fk="twin-site-close">${T('關閉', 'Close')}</a></div>
    </div>`;
  }

  function regionCard(id: RegionId, sites: SitesModel): Safe {
    const r = sites.regions.find((x) => x.id === id);
    if (!r) return html``;
    return html`<div class="twin-card" id="twin-region-card">
      <h3>${tx(r.name)}</h3>
      <p>${mark(r.health)} ${T('下面的清單只列這一區。', 'The list below shows only this region.')}</p>
      ${facts([
        [T('據點', 'Branches'), T('{n} 處，{o} 處上班中', '{n}, {o} open', { n: r.sites.length, o: r.open })],
        [T('人數', 'Staff'), num(r.staff)],
        [T('等核准的簽呈', 'Approvals pending'), T('{n} 件', '{n}', { n: r.pendingApprovals })],
      ])}
      <div class="actions"><a class="btn btn-sm" href="${ctx.link({ region: null })}" data-fk="twin-region-close">${T('看全部', 'Show all')}</a></div>
    </div>`;
  }

  function sitesTable(sites: SitesModel, id: string): Safe {
    const only = region();
    const picked = pickedSite(sites);
    const rows = [
      ...(only
        ? []
        : sites.dcs.map((dc) => ({
            id: dc.id as string,
            name: tx(dc.name),
            where: tx(dc.city),
            health: dc.health,
            staff: null as number | null,
            pending: null as number | null,
          }))),
      ...sites.sites
        .filter((s) => s.kind === 'branch' && (!only || s.regionId === only))
        .map((s) => ({
          id: s.id,
          name: tx(s.name),
          where: tx(sites.regions.find((r) => r.id === s.regionId)?.name),
          health: s.health,
          staff: s.staff,
          pending: s.pendingApprovals,
        })),
    ];
    return table({
      id,
      caption: T('機房與據點', 'Data centres and branches'),
      empty: T('這一區沒有據點。', 'No branches in this region.'),
      rows,
      cols: [
        { head: T('狀態', 'Status'), cell: (r) => mark(r.health), cls: 'nowrap' },
        {
          head: T('機房或據點', 'Site'),
          cell: (r) =>
            html`<button type="button" class="btn btn-sm" data-site="${r.id}" data-fk="site:${r.id}" aria-pressed="${String(r.id === picked)}">${r.name}</button>`,
          cls: 'nowrap',
        },
        { head: T('在哪', 'Where'), cell: (r) => r.where, cls: 'nowrap' },
        { head: T('人數', 'Staff'), cell: (r) => (r.staff === null ? '–' : num(r.staff)), cls: 'num' },
        { head: T('等核准', 'Pending'), cell: (r) => (r.pending === null ? '–' : num(r.pending)), cls: 'num' },
      ],
    });
  }

  function drTable(state: AppState, model: TwinModel): Safe {
    const drill = model.drill;
    return table({
      id: 'twin-dr',
      caption: T('每個系統放在哪、備援到什麼程度', 'Where each system runs and how well it is protected'),
      empty: '',
      rows: state.systems,
      cols: [
        { head: T('系統', 'System'), cell: (s) => ctx.sysLabel(state, s.id), cls: 'nowrap' },
        { head: T('放在哪', 'Hosted at'), cell: (s) => tx(state.dataCentres.find((d) => d.id === s.dcId)?.city), cls: 'nowrap' },
        { head: T('異地備援', 'Disaster recovery'), cell: (s) => tx(ctx.drMode[s.dr.mode]) },
        { head: T('多久回來', 'Back within'), cell: (s) => fmtHours(s.dr.rtoHr), cls: 'num' },
        { head: T('最多掉多久的資料', 'Data at risk'), cell: (s) => fmtHours(s.dr.rpoMin / 60), cls: 'num' },
        ...(drill
          ? [
              {
                head: T('演練', 'Drill'),
                cell: (s: (typeof state.systems)[number]) =>
                  drill.down.includes(s.id)
                    ? mark('crit', T('還沒回來', 'Not back'))
                    : drill.recovered.includes(s.id)
                      ? mark('ok', T('已接手', 'Running'))
                      : mark('ok', T('不受影響', 'Unaffected')),
                cls: 'nowrap' as const,
              },
            ]
          : []),
      ],
    });
  }

  function clocksTable(sites: SitesModel, id: string): Safe {
    const picked = pickedSite(sites);
    const rows = [
      {
        id: 'dc-hq',
        name: T('總行（台北）', 'Head office (Taipei)'),
        clock: sites.taipei,
        open: sites.sites.find((s) => s.id === 'br-hq')?.open ?? false,
        overlaps: 0,
        uncovered: false,
      },
      ...sites.sites
        .filter((s) => s.kind === 'overseas')
        .map((s) => ({ id: s.id, name: tx(s.name), clock: s.clock, open: s.open, overlaps: s.overlaps.length, uncovered: s.uncovered })),
    ].sort((a, b) => b.clock.offsetMin - a.clock.offsetMin);
    return table({
      id,
      caption: T('各地現在幾點', 'Local time at each site'),
      empty: '',
      rows,
      cols: [
        {
          head: T('據點', 'Site'),
          cell: (r) =>
            html`<button type="button" class="btn btn-sm" data-site="${r.id}" data-fk="site:${r.id}" aria-pressed="${String(r.id === picked)}">${r.name}</button>`,
          cls: 'nowrap',
        },
        { head: T('當地時間', 'Local time'), cell: (r) => html`<span class="num">${clockText(r.clock)}</span>`, cls: 'nowrap' },
        { head: T('現在', 'Now'), cell: (r) => (r.open ? tag(T('上班中', 'Open'), 'ok') : tag(T('休息', 'Closed'))), cls: 'nowrap' },
        { head: T('撞到的批次', 'Batches hit'), cell: (r) => (r.open ? num(r.overlaps) : '–'), cls: 'num' },
        {
          head: T('台北支援', 'Taipei support'),
          cell: (r) => (!r.open ? '–' : r.uncovered ? mark('warn', T('只有值班', 'On-call only')) : mark('ok', T('有人', 'Staffed'))),
          cls: 'nowrap',
        },
      ],
    });
  }

  /** 右欄：資料卡與清單。extra 是面板自己的演練說明與影響範圍，插在資料卡後面。 */
  function side(state: AppState, model: TwinModel, sites: SitesModel, extra: Safe): Safe {
    const picked = pickedSite(sites);
    const s = sites.sites.find((x) => x.id === picked);
    if (ctx.view() === 'tw') {
      const r = region();
      return html`${
        s
          ? siteCard(state, s, sites)
          : picked
            ? dcCard(state, picked, sites)
            : r
              ? regionCard(r, sites)
              : html`<p class="hint">${T('還沒選東西。點機房、據點或區域；據點下班之後線上就沒有紙片。', 'Nothing selected. Select a data centre, a branch or a region; once branches close, the lines go quiet.')}</p>`
      }${extra}
        <h3>${T('機房與據點', 'Data centres and branches')}</h3>${sitesTable(sites, 'twin-sites')}
        <h3>${T('每個系統放在哪、備援到什麼程度', 'Where each system runs and how well it is protected')}</h3>${drTable(state, model)}`;
    }
    const open = sites.sites.filter((x) => x.kind === 'overseas' && x.open);
    return html`${
      s
        ? siteCard(state, s, sites)
        : picked
          ? dcCard(state, picked, sites)
          : html`<p class="hint">${T('還沒選東西。點一個據點看它的時鐘；拉下面的時間軸，看白天與上班時段怎麼移動。', 'Nothing selected. Select a site for its clock; drag the timeline below to watch daylight and working hours move.')}</p>`
    }${extra}
      <p class="twin-now" id="twin-world-now">${T('台北 {t}：海外 {n} 處上班中', 'Taipei {t}: {n} overseas sites open', { t: clockText(sites.taipei), n: open.length })}${
        open.some((x) => x.overlaps.length)
          ? T('，其中 {n} 處撞到正在跑的批次', ', {n} of them during running batches', { n: open.filter((x) => x.overlaps.length).length })
          : ''
      }${sites.supportOn ? T('；台北的一般支援有人。', '; regular Taipei support is staffed.') : T('；台北只有值班。', '; Taipei is on-call only.')}</p>
      <h3>${T('各地現在幾點', 'Local time at each site')}</h3>${clocksTable(sites, 'twin-clocks')}`;
  }

  /** 月結日這個營業日在各地是台北的幾點到幾點。只在「海外」這個比例尺顯示。 */
  function day(state: AppState, model: TwinModel): Safe {
    if (ctx.view() !== 'world') return html``;
    const d = businessDay(state);
    const X0 = 118;
    const PER = 16;
    const ROW = 20;
    const TOP = 18;
    const width = X0 + (d.window.to - d.window.from) * PER + 26;
    const height = TOP + d.rows.length * ROW + 6;
    const x = (h: number) => X0 + (h - d.window.from) * PER;
    const parts: string[] = [];
    for (const s of d.support)
      parts.push(
        `<rect class="is-support" x="${x(s.from)}" y="${TOP - 4}" width="${(s.to - s.from) * PER}" height="${d.rows.length * ROW + 6}"><title>${esc(T('台北一般支援', 'Regular Taipei support'))} ${esc(atText(s.from))}–${esc(atText(s.to))}</title></rect>`,
      );
    for (let h = d.window.from; h <= d.window.to; h += 6)
      parts.push(
        `<line class="is-grid" x1="${x(h)}" x2="${x(h)}" y1="${TOP - 4}" y2="${height - 2}" /><text class="is-axis" x="${x(h)}" y="10" text-anchor="middle">${esc(h >= 24 ? T('隔天 ', '+1d ') : '')}${two(h % 24)}</text>`,
      );
    for (const b of d.batches)
      parts.push(
        `<line class="is-batch${b.touches ? ' is-touch' : ''}" x1="${x(b.at)}" x2="${x(b.at)}" y1="${TOP - 4}" y2="${height - 2}"><title>${esc(b.ifaceId)} ${esc(atText(b.at))}</title></line>`,
      );
    d.rows.forEach((r, i) => {
      const y = TOP + i * ROW;
      parts.push(`<text class="is-name" x="${X0 - 8}" y="${y + 11}" text-anchor="end">${esc(tx(r.name))}</text>`);
      parts.push(
        `<rect class="is-open" x="${x(r.openAt)}" y="${y + 2}" width="${(r.closeAt - r.openAt) * PER}" height="12"><title>${esc(tx(r.name))} ${esc(atText(r.openAt))}–${esc(atText(r.closeAt))}</title></rect>`,
      );
      // 上班時段裡遇到的批次：三角形，跟「注意」同一個形狀
      for (const hit of r.overlaps)
        parts.push(
          `<path class="is-hit" d="M${x(hit.at) - 4} ${y + 13}L${x(hit.at) + 4} ${y + 13}L${x(hit.at)} ${y + 3}Z"><title>${esc(hit.ifaceId)} ${esc(atText(hit.at))}</title></path>`,
        );
    });
    if (model.replay) parts.push(`<line class="is-now" x1="${x(model.hour)}" x2="${x(model.hour)}" y1="2" y2="${height - 2}" />`);
    const hit = d.rows.filter((r) => r.overlaps.length);
    const last = [...d.rows].sort((a, b) => b.closeAt - a.closeAt)[0];
    const worst = [...d.rows].sort((a, b) => b.uncoveredHr - a.uncoveredHr)[0];
    return html`<h3>${T('月結日 {d} 這個營業日，各地是台北的幾點到幾點', 'Month-end day {d} as a working day, in Taipei time at each site', { d: fmtDay(d.day) })}</h3>
      <p id="twin-day-sum">${T('從最早開門到最晚關門要 {n} 小時。', 'From the first site opening to the last one closing takes {n} hours.', { n: d.span.hours })}${
        last && last.closeAt > 24
          ? last.openAt >= 24
            ? T('台北的月結日過完時，{name}的同一天還沒開始上班。', ' When month-end day is over in Taipei, the same day has not yet started at {name}.', {
                name: shortName(last.name),
              })
            : T('台北的月結日過完時，{name}的同一天還沒下班。', ' When month-end day is over in Taipei, the same day is still running at {name}.', {
                name: shortName(last.name),
              })
          : ''
      }${
        hit.length
          ? T('總行的夜間批次會落在{list}的上班時間裡。', ' Head office night batches fall inside working hours at {list}.', {
              list: hit.map((r) => shortName(r.name)).join(T('、', ', ')),
            })
          : ''
      }${
        worst?.uncoveredHr
          ? T(
              '{name}上班的 {all} 小時裡，有 {n} 小時台北的一般支援（{a}:00–{b}:00）不在。',
              ' Of the {all} working hours at {name}, {n} fall outside regular Taipei support ({a}:00–{b}:00).',
              {
                name: shortName(worst.name),
                all: OPEN_HOURS.to - OPEN_HOURS.from,
                n: worst.uncoveredHr,
                a: two(SUPPORT_HOURS.from),
                b: two(SUPPORT_HOURS.to),
              },
            )
          : ''
      }</p>
      <div class="twin-day-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${T('各據點在月結日的上班時段，換成台北時間。同樣的數字在下面的表格裡。', 'Working hours at each site on month-end day, in Taipei time. The same numbers are in the table below.')}">${raw(parts.join(''))}</svg></div>
      <p class="muted twin-day-key"><i class="is-open"></i>${T('上班時段', 'Working hours')} <i class="is-support"></i>${T('台北一般支援', 'Regular Taipei support')} <i class="is-batch"></i>${T('總行的批次', 'Head office batch')} <i class="is-hit"></i>${T('上班時遇到批次。', 'Batch during working hours.')}
        ${T('各地只算週一到週五 {a}:00–{b}:00，當地假日沒有算進來。', 'Each site counts Monday to Friday {a}:00–{b}:00 only; local holidays are not included.', { a: two(OPEN_HOURS.from), b: two(OPEN_HOURS.to) })}</p>
      ${table({
        id: 'twin-day-table',
        caption: T('月結日各據點的上班時段（台北時間）', 'Working hours at each site on month-end day (Taipei time)'),
        empty: '',
        rows: d.rows,
        cols: [
          { head: T('據點', 'Site'), cell: (r) => tx(r.name), cls: 'nowrap' },
          { head: T('跟台北差', 'Versus Taipei'), cell: (r) => gapText(r.offsetMin), cls: 'nowrap' },
          {
            head: T('上班（台北時間）', 'Open (Taipei time)'),
            cell: (r) => html`<span class="num">${atText(r.openAt)}–${atText(r.closeAt)}</span>`,
            cls: 'nowrap',
          },
          { head: T('遇到的批次', 'Batches hit'), cell: (r) => num(r.overlaps.length), cls: 'num' },
          { head: T('一般支援不在', 'No regular support'), cell: (r) => T('{n} 小時', '{n} h', { n: r.uncoveredHr }), cls: 'num' },
        ],
      })}`;
  }

  /** 沒有 WebGL 時，放在 3D 位置上的清單。 */
  function fallback(sites: SitesModel): Safe {
    return ctx.view() === 'tw' ? sitesTable(sites, 'twin-fallback-sites') : clocksTable(sites, 'twin-fallback-clocks');
  }

  return { sitesModel, pickedSite, region, places, labels, side, day, fallback };
}

export type Scales = ReturnType<typeof createScales>;
