import { resolveDiff } from '../core/actions';
import { can } from '../core/auth';
import { fmtStamp } from '../core/date';
import { openDiffs, ruleTotals } from '../core/derive';
import { T, tx } from '../core/i18n';
import { href, type Route, setQuery } from '../core/router';
import { store } from '../core/store';
import type { AppState, ReconDiff, ReconRule } from '../core/types';
import { $, html, nt, num, on, type Safe, setHtml, toast } from '../ui/dom';
import type { PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, panel, personName, systemName, table, tag } from '../ui/widgets';

// 資料一致性：10 條對帳規則。每條規則看得到它的 SQL，差異可以點到每一筆。
// 財務主管看到的是「哪幾筆帳對不起來、哪張報表受影響」，沒有 SQL。

const KIND = (kind: ReconRule['kind']) => (kind === 'count' ? T('筆數', 'Count') : kind === 'amount' ? T('金額', 'Amount') : 'Checksum');

function total(rule: ReconRule, value: number): string {
  if (rule.kind === 'amount') return nt(value);
  return rule.kind === 'checksum' ? T('{n} 塊', '{n} blocks', { n: num(value) }) : T('{n} 筆', '{n} rows', { n: num(value) });
}

/** 從執行計畫的最後一行讀出執行時間，不另外寫死。 */
function execTime(plan: string): string {
  const ms = Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? 0);
  return ms >= 1000 ? T('{n} 秒', '{n} s', { n: (ms / 1000).toFixed(1) }) : T('{n} 毫秒', '{n} ms', { n: Math.round(ms) });
}

