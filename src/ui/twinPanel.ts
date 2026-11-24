import { toggleFault } from '../core/actions';
import { can } from '../core/auth';
import { fmtDay, fmtHours, MONTH_END, two } from '../core/date';
import { L, T, tx } from '../core/i18n';
import { type Route, setQuery } from '../core/router';
import { ifaceStatus, ifacesOf, impactOf } from '../core/selectors';
import { store } from '../core/store';
import { dayProfile, FLOORS, RACKS, type TwinModel, twinModel } from '../core/twin';
import type { AppState, Domain, DrMode, L10n, SystemId } from '../core/types';
import type { TwinHandle, TwinLabel, TwinPick, TwinView } from '../three/twin';
import { $, esc, html, num, on, raw, type Safe, setHtml, toast } from './dom';
import { canOpen } from './shell';
import type { Scales } from './twinScales';
import { actionBtn, facts, healthLabel, mark, personName, table, tag, vendorName } from './widgets';

// 總覽上的「微縮總行」區塊：左邊是 3D 場景、圖例與時間軸，右邊是資料卡與清單。
//
// 3D 有三個比例尺，像事務所同一個案子做的三個模型：
//   總行：一棟剖開的總行，看系統與單位
//   全台：三個機房與 8 處據點，看據點、區域與備援
//   海外：時區桌，看各地的時鐘與總行的批次怎麼撞在一起
// 三個比例尺共用同一條時間軸、同一份故障與演練的狀態；3D 與右邊的清單都由
// twinModel() 與 sitesModel() 的同一份結果畫出來。
//
// 首屏只帶「總行」需要的東西。3D 的程式（three/）與另外兩個比例尺的面板（twinScales.ts）
// 都等首屏畫完才下載。沒有 WebGL 時，左邊改成同一份資料的表格，其他都照常。

const DOMAIN_LABEL = Object.fromEntries(FLOORS.map((f) => [f.domain, f.name]));

const VIEWS: { id: TwinView; name: L10n; note: L10n; aria: L10n; key: L10n }[] = [
  {
    id: 'hq',
    name: L('總行', 'Head office'),
    note: L(
      '沿著正面剖開的總行：樓層是單位，地下機房的機櫃是系統，右邊的小房子是營業據點。機櫃、樓層、小房子都可以點；拖曳可以轉動。',
      'A head office cut open along its front: floors are units, basement racks are systems, the houses on the right are the branches. Racks, floors and houses are all selectable; drag to turn the model.',
    ),
    aria: L(
      '微縮總行的 3D 剖面圖。同樣的內容在右邊的清單與下面的表格裡。',
      'A 3D section of the miniature head office. The same content is in the list on the right and the tables below.',
    ),
    key: L('小紙片是傳票與簽呈：越快流量越大，停住的是中斷', 'Paper slips are vouchers and approvals: faster means more volume, a stopped slip is a failure'),
  },
  {
    id: 'tw',
    name: L('全台', 'Taiwan'),
    note: L(
      '三個機房與 8 處營業據點，北在左、南在右。灰色的帶子是骨幹線路；據點旁邊的一疊紙是等核准的簽呈。位置是示意，不是地圖。',
      'Three data centres and eight branches, north on the left. The grey ribbon is the backbone line; the stack of paper beside a branch is its approvals waiting. Positions are schematic, not a map.',
    ),
    aria: L(
      '全台的 3D 模型：三個機房與 8 處營業據點。同樣的內容在右邊的清單裡。',
      'A 3D model of Taiwan: three data centres and eight branches. The same content is in the list on the right.',
    ),
    key: L(
      '帶子上的紙片是據點與機房之間的往來，停住代表連不上；據點旁的一疊紙是等核准的簽呈',
      'Slips on the ribbon are traffic between sites and data centres; a stopped slip means no connection. The stack beside a branch is approvals waiting',
    ),
  },
  {
    id: 'world',
    name: L('海外', 'Overseas'),
    note: L(
      '一張時區桌：每一格是一個時區，據點站在自己那一格上。格子的深淺是當地的白天或晚上，前緣的深色短條是當地的上班時段。',
      'A time-zone table: each strip is one zone and every site stands on its own. Strip shade is local day or night; the dark bar along the front edge is local working hours.',
    ),
    aria: L(
      '時區桌的 3D 模型：總行與 6 處海外據點各在自己的時區。同樣的內容在右邊的清單與下面的圖表裡。',
      'A 3D time-zone table: the head office and six overseas sites, each in its own zone. The same content is in the list on the right and the chart below.',
    ),
    key: L(
      '上班中的據點才有紙片往總行送；球是當地正午，會跟著時間往左移',
      'Only sites in working hours send slips to the head office; the ball marks local noon and moves left as time passes',
    ),
  },
];

