import { toggleFault } from '../core/actions';
import { can } from '../core/auth';
import { fmtDay, MONTH_END } from '../core/date';
import { T, tx } from '../core/i18n';
import { href, type Route, setQuery } from '../core/router';
import { ifaceStatus, ifacesOf, impactOf } from '../core/selectors';
import { store } from '../core/store';
import { dayProfile, FLOORS, RACKS, type TwinModel, twinModel } from '../core/twin';
import type { AppState, SystemId } from '../core/types';
import type { TwinHandle, TwinLabel } from '../three/twin';
import { $, html, num, on, raw, type Safe, setHtml, toast } from './dom';
import { canOpen } from './shell';
import { actionBtn, facts, healthLabel, mark, personName, systemName, table, tag, vendorName } from './widgets';

// 總覽上的「微縮總行」區塊：左邊是 3D 場景，右邊是資料卡與清單，下面是月結日 24 小時的時間軸。
// 3D 場景與右邊的清單都由 twinModel() 的同一份結果畫出來。
// 沒有 WebGL 時，左邊改成同一份資料的表格，其他都照常。

const DOMAIN_LABEL = Object.fromEntries(FLOORS.map((f) => [f.domain, f.name]));

function loadTwin(): Promise<typeof import('../three/twin')> {
  return import('../three/twin');
}