/** 差異的鍵值如果是據點代碼，就顯示據點名稱。 */
function keyLabel(state: AppState, key: string): string {
  const branch = state.branches.find((b) => b.id === key);
  return branch ? tx(branch.name) : key;
}

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  const side = (state: AppState, rule: ReconRule, i: 0 | 1) => (rule.sideNames ? tx(rule.sideNames[i]) : systemName(state, i === 0 ? rule.left : rule.right));

  function detail(state: AppState, rule: ReconRule, tech: boolean): Safe {
    const totals = ruleTotals(state, rule);
    const all = state.reconDiffs.filter((d) => d.ruleId === rule.id);
    const resolved = all.filter((d) => d.status === 'resolved');
    const diffs = table<ReconDiff>({
      id: 'diff-table',
      caption: T('差異明細', 'Differences'),
      empty: resolved.length
        ? T('這條規則的 {n} 筆差異都已經處理完。', 'All {n} differences under this rule have been dealt with.', { n: resolved.length })
        : T('兩邊是平的，沒有差異。', 'Both sides agree; there are no differences.'),
      rows: totals.diffs,
      cols: [
        { head: tech ? T('鍵值', 'Key') : T('哪一筆', 'Which one'), cell: (d) => html`<span class="num">${keyLabel(state, d.key)}</span>`, cls: 'nowrap' },
        { head: side(state, rule, 0), cell: (d) => tx(d.left) },
        { head: side(state, rule, 1), cell: (d) => tx(d.right) },
        ...(rule.kind === 'amount' ? [{ head: T('差額', 'Difference'), cell: (d: ReconDiff) => nt(d.amount), cls: 'num' as const }] : []),
        { head: T('原因', 'Reason'), cell: (d) => tx(d.reason), cls: 'wide' },
        { head: T('發現時間', 'Found'), cell: (d) => html`<span class="num">${fmtStamp(d.foundAt)}</span>`, cls: 'nowrap' },
        {
          head: T('處理', 'Action'),
          cell: (d) => actionBtn({ act: 'resolve', label: T('標成已處理', 'Mark as resolved'), perm: 'recon.resolve', small: true, data: { diff: d.id } }),
          cls: 'nowrap',
        },
      ],
    });
    const plan = rule.plan;
    return panel(
      tech ? `${rule.id} ${tx(rule.name)}` : tx(rule.plain),
      html`<div class="panel-body stack" id="rule-detail">
        ${facts([
          [T('比對什麼', 'What is compared'), tech ? tx(rule.plain) : `${side(state, rule, 0)} ${T('對', 'vs')} ${side(state, rule, 1)}`],
          [T('受影響的報表', 'Affected reports'), tx(rule.report)],
          [
            T('兩邊的總數', 'Totals'),
            html`<span class="num">${side(state, rule, 0)} ${total(rule, totals.left)}${T('；', '; ')}${side(state, rule, 1)} ${total(rule, totals.right)}</span>`,
          ],
          [T('容許差異', 'Tolerance'), tx(rule.tolerance)],
          [T('多久比一次', 'Schedule'), `${tx(rule.schedule)}${T('；上次 ', '; last run ')}${fmtStamp(rule.lastRunAt)}`],
          [T('負責人', 'Owner'), personName(state, rule.ownerId)],
          ...(tech
            ? [
                [
                  T('相關介面', 'Interfaces'),
                  html`${rule.ifaceIds.map((id, i) => html`${i ? T('、', ', ') : ''}${can('page.integration') ? html`<a class="num" href="${href('/integration', { iface: id })}">${id}</a>` : id}`)}`,
                ] as [string, Safe],
              ]
            : []),
        ])}
        <h3>${T('差異明細', 'Differences')}${totals.diffs.length ? T('（{n} 筆未結）', ' ({n} open)', { n: totals.diffs.length }) : ''}</h3>
        ${diffs}
        ${
          can('sql.view')
            ? html`<h3>${T('這條規則的 SQL', 'SQL for this rule')}</h3><pre class="code" tabindex="0" aria-label="SQL"><code>${rule.sql}</code></pre>
              ${
                plan
                  ? html`<h3>${T('查詢優化前後的執行計畫', 'Query plan before and after tuning')}</h3>
                    <p>${tx(plan.note)}</p>
                    <div class="plans">
                      <figure><figcaption>${mark('crit', T('優化前：{t}', 'Before: {t}', { t: execTime(plan.before) }))}</figcaption><pre class="code" tabindex="0"><code>${plan.before}</code></pre></figure>
                      <figure><figcaption>${mark('ok', T('優化後：{t}', 'After: {t}', { t: execTime(plan.after) }))}</figcaption><pre class="code" tabindex="0"><code>${plan.after}</code></pre></figure>
                    </div>
                    <h3>${T('加的索引', 'Indexes added')}</h3><pre class="code" tabindex="0"><code>${plan.ddl}</code></pre>
                    <p class="hint">${T('格式是 PostgreSQL 的 EXPLAIN (ANALYZE)。表名、列數與時間都是為這個 Demo 編的。', 'The format is PostgreSQL EXPLAIN (ANALYZE). Table names, row counts and timings are made up for this demo.')}</p>`
                  : ''
              }`
            : html`<p class="hint">${T('規則的寫法由資訊處維護。要調整比對方式，請到「需求與決策」提出。', 'IT maintains how each rule is written. To change what is compared, submit a request under “Requests & decisions”.')}</p>`
        }
      </div>`,
      { id: 'rule-panel', actions: html`<a class="btn btn-sm" href="${href('/consistency')}" data-fk="close-rule">${T('關閉', 'Close')}</a>` },
    );
  }

  function render(): void {
    const state = store.state;
    const tech = can('sql.view');
    const selected = state.reconRules.find((r) => r.id === route.query.get('rule'));
    const open = openDiffs(state);
    const dirty = state.reconRules.filter((r) => openDiffs(state, r.id).length);
    const link = (r: ReconRule, label: string) => html`<a href="${href('/consistency', { rule: r.id })}" data-fk="rule:${r.id}">${label}</a>`;
    const status = (r: ReconRule) =>
      openDiffs(state, r.id).length
        ? mark(r.id === 'RC-10' || openDiffs(state, r.id).length > 5 ? 'crit' : 'warn', T('有差異', 'Differences'))
        : mark('ok', T('平', 'Balanced'));

    const rules = table<ReconRule>({
      id: 'rule-table',
      caption: T('對帳規則', 'Reconciliation rules'),
      empty: T('還沒有設定任何對帳規則。', 'No reconciliation rule is set up yet.'),
      rows: tech ? state.reconRules : [...dirty, ...state.reconRules.filter((r) => !dirty.includes(r))],
      rowAttrs: (r) => html` class="${r.id === selected?.id ? 'is-selected' : ''}"`,
      cols: tech
        ? [
            { head: T('狀態', 'Status'), cell: status, cls: 'nowrap' },
            { head: T('編號', 'ID'), cell: (r) => html`<span class="num">${link(r, r.id)}</span>`, cls: 'nowrap' },
            { head: T('規則', 'Rule'), cell: (r) => tx(r.name), cls: 'wide' },
            { head: T('類型', 'Type'), cell: (r) => tag(KIND(r.kind)), cls: 'nowrap' },
            { head: T('左側', 'Left'), cell: (r) => total(r, ruleTotals(state, r).left), cls: 'num' },
            { head: T('右側', 'Right'), cell: (r) => total(r, ruleTotals(state, r).right), cls: 'num' },
            { head: T('差異', 'Open'), cell: (r) => openDiffs(state, r.id).length, cls: 'num' },
            { head: T('上次執行', 'Last run'), cell: (r) => html`<span class="num">${fmtStamp(r.lastRunAt)}</span>`, cls: 'nowrap' },
            { head: T('負責人', 'Owner'), cell: (r) => personName(state, r.ownerId), cls: 'nowrap' },
          ]
        : [
            { head: T('狀態', 'Status'), cell: status, cls: 'nowrap' },
            { head: T('比對什麼', 'What is compared'), cell: (r) => link(r, tx(r.plain)), cls: 'wide' },
            { head: T('受影響的報表', 'Affected reports'), cell: (r) => tx(r.report) },
            { head: T('還沒結的', 'Open'), cell: (r) => openDiffs(state, r.id).length, cls: 'num' },
            {
              head: T('差額', 'Difference'),
              cell: (r) => (r.kind === 'amount' && ruleTotals(state, r).amount ? nt(ruleTotals(state, r).amount) : '–'),
              cls: 'num',
            },
            { head: T('上次檢查', 'Last checked'), cell: (r) => html`<span class="num">${fmtStamp(r.lastRunAt)}</span>`, cls: 'nowrap' },
          ],
    });

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(
          T('資料一致性', 'Data consistency'),
          T('{n} 條規則：{ok} 條平、{bad} 條有差異，共 {d} 筆還沒結。', '{n} rules: {ok} balanced, {bad} with differences, {d} open in total.', {
            n: state.reconRules.length,
            ok: state.reconRules.length - dirty.length,
            bad: dirty.length,
            d: open.length,
          }),
        )}
        ${panel(T('對帳規則', 'Reconciliation rules'), rules, { note: tech ? T('點編號看 SQL 與每一筆差異', 'Select an ID for the SQL and each difference') : T('點一列看是哪幾筆', 'Select a row to see which ones') })}
        ${selected ? detail(state, selected, tech) : ''}
      </div>`,
    );
  }

  const offs = [
    on(root, 'click', '[data-act="resolve"]', (_e, el) => {
      resolveDiff(el.dataset.diff ?? '');
      toast(T('已標成已處理，稽核軌跡多一筆', 'Marked as resolved; one audit entry added'));
    }),
    on(root, 'click', '#rule-table tbody tr', (event, el) => {
      const anchor = el.querySelector<HTMLAnchorElement>('a[data-fk^="rule:"]');
      if (anchor && !(event.target as Element).closest('a')) setQuery({ rule: anchor.dataset.fk?.slice(5) ?? null });
    }),
    store.subscribe(() => render()),
  ];
  render();
  if (route.query.get('rule')) $('#rule-panel', root).scrollIntoView({ block: 'nearest' });
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
