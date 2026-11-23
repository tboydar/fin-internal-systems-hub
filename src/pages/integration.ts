import { resend, toggleFault } from '../core/actions';
import { can } from '../core/auth';
import { fmtStamp } from '../core/date';
import { DOMAIN_NAME } from '../core/derive';
import { T, tx } from '../core/i18n';
import { queued } from '../core/mutations';
import { sayAbout } from '../core/narrative';
import { href, type Route, setQuery } from '../core/router';
import { type IfaceStatus, ifaceStatus, ifacesOf, impactOf, runsOf, systemHealth, touches, worse } from '../core/selectors';
import { store } from '../core/store';
import type { ApiEntry, AppState, Domain, Health, Iface, Run, Schedule, System, SystemId } from '../core/types';
import type { FlowEdgeSpec, FlowHandle, FlowNodeSpec, FlowSpec } from '../flow/FlowIsland';
import { nextRun } from '../mock/runs';
import { $, html, on, raw, type Safe, setHtml, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { attachFlow } from '../ui/lazy';
import type { PageHandle } from '../ui/shell';
import { actionBtn, facts, healthLabel, mark, pageHead, personName, runStrip, systemName, table, tabs, tag, vendorName } from '../ui/widgets';

// 整合架構：節點是系統，連線是介面。點連線看欄位對應、錯誤處理與對帳規則。
// 圖與下面的清單讀同一份狀態；篩選條件與選取的對象都放在網址裡，重新整理後還在。

const POSITION: Record<SystemId, [x: number, y: number]> = {
  iam: [440, 0],
  hr: [0, 90],
  crm: [0, 250],
  wf: [0, 410],
  esb: [440, 250],
  'erp-gl': [880, 90],
  'erp-ap': [880, 250],
  'erp-po': [880, 410],
  dw: [440, 500],
};

const RUN_HEALTH: Record<Run['status'], Health> = { ok: 'ok', retried: 'warn', late: 'warn', held: 'warn', fail: 'crit' };

export function scheduleLabel(s: Schedule): string {
  if (s.kind === 'realtime') return T('即時（上班時間）', 'Real time (business hours)');
  if (s.kind === 'interval') return s.everyMin === 60 ? T('每小時', 'Hourly') : T('每 {n} 分鐘', 'Every {n} min', { n: s.everyMin ?? 0 });
  if (s.kind === 'daily') return T('每個工作日 {t}', 'Every working day at {t}', { t: s.at ?? '' });
  return T('每月一次，{t}', 'Monthly, at {t}', { t: s.at ?? '' });
}

export function runStatusLabel(status: Run['status']): string {
  switch (status) {
    case 'ok':
      return T('成功', 'Succeeded');
    case 'retried':
      return T('重試後成功', 'Succeeded after retry');
    case 'late':
      return T('晚完成', 'Finished late');
    case 'held':
      return T('保留', 'Held');
    default:
      return T('失敗', 'Failed');
  }
}

interface Pair {
  id: string;
  from: SystemId;
  to: SystemId;
  ifaces: Iface[];
}

/** 圖上的每一條連線：同一對系統之間的介面併成一條。經整合層的介面會出現在進、出兩條連線上。 */
function pairsOf(state: AppState): Pair[] {
  const map = new Map<string, Pair>();
  const add = (from: SystemId, to: SystemId, iface: Iface) => {
    const id = `${from}>${to}`;
    const pair = map.get(id) ?? { id, from, to, ifaces: [] };
    pair.ifaces.push(iface);
    map.set(id, pair);
  };
  for (const iface of state.ifaces) {
    if (iface.via === 'esb') {
      add(iface.source, 'esb', iface);
      add('esb', iface.target, iface);
    } else add(iface.source, iface.target, iface);
  }
  return [...map.values()];
}

interface Filters {
  domain: string;
  vendor: string;
  health: string;
}

function matches(state: AppState, iface: Iface, f: Filters): boolean {
  if (f.domain && iface.domain !== f.domain) return false;
  if (f.vendor === 'internal' && iface.vendorId !== null) return false;
  if (f.vendor && f.vendor !== 'internal' && !touches(iface).some((id) => state.systems.find((s) => s.id === id)?.vendorId === f.vendor)) return false;
  const health = ifaceStatus(state, iface).health;
  if (f.health === 'attention') return health !== 'ok';
  return !f.health || health === f.health;
}

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  let flow: FlowHandle | null = null;
  const q = (key: string) => route.query.get(key) ?? '';
  const withQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return href('/integration', Object.fromEntries(next));
  };

  setHtml(
    root,
    html`<div class="page">
      <div id="int-head"></div>
      <div id="int-filters"></div>
      <div class="int-main" id="int-main">
        <section class="panel flow-panel" aria-label="${T('系統與介面的拓撲圖', 'Topology of systems and interfaces')}"><div class="flow" id="int-flow"></div><div class="legend" id="int-legend"></div></section>
        <aside class="panel side-panel" id="int-side" aria-live="polite" hidden></aside>
      </div>
      <div id="int-lists"></div>
    </div>`,
  );

  function spec(state: AppState, f: Filters, selIface: Iface | undefined, selPairId: string | undefined, impact: ReturnType<typeof impactOf> | null): FlowSpec {
    const filtering = !!(f.domain || f.vendor || f.health);
    const live = new Set(state.ifaces.filter((i) => matches(state, i, f)).map((i) => i.id));
    const hitIfaces = new Set(impact ? impact.ifaces.map((i) => i.id) : selIface ? [selIface.id] : []);
    const nodes: FlowNodeSpec[] = state.systems.map((sys) => {
      const health = systemHealth(state, sys);
      const mine = ifacesOf(state, sys.id);
      const bad = mine.filter((i) => ifaceStatus(state, i).health !== 'ok').length;
      return {
        id: sys.id,
        x: POSITION[sys.id][0],
        y: POSITION[sys.id][1],
        code: sys.code,
        title: tx(sys.name),
        sub: vendorName(state, sys.vendorId),
        stat: bad
          ? T('{n} 條介面，{b} 條要注意', '{n} interfaces, {b} need attention', { n: mine.length, b: bad })
          : T('{n} 條介面', '{n} interfaces', { n: mine.length }),
        tone: health,
        toneLabel: state.faults.includes(sys.id) ? T('停止（模擬）', 'Down (simulated)') : healthLabel(health),
        dim: impact ? !impact.systems.includes(sys.id) : filtering && !mine.some((i) => live.has(i.id)),
        hit: impact ? impact.systems.includes(sys.id) : false,
      };
    });
    const edges: FlowEdgeSpec[] = pairsOf(state).map((pair) => {
      const shown = filtering ? pair.ifaces.filter((i) => live.has(i.id)) : pair.ifaces;
      const tone = (shown.length ? shown : pair.ifaces).map((i) => ifaceStatus(state, i).health).reduce(worse, 'ok' as Health);
      const ids = pair.ifaces.map((i) => i.id);
      const hit = ids.some((id) => hitIfaces.has(id));
      return {
        id: pair.id,
        source: pair.from,
        target: pair.to,
        // 24 條介面全標編號會擠成一團：只標不正常的、被選到的、在影響範圍裡的；其餘點了線或看下面的清單
        label:
          tone !== 'ok' || hit || pair.id === selPairId
            ? ids.length <= 2
              ? ids.join(T('、', ', '))
              : T('{n} 條介面', '{n} interfaces', { n: ids.length })
            : undefined,
        tone,
        dim: impact ? !hit : filtering && !shown.length,
        hit,
        ariaLabel: `${systemName(state, pair.from)} → ${systemName(state, pair.to)}: ${ids.join(', ')}; ${healthLabel(tone)}`,
      };
    });
    return { nodes, edges };
  }

  function ifaceDetail(state: AppState, iface: Iface): Safe {
    const st: IfaceStatus = ifaceStatus(state, iface);
    const runs = runsOf(state, iface.id);
    const waiting = queued(state, iface.id);
    const next = nextRun(iface, state.clock);
    const dependents = state.ifaces.filter((i) => i.dependsOn.includes(iface.id));
    const api = state.apis.find((a) => a.id === iface.apiId);
    const runbook = state.docs.find((d) => d.id === iface.runbookId);
    const story = sayAbout(state, iface, 'engineer');
    const run = st.run;
    return html`<div class="panel-head"><h2><span class="num">${iface.id}</span> ${tx(iface.name)}</h2><a class="btn btn-sm" href="${withQuery({ iface: null })}" data-fk="close-detail">${icon('close', 13)}${T('關閉', 'Close')}</a></div>
      <div class="panel-body stack">
        <p>${mark(st.health)} <span>${story ? tx(story) : tx(st.reason)}</span></p>
        ${
          waiting.length
            ? html`<div class="callout is-crit"><p>${T('DLQ 裡有 {n} 筆等重送。重送前請先確認目的系統的 API 回應正常。', '{n} {n|record|records} in the DLQ await resending. Confirm the target API responds normally first.', { n: waiting.length })}</p>
                ${actionBtn({ act: 'resend', label: T('重送 {n} 筆', 'Resend {n} {n|record|records}', { n: waiting.length }), perm: 'iface.resend', primary: true, data: { iface: iface.id } })}</div>`
            : ''
        }
        ${facts([
          [
            T('資料流向', 'Flow'),
            html`${systemName(state, iface.source)} → ${iface.via === 'esb' ? html`${systemName(state, 'esb')} → ` : ''}${systemName(state, iface.target)}`,
          ],
          [T('協定與頻率', 'Protocol and frequency'), `${iface.protocol}${T('，', ', ')}${scheduleLabel(iface.schedule)}`],
          [
            T('資料契約', 'Data contract'),
            html`<span class="num">${iface.contract}</span>${api ? html`${T('；呼叫 ', '; calls ')}<a href="${withQuery({ tab: 'apis', api: api.id })}">${api.id}</a>` : ''}`,
          ],
          [
            T('負責', 'Owned by'),
            `${personName(state, iface.ownerId)}${T('；', '; ')}${vendorName(state, iface.vendorId)}${T('（所屬系統：', ' (system: ')}${systemName(state, iface.systemId)}${T('）', ')')}`,
          ],
          [
            T('最近一次', 'Last run'),
            run
              ? html`<span class="num">${fmtStamp(run.at)}</span> ${runStatusLabel(run.status)}${T('，', ', ')}${T('{n} 筆', '{n} records', { n: run.records })}${run.failed ? T('，失敗 {n} 筆', ', {n} failed', { n: run.failed }) : ''}${run.http ? html`${T('，', ', ')}HTTP <span class="num">${run.http}</span>` : ''}`
              : T('還沒有執行紀錄', 'No runs yet'),
          ],
          [T('下一次', 'Next run'), next ? html`<span class="num">${fmtStamp(next)}</span>` : T('即時處理，沒有排程', 'Real time; no schedule')],
          [
            T('相依', 'Depends on'),
            iface.dependsOn.length
              ? html`${iface.dependsOn.map((id, i) => html`${i ? T('、', ', ') : ''}<a href="${withQuery({ iface: id })}">${id}</a>`)}`
              : T('沒有', 'None'),
          ],
          [
            T('被誰相依', 'Depended on by'),
            dependents.length
              ? html`${dependents.map((d, i) => html`${i ? T('、', ', ') : ''}<a href="${withQuery({ iface: d.id })}">${d.id}</a>`)}`
              : T('沒有', 'None'),
          ],
        ])}
        <h3>${T('欄位對應', 'Field mapping')}</h3>
        ${table({
          caption: T('欄位對應', 'Field mapping'),
          empty: T('這條介面沒有登記欄位對應。', 'No field mapping is registered for this interface.'),
          rows: iface.fields,
          cols: [
            { head: T('來源欄位', 'Source field'), cell: (f) => html`<code>${f.from}</code>` },
            { head: T('目的欄位', 'Target field'), cell: (f) => html`<code>${f.to}</code>` },
            { head: T('規則', 'Rule'), cell: (f) => tx(f.rule), cls: 'wide' },
          ],
        })}
        <h3>${T('錯誤處理', 'Error handling')}</h3>
        ${facts([
          [
            T('重試', 'Retry'),
            iface.retry.max
              ? `${T('最多 {n} 次', 'Up to {n} times', { n: iface.retry.max })}${T('；', '; ')}${tx(iface.retry.backoff)}`
              : tx(iface.retry.backoff),
          ],
          [
            'DLQ',
            iface.dlq
              ? T('重試用完就進 DLQ，由人看過再重送', 'After retries are exhausted, records go to the DLQ and are resent after a person has looked')
              : T('沒有 DLQ；失敗就整批重跑', 'No DLQ; a failed batch is rerun as a whole'),
          ],
          [T('補償', 'Compensation'), tx(iface.compensation)],
          ['Runbook', runbook ? html`<span class="num">${runbook.id}</span> ${tx(runbook.title)}` : T('還沒有', 'None yet')],
          [
            T('對帳規則', 'Reconciliation'),
            iface.reconIds.length
              ? html`${iface.reconIds.map((id, i) => html`${i ? T('、', ', ') : ''}${can('page.consistency') ? html`<a href="${href('/consistency', { rule: id })}">${id}</a>` : id}`)}`
              : T('沒有對應的規則', 'No rule covers this interface'),
          ],
        ])}
        ${
          waiting.length
            ? html`<h3>${T('DLQ 裡的資料', 'Records in the DLQ')}</h3>${table({
                caption: T('DLQ 裡的資料', 'Records in the DLQ'),
                empty: '',
                rows: waiting,
                cols: [
                  { head: T('鍵值', 'Key'), cell: (d) => html`<span class="num">${d.key}</span>`, cls: 'nowrap' },
                  { head: T('類別', 'Type'), cell: (d) => tx(d.kind), cls: 'nowrap' },
                  { head: T('內容', 'Content'), cell: (d) => tx(d.detail), cls: 'wide' },
                ],
              })}`
            : ''
        }
        <h3>${T('最近的執行', 'Recent runs')}</h3>
        ${table({
          caption: T('最近的執行', 'Recent runs'),
          empty: T('還沒有執行紀錄。', 'No runs yet.'),
          rows: runs.slice(0, 8),
          cols: [
            { head: T('時間', 'Time'), cell: (r) => html`<span class="num">${fmtStamp(r.at)}</span>`, cls: 'nowrap' },
            { head: T('結果', 'Result'), cell: (r) => mark(RUN_HEALTH[r.status], runStatusLabel(r.status)), cls: 'nowrap' },
            { head: T('筆數', 'Records'), cell: (r) => r.records.toLocaleString('en-US'), cls: 'num' },
            { head: T('嘗試', 'Attempts'), cell: (r) => r.attempts, cls: 'num' },
            { head: T('秒', 'Seconds'), cell: (r) => r.seconds, cls: 'num' },
          ],
        })}
      </div>`;
  }

  function systemDetail(state: AppState, sys: System, impactOn: boolean): Safe {
    const health = systemHealth(state, sys);
    const impact = impactOf(state, sys.id);
    const faulty = state.faults.includes(sys.id);
    const mine = ifacesOf(state, sys.id);
    return html`<div class="panel-head"><h2><span class="num muted">${sys.code}</span> ${tx(sys.name)}</h2><a class="btn btn-sm" href="${withQuery({ sys: null, impact: null })}" data-fk="close-detail">${icon('close', 13)}${T('關閉', 'Close')}</a></div>
      <div class="panel-body stack">
        <p>${mark(health, faulty ? T('停止（模擬）', 'Down (simulated)') : undefined)} <span>${tx(sys.note)}</span></p>
        ${facts([
          [T('廠商', 'Vendor'), vendorName(state, sys.vendorId)],
          [T('內部負責人', 'Internal owner'), personName(state, sys.ownerId)],
          [T('版本', 'Version'), html`<span class="num">${sys.version}</span>`],
          [T('環境', 'Hosting'), tx(sys.hosting)],
          [T('上線年份', 'In service since'), html`<span class="num">${sys.since}</span>`],
          [T('使用單位', 'Used by'), sys.usedBy.map((d) => tx(DOMAIN_NAME[d])).join(T('、', ', '))],
        ])}
        <h3>${T('如果它停了', 'If it stops')}</h3>
        <p>${T('{n} 條介面會中斷或被擋住，影響 {d}。', '{n} interfaces would stop or be blocked, affecting {d}.', {
          n: impact.ifaces.length,
          d: impact.domains.map((d) => tx(DOMAIN_NAME[d])).join(T('、', ', ')),
        })}</p>
        <div class="actions">
          <a class="btn btn-sm" href="${withQuery({ impact: impactOn ? null : sys.id })}" data-fk="impact">${impactOn ? T('取消標示', 'Clear highlight') : T('在圖上標出影響範圍', 'Highlight the impact on the map')}</a>
          ${actionBtn({ act: 'fault', label: faulty ? T('解除故障', 'Clear the fault') : T('注入故障（模擬）', 'Inject a fault (simulation)'), perm: 'fault.inject', small: true, data: { sys: sys.id } })}
          <a class="btn btn-sm" href="${href('/overview', { focus: sys.id, at: 'twin' })}" data-fk="to-twin">${T('在 3D 查看', 'View in 3D')}</a>
        </div>
        <p class="hint">${T('注入故障只改這個瀏覽器裡的 Demo 資料：這個系統經手的介面會顯示成中斷，所有頁面一起變。', 'Injecting a fault only changes the demo data in this browser: the interfaces this system handles show as down, on every page.')}</p>
        <h3>${T('經手的介面', 'Interfaces it handles')}</h3>
        ${table({
          caption: T('經手的介面', 'Interfaces it handles'),
          empty: T('這個系統沒有登記任何介面。', 'No interface is registered for this system.'),
          rows: mine,
          cols: [
            { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(state, i).health), cls: 'nowrap' },
            {
              head: T('編號', 'ID'),
              cell: (i) => html`<a class="num" href="${withQuery({ iface: i.id, sys: null, impact: null })}">${i.id}</a>`,
              cls: 'nowrap',
            },
            { head: T('介面', 'Interface'), cell: (i) => tx(i.name), cls: 'wide' },
          ],
        })}
      </div>`;
  }

  function pairDetail(state: AppState, pair: Pair): Safe {
    return html`<div class="panel-head"><h2>${systemName(state, pair.from)} → ${systemName(state, pair.to)}</h2><a class="btn btn-sm" href="${withQuery({ pair: null })}" data-fk="close-detail">${icon('close', 13)}${T('關閉', 'Close')}</a></div>
      <div class="panel-body stack"><p>${T('這條連線上有 {n} 條介面。點編號看欄位對應與錯誤處理。', 'This connection carries {n} interfaces. Select an ID for its field mapping and error handling.', { n: pair.ifaces.length })}</p>
      ${table({
        caption: T('這條連線上的介面', 'Interfaces on this connection'),
        empty: '',
        rows: pair.ifaces,
        cols: [
          { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(state, i).health), cls: 'nowrap' },
          { head: T('編號', 'ID'), cell: (i) => html`<a class="num" href="${withQuery({ iface: i.id, pair: null })}">${i.id}</a>`, cls: 'nowrap' },
          { head: T('介面', 'Interface'), cell: (i) => tx(i.name), cls: 'wide' },
        ],
      })}</div>`;
  }

  function legend(counts: Record<Health, number>): Safe {
    return html`<span>${T('線型也代表狀態：', 'Line style shows status too:')}</span>
      <span>${T('實線', 'solid')} ${mark('ok')} <a class="num" href="${withQuery({ health: 'ok' })}">${counts.ok}</a></span>
      <span>${T('點線', 'dotted')} ${mark('warn')} <a class="num" href="${withQuery({ health: 'warn' })}">${counts.warn}</a></span>
      <span>${T('粗虛線', 'heavy dashed')} ${mark('crit')} <a class="num" href="${withQuery({ health: 'crit' })}">${counts.crit}</a></span>
      <span class="muted">${T('點一條線看它上面的介面；點一個方塊看「如果它停了」會影響誰。經整合層的介面畫成兩段。', 'Select a line for the interfaces on it; select a box to see who is affected if it stops. Interfaces through the integration layer are drawn in two segments.')}</span>`;
  }

  function render(): void {
    const state = store.state;
    const f: Filters = { domain: q('domain'), vendor: q('vendor'), health: q('health') };
    const tech = can('iface.detail');
    const selIface = state.ifaces.find((i) => i.id === q('iface'));
    const selSys = state.systems.find((s) => s.id === q('sys'));
    const selPair = pairsOf(state).find((p) => p.id === q('pair'));
    const impactSys = state.systems.find((s) => s.id === q('impact'));
    const impact = impactSys ? impactOf(state, impactSys.id) : null;
    const shown = state.ifaces.filter((i) => matches(state, i, f));
    const counts: Record<Health, number> = { ok: 0, warn: 0, crit: 0 };
    for (const iface of state.ifaces) counts[ifaceStatus(state, iface).health]++;
    const tab = q('tab') === 'apis' ? 'apis' : 'ifaces';

    setHtml(
      $('#int-head', root),
      pageHead(
        T('整合架構', 'Integration'),
        T('{s} 個系統、{n} 條介面：{ok} 條正常、{warn} 條注意、{crit} 條中斷。', '{s} systems, {n} interfaces: {ok} OK, {warn} need attention, {crit} down.', {
          s: state.systems.length,
          n: state.ifaces.length,
          ...counts,
        }),
      ),
    );

    const select = (id: string, label: string, value: string, options: [string, string][]) =>
      html`<label for="${id}">${label}</label><select id="${id}" data-filter="${id.replace('f-', '')}">${options.map(([v, text]) => html`<option value="${v}" ${v === value ? raw('selected') : ''}>${text}</option>`)}</select>`;
    setHtml(
      $('#int-filters', root),
      html`<div class="filters">
        ${select('f-domain', T('領域', 'Domain'), f.domain, [['', T('全部', 'All')], ...(Object.keys(DOMAIN_NAME) as Domain[]).map((d): [string, string] => [d, tx(DOMAIN_NAME[d])])])}
        ${select('f-vendor', T('廠商', 'Vendor'), f.vendor, [['', T('全部', 'All')], ['internal', T('內部維護', 'In-house')], ...state.vendors.map((v): [string, string] => [v.id, tx(v.name)])])}
        ${select('f-health', T('狀態', 'Status'), f.health, [
          ['', T('全部', 'All')],
          ['attention', T('注意與中斷', 'Attention and down')],
          ['ok', healthLabel('ok')],
          ['warn', healthLabel('warn')],
          ['crit', healthLabel('crit')],
        ])}
        <span class="filters-n">${T('符合 {n} 條', '{n} match', { n: shown.length })}</span>
        ${f.domain || f.vendor || f.health ? html`<a class="btn btn-sm" href="${withQuery({ domain: null, vendor: null, health: null })}" data-fk="clear-filters">${T('清除篩選', 'Clear filters')}</a>` : ''}
        ${impactSys ? html`${tag(T('影響範圍：{s}', 'Impact of: {s}', { s: tx(impactSys.name) }), 'crit')}<a class="btn btn-sm" href="${withQuery({ impact: null })}" data-fk="clear-impact">${T('取消標示', 'Clear highlight')}</a>` : ''}
      </div>`,
    );

    const side = $('#int-side', root);
    const detail =
      selIface && tech
        ? ifaceDetail(state, selIface)
        : selSys
          ? systemDetail(state, selSys, impactSys?.id === selSys.id)
          : selPair
            ? pairDetail(state, selPair)
            : null;
    side.hidden = !detail;
    $('#int-main', root).classList.toggle('has-side', !!detail);
    if (detail) setHtml(side, detail);
    setHtml($('#int-legend', root), legend(counts));

    const next = spec(state, f, selIface, selPair?.id, impact);
    const selectedId = selSys?.id ?? selPair?.id ?? null;
    if (flow) flow.update(next, selectedId);
    else
      flow = attachFlow($('#int-flow', root), next, {
        layoutKey: 'integration',
        selected: selectedId,
        onNodeClick: (id) => setQuery({ sys: id, iface: null, pair: null }),
        onEdgeClick: (id) => {
          const pair = pairsOf(store.state).find((p) => p.id === id);
          if (!pair) return;
          setQuery(pair.ifaces.length === 1 ? { iface: pair.ifaces[0].id, sys: null, pair: null } : { pair: id, iface: null, sys: null });
        },
      });

    const ifaceTable = table<Iface>({
      id: 'iface-table',
      caption: T('介面清單', 'Interface list'),
      empty: T('沒有符合篩選條件的介面。清除篩選可以看到全部 24 條。', 'No interface matches the filters. Clear them to see all 24.'),
      rows: shown,
      rowAttrs: (i) => html` data-row="${i.id}" class="${i.id === selIface?.id ? 'is-selected' : ''}"`,
      cols: [
        { head: T('狀態', 'Status'), cell: (i) => mark(ifaceStatus(state, i).health), cls: 'nowrap' },
        { head: T('編號', 'ID'), cell: (i) => html`<a class="num" href="${withQuery({ iface: i.id, sys: null, pair: null })}">${i.id}</a>`, cls: 'nowrap' },
        { head: T('介面', 'Interface'), cell: (i) => tx(i.name), cls: 'wide' },
        { head: T('協定', 'Protocol'), cell: (i) => i.protocol, cls: 'nowrap' },
        { head: T('頻率', 'Frequency'), cell: (i) => scheduleLabel(i.schedule), cls: 'nowrap' },
        { head: T('契約', 'Contract'), cell: (i) => html`<span class="num">${i.contract}</span>`, cls: 'nowrap' },
        { head: T('負責人', 'Owner'), cell: (i) => personName(state, i.ownerId), cls: 'nowrap' },
        { head: T('廠商', 'Vendor'), cell: (i) => vendorName(state, i.vendorId), cls: 'nowrap' },
        {
          head: T('最近一次', 'Last run'),
          cell: (i) => html`<span class="num">${fmtStamp(ifaceStatus(state, i).run?.at ?? state.clock)}</span>`,
          cls: 'nowrap',
        },
        {
          head: T('最近 12 次', 'Last 12 runs'),
          cell: (i) =>
            runStrip(
              runsOf(state, i.id)
                .slice(0, 12)
                .reverse()
                .map((r) => RUN_HEALTH[r.status]),
              T('最近 12 次執行的結果，由舊到新', 'Results of the last 12 runs, oldest first'),
            ),
        },
      ],
    });

    const selApi = q('api');
    const apiTable = table<ApiEntry>({
      id: 'api-table',
      caption: T('API 目錄', 'API catalogue'),
      empty: T('還沒有登記任何 API。', 'No API is registered yet.'),
      rows: state.apis,
      rowAttrs: (a) => html` class="${a.id === selApi ? 'is-selected' : ''}"`,
      cols: [
        {
          head: T('狀態', 'Status'),
          cell: (a) =>
            a.status === 'active'
              ? mark('ok', T('使用中', 'Active'))
              : a.status === 'deprecated'
                ? mark('warn', T('即將停用', 'Deprecated'))
                : tag(T('已停用', 'Retired')),
          cls: 'nowrap',
        },
        { head: 'API', cell: (a) => html`<span class="num">${a.id}</span> ${tx(a.name)}`, cls: 'wide' },
        { head: T('系統', 'System'), cell: (a) => systemName(state, a.systemId), cls: 'nowrap' },
        { head: T('型式', 'Style'), cell: (a) => a.style, cls: 'nowrap' },
        { head: T('版本', 'Version'), cell: (a) => html`<span class="num">${a.version}</span>`, cls: 'nowrap' },
        { head: T('停用日', 'Sunset date'), cell: (a) => (a.sunset ? html`<span class="num">${a.sunset}</span>` : '–'), cls: 'nowrap' },
        { head: T('接手的 API', 'Successor'), cell: (a) => (a.successor ? html`<span class="num">${a.successor}</span>` : '–'), cls: 'nowrap' },
        {
          head: T('使用它的介面', 'Used by'),
          cell: (a) => {
            const users = state.ifaces.filter((i) => i.apiId === a.id);
            return users.length
              ? html`${users.map((i, n) => html`${n ? T('、', ', ') : ''}<a class="num" href="${withQuery({ iface: i.id, tab: null, api: null })}">${i.id}</a>`)}`
              : T('沒有', 'None');
          },
        },
        { head: T('備註', 'Note'), cell: (a) => tx(a.note), cls: 'wide' },
      ],
    });

    setHtml(
      $('#int-lists', root),
      html`<section class="panel">${tabs(
        [
          { id: 'ifaces', label: T('介面清單', 'Interface list'), count: shown.length },
          { id: 'apis', label: T('API 目錄', 'API catalogue'), count: state.apis.length },
        ],
        tab,
      )}${tab === 'apis' ? apiTable : ifaceTable}</section>`,
    );
  }

  const offs = [
    on(root, 'change', '[data-filter]', (_e, el) => setQuery({ [el.dataset.filter ?? '']: (el as HTMLSelectElement).value || null })),
    on(root, 'click', '[data-tab]', (_e, el) => setQuery({ tab: el.dataset.tab === 'apis' ? 'apis' : null })),
    on(root, 'click', '#iface-table tr[data-row]', (event, el) => {
      if ((event.target as Element).closest('a')) return;
      setQuery({ iface: el.dataset.row ?? null, sys: null, pair: null });
    }),
    on(root, 'click', '[data-act="resend"]', (_e, el) => {
      const n = resend(el.dataset.iface ?? '');
      if (n) toast(T('已重送 {n} 筆，全部成功', 'Resent {n} {n|record|records}; all succeeded', { n }));
    }),
    on(root, 'click', '[data-act="fault"]', (_e, el) => {
      const id = el.dataset.sys as SystemId;
      const now = toggleFault(id);
      toast(
        now
          ? T('已注入故障：{s} 經手的介面顯示成中斷', 'Fault injected: interfaces handled by {s} now show as down', { s: systemName(store.state, id) })
          : T('已解除故障', 'Fault cleared'),
        now ? 'warn' : 'ok',
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