export function mountTwinPanel(host: HTMLElement, first: Route): { route(next: Route): void; destroy(): void } {
  let route = first;
  let twin: TwinHandle | null = null;
  let failed = false;
  let disposed = false;
  /** null 是「現在」；0–23 是重播月結日的那個小時。 */
  let hour: number | null = null;
  let timer = 0;

  const selected = () => (RACKS.find((id) => id === route.query.get('focus')) ?? null) as SystemId | null;
  const probe = () => (route.query.get('what') === 'if' ? selected() : null);
  const tech = () => can('iface.detail');

  setHtml(
    host,
    html`<section class="panel" id="twin">
      <div class="panel-head"><h2>${T('微縮總行', 'Miniature head office')}</h2>
        <span class="panel-note">${T('樓層是單位，地下機房的機櫃是系統，右邊一排小房子是營業據點。點機櫃看資料卡。', 'Floors are units, basement racks are systems, the row of houses on the right is the branches. Select a rack for its data card.')}</span>
        <div class="actions"><label class="check"><input type="checkbox" id="twin-lowfx" ${store.prefs.lowFx ? raw('checked') : ''} /> ${T('降低特效', 'Reduce effects')}</label></div>
      </div>
      <div class="twin-grid">
        <div class="twin-left">
          <div class="twin-stage" id="twin-stage"><div class="twin-labels" id="twin-labels"></div><p class="twin-msg" id="twin-msg">${T('3D 場景載入中', 'Loading the 3D scene')}</p></div>
          <div class="twin-time" id="twin-time"></div>
        </div>
        <div class="twin-side" id="twin-side" aria-live="polite"></div>
      </div>
    </section>`,
  );
  const stage = $('#twin-stage', host);
  const side = $('#twin-side', host);
  const time = $('#twin-time', host);

  function labels(state: AppState): TwinLabel[] {
    return [
      ...RACKS.map((id): TwinLabel => {
        const sys = state.systems.find((s) => s.id === id);
        return { id, kind: 'system', text: sys?.code ?? id, title: `${tech() ? tx(sys?.name) : tx(sys?.plain)}${T('：看資料卡', ': open data card')}` };
      }),
      ...FLOORS.map((f): TwinLabel => ({ id: f.domain, kind: 'floor', text: tx(f.name), title: tx(f.name) })),
      { id: 'all', kind: 'branches', text: T('營業據點 {n} 處', '{n} branches', { n: state.branches.length }), title: T('營業據點', 'Branches') },
    ];
  }

  function card(state: AppState, id: SystemId, model: TwinModel): Safe {
    const sys = state.systems.find((s) => s.id === id);
    if (!sys) return html``;
    const impact = impactOf(state, id);
    const mine = ifacesOf(state, id);
    const bad = mine.filter((i) => ifaceStatus(state, i).health !== 'ok').length;
    const health = model.systems.find((s) => s.id === id)?.health ?? 'ok';
    const faulty = state.faults.includes(id);
    return html`<div class="twin-card" id="twin-card">
      <h3><span class="num muted">${sys.code}</span> ${tech() ? tx(sys.name) : tx(sys.plain)}</h3>
      <p>${mark(health, faulty ? T('停止（模擬）', 'Down (simulated)') : undefined)} ${tx(sys.note)}</p>
      ${facts([
        [T('廠商', 'Vendor'), vendorName(state, sys.vendorId)],
        [T('內部負責人', 'Internal owner'), personName(state, sys.ownerId)],
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
        <a class="btn btn-sm" href="${href('/overview', probe() ? { focus: id } : { focus: id, what: 'if' })}" data-fk="twin-probe">${probe() ? T('取消標示', 'Clear highlight') : T('標出受影響的樓層', 'Highlight affected floors')}</a>
        ${actionBtn({ act: 'twin-fault', label: faulty ? T('解除故障', 'Clear the fault') : T('注入故障（模擬）', 'Inject a fault (simulation)'), perm: 'fault.inject', small: true, data: { sys: id } })}
        ${canOpen('/integration') ? html`<a class="btn btn-sm" href="${href('/integration', { sys: id })}" data-fk="twin-to-map">${T('在架構圖查看', 'View on the integration map')}</a>` : ''}
        <a class="btn btn-sm" href="${href('/overview')}" data-fk="twin-close">${T('關閉', 'Close')}</a>
      </div>
    </div>`;
  }

  function renderSide(state: AppState, model: TwinModel): void {
    const pickedId = selected();
    const running = model.flows.filter((f) => f.active);
    const affected = model.affected;
    const ifaceById = new Map(state.ifaces.map((i) => [i.id, i]));
    setHtml(
      side,
      html`${pickedId ? card(state, pickedId, model) : html`<p class="hint">${T('還沒選系統。點機房裡的機櫃，或用 Tab 移到機櫃的標籤再按 Enter。', 'No system selected. Select a rack in the basement, or Tab to a rack label and press Enter.')}</p>`}
      ${
        affected
          ? html`<div class="callout is-crit" id="twin-impact"><div><b>${T('影響範圍', 'Impact')}</b>
              <p>${T('樓層：{d}。{n} 條介面中斷或被擋住。', 'Floors: {d}. {n} interfaces stopped or blocked.', { d: affected.domains.map((d) => tx(DOMAIN_LABEL[d])).join(T('、', ', ')) || T('沒有', 'none'), n: affected.ifaceIds.length })}</p>
              <p class="num">${tech() ? affected.ifaceIds.join(T('、', ', ')) : ''}</p></div></div>`
          : ''
      }
      <h3>${model.replay ? T('月結日 {h}:00 在跑的', 'Running at {h}:00 on month-end day', { h: String(model.hour).padStart(2, '0') }) : T('現在這個小時在跑的', 'Running in the current hour')}<span class="muted"> ${T('{n} 條', '{n}', { n: running.length })}</span></h3>
      ${table({
        id: 'twin-flows',
        caption: T('這個小時在跑的介面', 'Interfaces running this hour'),
        empty: T('這個小時沒有排定的資料交換。', 'No data exchange is scheduled for this hour.'),
        rows: running,
        cols: [
          { head: T('狀態', 'Status'), cell: (f) => mark(f.health, healthLabel(f.health)), cls: 'nowrap' },
          {
            head: tech() ? T('介面', 'Interface') : T('哪件事', 'What'),
            cell: (f) =>
              tech() ? html`<span class="num">${f.id}</span> ${systemName(state, f.from)} → ${systemName(state, f.to)}` : tx(ifaceById.get(f.id)?.plain),
          },
          { head: T('筆數', 'Records'), cell: (f) => num(f.records), cls: 'num' },
        ],
      })}`,
    );
  }

  function renderTime(state: AppState, model: TwinModel): void {
    const profile = dayProfile(state);
    const max = Math.max(...profile.map((p) => p.ifaces), 1);
    const bars = profile
      .map((p) => {
        const h = Math.round((p.ifaces / max) * 26);
        return `<rect class="${p.hour === model.hour && model.replay ? 'is-now' : ''}" x="${p.hour * 14 + 2}" y="${30 - h}" width="10" height="${h}"><title>${String(p.hour).padStart(2, '0')}:00 ${p.ifaces}</title></rect>`;
      })
      .join('');
    setHtml(
      time,
      html`<div class="twin-time-row">
        <button type="button" class="btn btn-sm" id="twin-now" aria-pressed="${String(!model.replay)}">${T('現在', 'Now')}</button>
        <button type="button" class="btn btn-sm" id="twin-play">${timer ? T('停止重播', 'Stop replay') : T('重播月結日 {d} 的 24 小時', 'Replay the 24 hours of month-end day {d}', { d: fmtDay(MONTH_END) })}</button>
        <label for="twin-hour">${T('時間', 'Hour')}</label>
        <input type="range" id="twin-hour" min="0" max="23" step="1" value="${model.hour}" aria-valuetext="${String(model.hour).padStart(2, '0')}:00" />
        <output class="num" for="twin-hour" id="twin-hour-out">${String(model.hour).padStart(2, '0')}:00</output>
      </div>
      <div class="twin-profile"><svg viewBox="0 0 340 32" width="340" height="32" role="img" aria-label="${T('月結日每個小時有幾條介面在跑：夜間批次集中在 21 點到凌晨 3 點', 'Interfaces running per hour on month-end day: night batches cluster between 21:00 and 03:00')}">${raw(bars)}</svg>
        <span class="muted">${T('每小時在跑的介面數。夜間批次集中在 21:00–03:00。', 'Interfaces running per hour. Night batches cluster at 21:00–03:00.')}</span></div>`,
    );
  }

  function fallback(state: AppState, model: TwinModel): Safe {
    return html`<div class="twin-fallback" id="twin-fallback">
      <p class="callout">${T('這個瀏覽器沒有開啟 WebGL，所以畫不出 3D 場景。下面是同一份資料的清單，其他功能都不受影響。', 'WebGL is not available in this browser, so the 3D scene cannot be drawn. Below is the same data as a list; everything else works as usual.')}</p>
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
            cell: (s) => html`<button type="button" class="btn btn-sm" data-system="${s.id}" data-fk="fb:${s.id}">${systemName(state, s.id)}</button>`,
            cls: 'nowrap',
          },
          { head: T('狀態', 'Status'), cell: (s) => mark(s.health, s.faulty ? T('停止（模擬）', 'Down (simulated)') : undefined), cls: 'nowrap' },
        ],
      })}
    </div>`;
  }

  function update(): void {
    const state = store.state;
    const model = twinModel(state, hour, probe());
    if (failed) setHtml(stage, fallback(state, model));
    else twin?.update(model, selected());
    renderSide(state, model);
    renderTime(state, model);
  }

  function stop(): void {
    clearInterval(timer);
    timer = 0;
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
      const now = toggleFault(id);
      toast(
        now
          ? T('已注入故障：受影響的樓層換了顏色，所有頁面一起變', 'Fault injected: affected floors change colour, on every page')
          : T('已解除故障', 'Fault cleared'),
        now ? 'warn' : 'ok',
      );
    }),
    on(host, 'click', '#twin-fallback [data-system]', (_e, el) => setQuery({ focus: el.dataset.system ?? null })),
    store.subscribe((kind) => {
      if (kind === 'prefs') twin?.setLabels(labels(store.state));
      update();
    }),
  ];

  update();
  // 3D 的程式等首屏畫完、瀏覽器有空時才下載
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  idle(() => {
    loadTwin()
      .then(({ createTwin }) => {
        if (disposed) return;
        twin = createTwin({
          container: stage,
          labelLayer: $('#twin-labels', host),
          labels: labels(store.state),
          ariaLabel: T(
            '微縮總行的 3D 剖面圖。同樣的內容在右邊的清單與下面的表格裡。',
            'A 3D section of the miniature head office. The same content is in the list on the right and the tables below.',
          ),
          lowFx: store.prefs.lowFx,
          still: matchMedia('(prefers-reduced-motion: reduce)').matches,
          onSelect: (id) => setQuery({ focus: id }),
        });
        host.querySelector('#twin-msg')?.remove();
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