const DR_MODE: Record<DrMode, L10n> = {
  replica: L('即時複寫，隨時可以切過去', 'Live replica, ready to switch'),
  standby: L('定時複寫，人工切換', 'Scheduled copy, manual switch'),
  backup: L('只有每日備份，要重建', 'Daily backup only, must be rebuilt'),
};

const NO_PICK = { focus: null, what: null, floor: null, site: null, region: null };

function loadLazy(): Promise<typeof import('./twinLazy')> {
  return import('./twinLazy');
}

export function mountTwinPanel(host: HTMLElement, first: Route): { route(next: Route): void; destroy(): void } {
  let route = first;
  let twin: TwinHandle | null = null;
  /** 另外兩個比例尺的面板；還沒下載完是 null。 */
  let scales: Scales | null = null;
  let failed = false;
  let disposed = false;
  /** null 是「現在」；0–23 是重播月結日的那個小時。 */
  let hour: number | null = null;
  let timer = 0;

  const q = (key: string) => route.query.get(key);
  const view = (): TwinView => (q('view') === 'tw' || q('view') === 'world' ? (q('view') as TwinView) : 'hq');
  const now = () => VIEWS.find((v) => v.id === view()) ?? VIEWS[0];
  const selected = () => (view() === 'hq' ? ((RACKS.find((id) => id === q('focus')) ?? null) as SystemId | null) : null);
  const floor = (): Domain | null => (view() === 'hq' && !selected() ? (FLOORS.find((f) => f.domain === q('floor'))?.domain ?? null) : null);
  const probe = () => (q('what') === 'if' ? selected() : null);
  const drillStep = () => (q('drill') === null ? null : Number(q('drill')) || 0);
  const tech = () => can('iface.detail');
  const sysLabel = (state: AppState, id: SystemId) => {
    const sys = state.systems.find((s) => s.id === id);
    return tech() ? (sys?.code ?? id) : tx(sys?.plain);
  };
  const sysList = (state: AppState, ids: SystemId[]) => (ids.length ? ids.map((id) => sysLabel(state, id)).join(T('、', ', ')) : T('沒有', 'none'));
  /** 留在這一頁、只改查詢參數的連結。 */
  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(route.query);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return `#${route.path}${qs ? `?${qs}` : ''}`;
  };

  setHtml(
    host,
    html`<section class="panel" id="twin">
      <div class="panel-head" id="twin-head"></div>
      <div class="twin-grid">
        <div class="twin-left">
          <div class="twin-stage" id="twin-stage"><div class="twin-labels" id="twin-labels"></div><p class="twin-msg" id="twin-msg">${T('3D 場景載入中', 'Loading the 3D scene')}</p>
            <button type="button" class="btn btn-sm twin-reset" id="twin-reset" hidden>${T('重設視角', 'Reset the view')}</button></div>
          <div class="twin-key" id="twin-key"></div>
          <div class="twin-time" id="twin-time"></div>
          <div class="twin-day" id="twin-day"></div>
        </div>
        <div class="twin-side" id="twin-side" aria-live="polite"></div>
      </div>
    </section>`,
  );
  const stage = $('#twin-stage', host);
  const side = $('#twin-side', host);
  const time = $('#twin-time', host);

  // ── 總行這個比例尺的標籤：文字、狀態與「點了會怎樣」都在這裡決定，3D 那邊只負責擺位置
  function hqLabels(state: AppState, model: TwinModel): TwinLabel[] {
    return [
      ...RACKS.map((id): TwinLabel => {
        const sys = state.systems.find((s) => s.id === id);
        const live = model.systems.find((s) => s.id === id);
        const away = live?.place === 'dc-dr';
        const name = tech() ? tx(sys?.name) : tx(sys?.plain);
        return {
          key: `system:${id}`,
          kind: 'system',
          text: sys?.code ?? id,
          title: away ? T('{name}：已在備援中心接手', '{name}: running at the DR centre', { name }) : `${name}${T('：看資料卡', ': open data card')}`,
          health: model.down.includes(id) ? 'crit' : (live?.health ?? 'ok'),
          selected: id === selected(),
          quiet: away,
          pick: { kind: 'system', id },
        };
      }),
      ...model.floors.map(
        (f): TwinLabel => ({
          key: `floor:${f.domain}`,
          kind: 'floor',
          text: tx(DOMAIN_LABEL[f.domain]),
          title: T('{name}：看這個單位的介面', '{name}: show this unit’s interfaces', { name: tx(DOMAIN_LABEL[f.domain]) }),
          health: f.health,
          affected: f.affected,
          selected: f.domain === floor(),
          pick: { kind: 'floor', id: f.domain },
        }),
      ),
      {
        key: 'link:branches',
        kind: 'link',
        text: T('營業據點 {n} 處', '{n} branches', { n: state.branches.length }),
        title: T('換到「全台」，看每一處據點', 'Switch to Taiwan to see each branch'),
        pick: { kind: 'view', id: 'tw' },
      },
    ];
  }

  // ── 區塊標題：比例尺切換、說明、演練與降低特效
  function renderHead(model: TwinModel): void {
    setHtml(
      $('#twin-head', host),
      html`<h2>${T('微縮總行', 'Miniature head office')}</h2>
        <div class="seg" id="twin-views" role="group" aria-label="${T('比例尺', 'Scale')}">${VIEWS.map(
          (v) => html`<button type="button" data-view="${v.id}" data-fk="twin-view:${v.id}" aria-pressed="${String(v.id === view())}">${tx(v.name)}</button>`,
        )}</div>
        <span class="panel-note" id="twin-note">${tx(now().note)}</span>
        <div class="actions">
          <a class="btn btn-sm" id="twin-drill-toggle" data-fk="twin-drill-toggle" href="${link({ drill: model.drill ? null : '0', what: null })}">${model.drill ? T('結束演練', 'End the drill') : T('演練：總行機房停擺', 'Drill: head office data centre lost')}</a>
          <label class="check"><input type="checkbox" id="twin-lowfx" ${store.prefs.lowFx ? raw('checked') : ''} /> ${T('降低特效', 'Reduce effects')}</label>
        </div>`,
    );
    setHtml(
      $('#twin-key', host),
      html`<span class="twin-key-item">${mark('ok')}</span><span class="twin-key-item">${mark('warn')}</span><span class="twin-key-item">${mark('crit')}</span>
        <span class="twin-key-item"><i class="twin-key-slip"></i>${tx(now().key)}</span>`,
    );
  }

  // ── 右邊：資料卡
  function systemCard(state: AppState, id: SystemId, model: TwinModel): Safe {
    const sys = state.systems.find((s) => s.id === id);
    if (!sys) return html``;
    const impact = impactOf(state, id);
    const mine = ifacesOf(state, id);
    const bad = mine.filter((i) => ifaceStatus(state, i).health !== 'ok').length;
    const live = model.systems.find((s) => s.id === id);
    const health = live?.health ?? 'ok';
    const faulty = state.faults.includes(id);
    const dc = state.dataCentres.find((d) => d.id === sys.dcId);
    const down = model.drill?.down.includes(id);
    const status = faulty
      ? T('停止（模擬）', 'Down (simulated)')
      : down
        ? T('演練中：還沒回來', 'Drill: not back yet')
        : live?.place === 'dc-dr'
          ? T('演練中：已在備援中心接手', 'Drill: running at the DR centre')
          : undefined;
    return html`<div class="twin-card" id="twin-card">
      <h3><span class="num muted">${sys.code}</span> ${tech() ? tx(sys.name) : tx(sys.plain)}</h3>
      <p>${mark(down ? 'crit' : health, status)} ${tx(sys.note)}</p>
      ${facts([
        [T('廠商', 'Vendor'), vendorName(state, sys.vendorId)],
        [T('內部負責人', 'Internal owner'), personName(state, sys.ownerId)],
        [T('放在哪', 'Hosted at'), T('{name}（{city}）', '{name} ({city})', { name: tx(dc?.name), city: tx(dc?.city) })],
        [
          T('異地備援', 'Disaster recovery'),
          T('{mode}；{rto}內要回來', '{mode}; back within {rto}', { mode: tx(DR_MODE[sys.dr.mode]), rto: fmtHours(sys.dr.rtoHr) }),
        ],
        [
          tech() ? T('介面', 'Interfaces') : T('資料交換', 'Data exchanges'),
          bad ? T('{n} 條，{b} 條要注意', '{n}, {b} need attention', { n: mine.length, b: bad }) : T('{n} 條，都正常', '{n}, all OK', { n: mine.length }),
        ],
        [
          T('如果它停了', 'If it stops'),
          T('{n} 條會中斷或被擋住，影響 {d}', '{n} would stop or be blocked, affecting {d}', {
            n: impact.ifaces.length,
            d: impact.domains.map((d) => tx(DOMAIN_LABEL[d])).join(T('、', ', ')),
          }),
        ],
      ])}
      <div class="actions">
        <a class="btn btn-sm" href="${link(probe() ? { what: null } : { what: 'if', drill: null })}" data-fk="twin-probe">${probe() ? T('取消標示', 'Clear highlight') : T('標出受影響的樓層', 'Highlight affected floors')}</a>
        ${actionBtn({ act: 'twin-fault', label: faulty ? T('解除故障', 'Clear the fault') : T('注入故障（模擬）', 'Inject a fault (simulation)'), perm: 'fault.inject', small: true, data: { sys: id } })}
        ${canOpen('/integration') ? html`<a class="btn btn-sm" href="#/integration?sys=${id}" data-fk="twin-to-map">${T('在架構圖查看', 'View on the integration map')}</a>` : ''}
        <a class="btn btn-sm" href="${link({ focus: null, what: null })}" data-fk="twin-close">${T('關閉', 'Close')}</a>
      </div>
    </div>`;
  }

  function floorCard(state: AppState, domain: Domain, model: TwinModel): Safe {
    const info = model.floors.find((f) => f.domain === domain);
    const mine = state.ifaces.filter((i) => i.domain === domain);
    const bad = mine.filter((i) => ifaceStatus(state, i).health !== 'ok').length;
    const running = model.flows.filter((f) => f.domain === domain && f.active).length;
    return html`<div class="twin-card" id="twin-floor-card">
      <h3>${tx(DOMAIN_LABEL[domain])}</h3>
      <p>${mark(info?.health ?? 'ok')} ${info?.affected ? tag(T('受影響', 'Affected'), 'crit') : ''} ${T('機房裡腳下有一圈的機櫃，是這個單位每天在用的系統；其他單位的紙片退到背景。', 'Racks with a ring at their foot are the systems this unit uses every day; other units’ slips fade back.')}</p>
      ${facts([
        [T('每天在用的系統', 'Systems used daily'), sysList(state, info?.systems ?? [])],
        [
          tech() ? T('這個單位的介面', 'This unit’s interfaces') : T('這個單位的資料交換', 'This unit’s data exchanges'),
          bad ? T('{n} 條，{b} 條要注意', '{n}, {b} need attention', { n: mine.length, b: bad }) : T('{n} 條，都正常', '{n}, all OK', { n: mine.length }),
        ],
        [T('這個小時在跑', 'Running this hour'), T('{n} 條', '{n}', { n: running })],
      ])}
      <div class="actions"><a class="btn btn-sm" href="${link({ floor: null })}" data-fk="twin-floor-close">${T('關閉', 'Close')}</a></div>
    </div>`;
  }

  /** 演練的說明與時間點。三個比例尺都會顯示。 */
  function drillBox(state: AppState, model: TwinModel): Safe {
    const drill = model.drill;
    if (!drill) return html``;
    const slowest = state.systems.filter((s) => s.dcId === 'dc-hq').sort((a, b) => b.dr.rtoHr - a.dr.rtoHr)[0];
    const stepName = (hr: number) => (hr === 0 ? T('當下', 'At once') : fmtHours(hr));
    return html`<div class="callout is-warn" id="twin-drill"><div><b>${T('演練：總行機房停擺', 'Drill: head office data centre lost')}</b>
      <p>${T('這是「如果」，不會改任何資料。停擺後 {t}：', 'A what-if: no data is changed. {t} after the loss: ', { t: stepName(drill.elapsedHr) })}${
        drill.down.length
          ? T('{r} 個系統已在備援中心接手，{d} 個還沒回來（{list}）。', '{r} systems are running at the DR centre, {d} are not back yet ({list}).', {
              r: drill.recovered.length,
              d: drill.down.length,
              list: sysList(state, drill.down),
            })
          : T('總行的 {r} 個系統都在備援中心接手了。', 'all {r} head office systems are running at the DR centre.', { r: drill.recovered.length })
      }${T('{list} 放在廠商機房，不受影響。', ' {list} sits in the vendor data centre and is unaffected.', { list: sysList(state, drill.untouched) })}</p>
      <div class="seg" id="twin-drill-steps" role="group" aria-label="${T('停擺後多久', 'Time since the loss')}">${drill.steps.map(
        (hr, i) => html`<button type="button" data-drill="${i}" data-fk="twin-drill:${i}" aria-pressed="${String(i === drill.step)}">${stepName(hr)}</button>`,
      )}</div>
      <p class="muted">${T(
        '全部回來要 {t}。最慢的是 {name}：{mode}。它沒回來之前，用到它的單位都還是受影響。',
        'Everything is back after {t}. The slowest is {name}: {mode}. Until it returns, every unit that relies on it is still affected.',
        { t: fmtHours(drill.allBackHr), name: slowest ? sysLabel(state, slowest.id) : '', mode: slowest ? tx(DR_MODE[slowest.dr.mode]) : '' },
      )}</p></div></div>`;
  }

  function impactBox(model: TwinModel): Safe {
    const affected = model.affected;
    if (!affected) return html``;
    return html`<div class="callout is-crit" id="twin-impact"><div><b>${T('影響範圍', 'Impact')}</b>
      <p>${T('樓層：{d}。{n} 條介面中斷或被擋住。', 'Floors: {d}. {n} interfaces stopped or blocked.', { d: affected.domains.map((d) => tx(DOMAIN_LABEL[d])).join(T('、', ', ')) || T('沒有', 'none'), n: affected.ifaceIds.length })}</p>
      <p class="num">${tech() ? affected.ifaceIds.join(T('、', ', ')) : ''}</p></div></div>`;
  }

  function flowsTable(state: AppState, model: TwinModel): Safe {
    const only = floor();
    const running = model.flows.filter((f) => f.active && (!only || f.domain === only));
    const ifaceById = new Map(state.ifaces.map((i) => [i.id, i]));
    return html`<h3>${
      only
        ? T('{name}這個小時在跑的', '{name}: running this hour', { name: tx(DOMAIN_LABEL[only]) })
        : model.replay
          ? T('月結日 {h}:00 在跑的', 'Running at {h}:00 on month-end day', { h: two(model.hour) })
          : T('現在這個小時在跑的', 'Running in the current hour')
    }<span class="muted"> ${T('{n} 條', '{n}', { n: running.length })}</span></h3>
      ${table({
        id: 'twin-flows',
        caption: T('這個小時在跑的介面', 'Interfaces running this hour'),
        empty: T('這個小時沒有排定的資料交換。', 'No data exchange is scheduled for this hour.'),
        rows: running,
        cols: [
          {
            head: T('狀態', 'Status'),
            cell: (f) => (f.stalled ? mark('crit', T('演練中會中斷', 'Stops in the drill')) : mark(f.health, healthLabel(f.health))),
            cls: 'nowrap',
          },
          {
            head: tech() ? T('介面', 'Interface') : T('哪件事', 'What'),
            cell: (f) =>
              tech() ? html`<span class="num">${f.id}</span> ${sysLabel(state, f.from)} → ${sysLabel(state, f.to)}` : tx(ifaceById.get(f.id)?.plain),
          },
          { head: T('筆數', 'Records'), cell: (f) => num(f.records), cls: 'num' },
        ],
      })}`;
  }

  function renderSide(state: AppState, model: TwinModel): void {
    const extra = html`${drillBox(state, model)}${impactBox(model)}`;
    if (view() !== 'hq') {
      const sites = scales?.sitesModel(state, model);
      setHtml(
        side,
        scales && sites ? scales.side(state, model, sites, extra) : html`<p class="hint">${T('這個比例尺的內容載入中', 'Loading this scale')}</p>${extra}`,
      );
      return;
    }
    const pickedId = selected();
    const pickedFloor = floor();
    setHtml(
      side,
      html`${
        pickedId
          ? systemCard(state, pickedId, model)
          : pickedFloor
            ? floorCard(state, pickedFloor, model)
            : html`<p class="hint">${T('還沒選東西。點機房裡的機櫃看系統，點樓層看那個單位；也可以用 Tab 移到標籤再按 Enter，方向鍵換下一個。', 'Nothing selected. Select a rack for its system or a floor for that unit; or Tab to a label and press Enter, and use the arrow keys to move along.')}</p>`
      }${extra}${flowsTable(state, model)}`,
    );
  }

  function renderTime(state: AppState, model: TwinModel): void {
    const profile = dayProfile(state);
    const max = Math.max(...profile.map((p) => p.ifaces), 1);
    const bars = profile
      .map((p) => {
        const h = Math.round((p.ifaces / max) * 26);
        return `<rect class="${p.hour === model.hour && model.replay ? 'is-now' : ''}" x="${p.hour * 14 + 2}" y="${30 - h}" width="10" height="${h}"><title>${two(p.hour)}:00 ${p.ifaces}</title></rect>`;
      })
      .join('');
    setHtml(
      time,
      html`<div class="twin-time-row">
        <button type="button" class="btn btn-sm" id="twin-now" aria-pressed="${String(!model.replay)}">${T('現在', 'Now')}</button>
        <button type="button" class="btn btn-sm" id="twin-play">${timer ? T('停止重播', 'Stop replay') : T('重播月結日 {d} 的 24 小時', 'Replay the 24 hours of month-end day {d}', { d: fmtDay(MONTH_END) })}</button>
        <label for="twin-hour">${T('台北時間', 'Taipei time')}</label>
        <input type="range" id="twin-hour" min="0" max="23" step="1" value="${model.hour}" aria-valuetext="${two(model.hour)}:00" />
        <output class="num" for="twin-hour" id="twin-hour-out">${two(model.hour)}:00</output>
      </div>
      <div class="twin-profile"><svg viewBox="0 0 340 32" width="340" height="32" role="img" aria-label="${T('月結日每個小時有幾條介面在跑：夜間批次集中在 21 點到凌晨 3 點', 'Interfaces running per hour on month-end day: night batches cluster between 21:00 and 03:00')}">${raw(bars)}</svg>
        <span class="muted">${T('每小時在跑的介面數。夜間批次集中在 21:00–03:00。', 'Interfaces running per hour. Night batches cluster at 21:00–03:00.')}</span></div>`,
    );
  }

  function fallback(state: AppState, model: TwinModel): Safe {
    const note = html`<p class="callout">${T('這個瀏覽器沒有開啟 WebGL，所以畫不出 3D 場景。下面是同一份資料的清單，其他功能都不受影響。', 'WebGL is not available in this browser, so the 3D scene cannot be drawn. Below is the same data as a list; everything else works as usual.')}</p>`;
    if (view() !== 'hq') {
      const sites = scales?.sitesModel(state, model);
      return html`<div class="twin-fallback" id="twin-fallback">${note}${scales && sites ? scales.fallback(sites) : ''}</div>`;
    }
    return html`<div class="twin-fallback" id="twin-fallback">
      ${note}
      ${table({
        caption: T('樓層', 'Floors'),
        empty: '',
        rows: [...model.floors].reverse(),
        cols: [
          { head: T('樓層', 'Floor'), cell: (f) => tx(DOMAIN_LABEL[f.domain]), cls: 'nowrap' },
          { head: T('狀態', 'Status'), cell: (f) => mark(f.health), cls: 'nowrap' },
          { head: T('影響範圍', 'Impact'), cell: (f) => (f.affected ? tag(T('受影響', 'Affected'), 'crit') : '–'), cls: 'nowrap' },
        ],
      })}
      ${table({
        caption: T('機房的系統', 'Systems in the machine room'),
        empty: '',
        rows: model.systems,
        cols: [
          {
            head: T('系統', 'System'),
            cell: (s) =>
              html`<button type="button" class="btn btn-sm" data-system="${s.id}" data-fk="fb:${s.id}">${tx(state.systems.find((x) => x.id === s.id)?.name)}</button>`,
            cls: 'nowrap',
          },
          {
            head: T('狀態', 'Status'),
            cell: (s) => mark(model.down.includes(s.id) ? 'crit' : s.health, s.faulty ? T('停止（模擬）', 'Down (simulated)') : undefined),
            cls: 'nowrap',
          },
        ],
      })}
    </div>`;
  }

  function update(): void {
    const state = store.state;
    const model = twinModel(state, hour, probe(), drillStep());
    const sites = scales?.sitesModel(state, model) ?? null;
    renderHead(model);
    if (failed) setHtml(stage, fallback(state, model));
    // 另外兩個比例尺要等它們的面板下載完才有資料可以畫
    else if (view() === 'hq' || (scales && sites))
      twin?.update({
        view: view(),
        model,
        sites,
        selected: { system: selected(), floor: floor(), site: sites && scales ? scales.pickedSite(sites) : null, region: scales?.region() ?? null },
        labels: view() === 'hq' || !scales || !sites ? hqLabels(state, model) : scales.labels(model, sites),
        ariaLabel: tx(now().aria),
      });
    renderSide(state, model);
    renderTime(state, model);
    setHtml($('#twin-day', host), scales ? scales.day(state, model) : html``);
  }

  function stop(): void {
    clearInterval(timer);
    timer = 0;
  }

  /** 在 3D 上點了東西（或點了它的標籤）。再點一次同一樣東西是取消。 */
  function onPick(target: TwinPick): void {
    if (target.kind === 'view') setQuery({ ...NO_PICK, view: target.id === 'hq' ? null : target.id });
    else if (target.kind === 'system') setQuery({ focus: target.id === q('focus') ? null : target.id, floor: null, what: null });
    else if (target.kind === 'floor') setQuery({ floor: target.id === q('floor') && !q('focus') ? null : target.id, focus: null, what: null });
    else if (target.kind === 'region') setQuery({ region: target.id === q('region') ? null : target.id, site: null });
    // 在總行點小房子：換到全台，並且選好那一處
    else if (view() === 'hq') setQuery({ ...NO_PICK, view: 'tw', site: target.id });
    else setQuery({ site: target.id === q('site') ? null : target.id, region: null });
  }

  const offs = [
    on(host, 'change', '#twin-lowfx', (_e, el) => {
      const low = (el as HTMLInputElement).checked;
      store.setPrefs({ lowFx: low });
      twin?.setLowFx(low);
    }),
    on(host, 'input', '#twin-hour', (_e, el) => {
      stop();
      hour = Number((el as HTMLInputElement).value);
      update();
      $('#twin-hour', host).focus();
    }),
    on(host, 'click', '#twin-reset', () => twin?.resetView()),
    on(host, 'click', '#twin-views [data-view]', (_e, el) => onPick({ kind: 'view', id: el.dataset.view as TwinView })),
    on(host, 'click', '#twin-drill-steps [data-drill]', (_e, el) => setQuery({ drill: el.dataset.drill ?? '0' })),
    on(host, 'click', '#twin-side [data-site], #twin-fallback [data-site]', (_e, el) =>
      setQuery({ site: el.dataset.site === q('site') ? null : (el.dataset.site ?? null) }),
    ),
    on(host, 'click', '#twin-now', () => {
      stop();
      hour = null;
      update();
    }),
    on(host, 'click', '#twin-play', () => {
      if (timer) {
        stop();
        update();
        return;
      }
      hour = 0;
      timer = window.setInterval(() => {
        if (hour === null || hour >= 23) stop();
        else hour += 1;
        update();
      }, 900);
      update();
    }),
    on(host, 'click', '[data-act="twin-fault"]', (_e, el) => {
      const id = el.dataset.sys as SystemId;
      const down = toggleFault(id);
      toast(
        down
          ? T('已注入故障：受影響的樓層換了顏色，所有頁面一起變', 'Fault injected: affected floors change colour, on every page')
          : T('已解除故障', 'Fault cleared'),
        down ? 'warn' : 'ok',
      );
    }),
    on(host, 'click', '#twin-fallback [data-system]', (_e, el) => setQuery({ focus: el.dataset.system ?? null })),
    store.subscribe(() => update()),
  ];

  update();
  // 3D 的程式與另外兩個比例尺的面板，等首屏畫完、瀏覽器有空時才下載
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  idle(() => {
    loadLazy()
      .then(({ createScales, createTwin }) => {
        if (disposed) return;
        scales = createScales({ view, query: q, link, tech, sysLabel, sysList, drMode: DR_MODE, ui: { html, raw, esc, num, facts, mark, table, tag } });
        try {
          twin = createTwin({
            container: stage,
            labelLayer: $('#twin-labels', host),
            view: view(),
            places: scales.places(store.state),
            lowFx: store.prefs.lowFx,
            still: matchMedia('(prefers-reduced-motion: reduce)').matches,
            onPick,
          });
          host.querySelector('#twin-msg')?.remove();
          $('#twin-reset', host).hidden = false;
        } catch {
          // 沒有 WebGL：另外兩個比例尺的清單還是有，只是左邊改成表格
          failed = true;
        }
        update();
      })
      .catch(() => {
        if (disposed) return;
        failed = true;
        update();
      });
  });

  return {
    route(next) {
      route = next;
      update();
    },
    destroy() {
      disposed = true;
      stop();
      for (const off of offs) off();
      twin?.dispose();
    },
  };
}
