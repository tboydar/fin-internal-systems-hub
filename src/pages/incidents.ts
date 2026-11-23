import { audit, can, persona } from '../core/auth';
import { fmtDate, fmtDay, fmtStamp, hoursBetween, isWorkday, TODAY } from '../core/date';
import { freezeOn, freezes } from '../core/derive';
import { L, T, tx } from '../core/i18n';
import { fmtHoursText } from '../core/narrative';
import { href, type Route, setQuery } from '../core/router';
import { store } from '../core/store';
import type { AppState, Change, Incident, IncidentStage, L10n } from '../core/types';
import { html, on, raw, type Safe, setHtml, toast } from '../ui/dom';
import { canOpen, type PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, panel, personName, systemName, table, tabs, tag } from '../ui/widgets';

// 事件與變更：事件流程、變更行事曆、不可逆變更的人工把關清單、事後檢討。
// 稽核可以看，但所有按鈕都是鎖的。

const STAGES: [IncidentStage, L10n][] = [
  ['triggered', L('觸發', 'Triggered')],
  ['assigned', L('指派', 'Assigned')],
  ['mitigating', L('處理', 'Mitigating')],
  ['recovered', L('恢復', 'Recovered')],
  ['review', L('檢討', 'Review')],
  ['closed', L('結案', 'Closed')],
];
const STAGE_NAME = Object.fromEntries(STAGES) as Record<IncidentStage, L10n>;

const KIND_NAME: Record<Change['kind'], L10n> = { standard: L('標準', 'Standard'), normal: L('一般', 'Normal'), emergency: L('緊急', 'Emergency') };
const STATUS_NAME: Record<Change['status'], L10n> = {
  requested: L('等核准', 'Awaiting approval'),
  approved: L('已核准', 'Approved'),
  done: L('已完成', 'Done'),
  rejected: L('退回', 'Rejected'),
};

/** 這張變更現在能不能核准；不能的話回傳原因。 */
export function approvalBlock(change: Change): L10n | null {
  const freeze = freezeOn(change.date);
  if (freeze && change.kind !== 'emergency' && change.kind !== 'standard') {
    return L(
      `排在${freeze.name.zh}（${freeze.start.slice(5)}～${freeze.end.slice(5)}）；一般變更要改期，或改成緊急變更`,
      `Falls in the ${freeze.name.en.toLowerCase()} (${freeze.start.slice(5)} to ${freeze.end.slice(5)}); reschedule it or raise it as an emergency change`,
    );
  }
  const unchecked = change.gates.filter((g) => !g.checkedBy).length;
  if (unchecked) return L(`把關清單還有 ${unchecked} 項沒勾`, `${unchecked} gate ${unchecked === 1 ? 'item is' : 'items are'} still unchecked`);
  return null;
}

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  const who = (id: string | null) => (id === 'system' ? T('系統告警', 'System alert') : personName(store.state, id));

  function incidentDetail(state: AppState, inc: Incident): Safe {
    const at = new Map(inc.timeline.map((e) => [e.stage, e]));
    const reached = STAGES.findIndex(([stage]) => stage === inc.stage);
    const adr = state.adrs.find((a) => a.id === inc.adrId);
    const item = state.roadmap.find((r) => r.id === inc.roadmapId);
    return panel(
      `${inc.id} ${tx(inc.title)}`,
      html`<div class="panel-body stack" id="incident-detail">
        <ol class="stages" aria-label="${T('事件流程', 'Incident flow')}">${STAGES.map(([stage, name], i) => {
          const entry = at.get(stage);
          return html`<li class="${i <= reached ? 'is-done' : ''}${i === reached ? ' is-now' : ''}"><b>${tx(name)}</b>${
            entry
              ? html`<span class="num">${fmtStamp(entry.at)}</span><span>${who(entry.by)}</span>`
              : html`<span class="muted">${T('還沒到', 'Not yet')}</span>`
          }</li>`;
        })}</ol>
        ${facts([
          [T('影響', 'Impact'), tx(inc.impact)],
          [T('原因', 'Root cause'), tx(inc.rootCause)],
          [T('怎麼恢復的', 'How it was restored'), tx(inc.fix)],
          [
            T('恢復花了多久', 'Time to restore'),
            inc.recoveredAt ? tx(fmtHoursText(hoursBetween(inc.startedAt, inc.recoveredAt))) : T('還沒恢復', 'Not restored yet'),
          ],
          [
            T('相關', 'Related'),
            html`${inc.ifaceId ? (can('page.integration') ? html`<a class="num" href="${href('/integration', { iface: inc.ifaceId })}">${inc.ifaceId}</a>` : inc.ifaceId) : systemName(state, inc.systemId)}${
              adr
                ? html`${T('；', '; ')}${canOpen('/team') ? html`<a href="${href('/team', { tab: 'adr', adr: adr.id })}">${adr.id}</a>` : adr.id} ${tx(adr.title)}`
                : ''
            }${item ? html`${T('；', '; ')}${canOpen('/roadmap') ? html`<a href="${href('/roadmap', { item: item.id })}">${item.id}</a>` : item.id} ${tx(item.title)}` : ''}`,
          ],
        ])}
        <h3>${T('事後檢討的改善項目', 'Actions from the review')}</h3>
        ${table({
          caption: T('改善項目', 'Actions'),
          empty:
            inc.stage === 'closed' || inc.stage === 'review'
              ? T('這次沒有列改善項目。', 'No actions were listed this time.')
              : T(
                  '事件恢復後三個工作天內開檢討會，改善項目會列在這裡。',
                  'A review is held within three working days of recovery; its actions will be listed here.',
                ),
          rows: inc.actions.map((a, i) => ({ ...a, i })),
          cols: [
            { head: T('做什麼', 'Action'), cell: (a) => tx(a.text), cls: 'wide' },
            { head: T('誰', 'Owner'), cell: (a) => personName(state, a.ownerId), cls: 'nowrap' },
            { head: T('期限', 'Due'), cell: (a) => html`<span class="num">${a.due}</span>`, cls: 'nowrap' },
            {
              head: T('狀態', 'Status'),
              cell: (a) => (a.done ? mark('ok', T('完成', 'Done')) : a.due < TODAY ? mark('crit', T('過期', 'Overdue')) : mark('warn', T('進行中', 'Open'))),
              cls: 'nowrap',
            },
            {
              head: T('更新', 'Update'),
              cell: (a) =>
                actionBtn({
                  act: 'toggle-action',
                  label: a.done ? T('改回進行中', 'Reopen') : T('標成完成', 'Mark done'),
                  perm: 'incident.manage',
                  small: true,
                  data: { inc: inc.id, i: String(a.i) },
                }),
              cls: 'nowrap',
            },
          ],
        })}
      </div>`,
      { id: 'incident-panel', actions: html`<a class="btn btn-sm" href="${href('/incidents')}" data-fk="close-inc">${T('關閉', 'Close')}</a>` },
    );
  }

  function changeDetail(state: AppState, change: Change): Safe {
    const block = approvalBlock(change);
    return panel(
      `${change.id} ${tx(change.title)}`,
      html`<div class="panel-body stack" id="change-detail">
        ${facts([
          [
            T('時間', 'When'),
            html`<span class="num">${fmtDate(change.date)} ${change.window}</span>${isWorkday(change.date) ? '' : T('（非上班日）', ' (non-working day)')}`,
          ],
          [T('系統', 'System'), systemName(state, change.systemId)],
          [T('類型', 'Type'), `${tx(KIND_NAME[change.kind])}${change.irreversible ? T('；不可逆', '; irreversible') : ''}`],
          [T('提出人', 'Raised by'), personName(state, change.requesterId)],
          [T('回滾', 'Rollback'), tx(change.rollback)],
          [
            T('狀態', 'Status'),
            `${tx(STATUS_NAME[change.status])}${change.approvedBy ? T('（{p} 核准）', ' (approved by {p})', { p: personName(state, change.approvedBy) }) : ''}`,
          ],
        ])}
        ${
          change.gates.length
            ? html`<h3>${T('人工把關清單', 'Manual gate checklist')}</h3>
              <p>${
                change.irreversible
                  ? T(
                      '這個變更做了就退不回去。每一項都要有人勾選並具名，才能核准。',
                      'This change cannot be undone. Every item needs a named check before it can be approved.',
                    )
                  : T(
                      '這個變更影響範圍大。每一項都要有人勾選並具名，才能核准。',
                      'This change has a wide impact. Every item needs a named check before it can be approved.',
                    )
              }</p>
              <ul class="gates">${change.gates.map(
                (g) =>
                  html`<li><label><input type="checkbox" data-gate="${g.id}" data-chg="${change.id}" id="gate-${g.id}" ${g.checkedBy ? raw('checked') : ''} ${
                    can('gate.check') && change.status === 'requested' ? '' : raw('disabled')
                  } /> ${tx(g.text)}</label><span class="muted">${g.checkedBy ? T('{p} 勾選', 'checked by {p}', { p: who(g.checkedBy) }) : T('還沒有人勾', 'not checked yet')}</span></li>`,
              )}</ul>`
            : ''
        }
        ${
          change.status === 'requested'
            ? html`<div class="callout ${block ? 'is-warn' : ''}"><p>${block ? tx(block) : T('可以核准。核准後會寫一筆稽核軌跡。', 'Ready to approve. Approval writes an audit entry.')}</p>
                ${actionBtn({ act: 'approve', label: T('核准這張變更', 'Approve this change'), perm: 'release.approve', primary: true, data: { chg: change.id }, disabledWhy: block ? tx(block) : undefined })}</div>`
            : ''
        }
      </div>`,
      {
        id: 'change-panel',
        actions: html`<a class="btn btn-sm" href="${href('/incidents', { tab: 'changes' })}" data-fk="close-chg">${T('關閉', 'Close')}</a>`,
      },
    );
  }

  function render(): void {
    const state = store.state;
    const tab = route.query.get('tab') === 'changes' || route.query.get('chg') ? 'changes' : 'incidents';
    const inc = state.incidents.find((i) => i.id === route.query.get('inc'));
    const chg = state.changes.find((c) => c.id === route.query.get('chg'));
    const open = state.incidents.filter((i) => i.stage !== 'closed');
    const waiting = state.changes.filter((c) => c.status === 'requested');
    const upcoming = [...state.changes].sort((a, b) => (a.date < b.date ? -1 : 1));
    const windows = freezes(TODAY.slice(0, 7), '2027-01');

    const incidents = table<Incident>({
      id: 'incident-table',
      caption: T('事件', 'Incidents'),
      empty: T('沒有事件紀錄。', 'No incidents on record.'),
      rows: state.incidents,
      rowAttrs: (i) => html` class="${i.id === inc?.id ? 'is-selected' : ''}"`,
      cols: [
        {
          head: T('狀態', 'Status'),
          cell: (i) =>
            i.stage === 'closed'
              ? mark('ok', tx(STAGE_NAME.closed))
              : mark(i.stage === 'recovered' || i.stage === 'review' ? 'warn' : 'crit', tx(STAGE_NAME[i.stage])),
          cls: 'nowrap',
        },
        {
          head: T('編號', 'ID'),
          cell: (i) => html`<a class="num" href="${href('/incidents', { inc: i.id })}" data-fk="inc:${i.id}">${i.id}</a>`,
          cls: 'nowrap',
        },
        { head: T('嚴重度', 'Severity'), cell: (i) => tag(i.severity, i.severity === 'S1' ? 'crit' : i.severity === 'S2' ? 'warn' : 'plain'), cls: 'nowrap' },
        { head: T('事件', 'Incident'), cell: (i) => tx(i.title), cls: 'wide' },
        { head: T('系統', 'System'), cell: (i) => systemName(state, i.systemId), cls: 'nowrap' },
        {
          head: T('發生', 'Started'),
          cell: (i) => html`<span class="num">${i.startedAt.slice(0, 10)} ${fmtStamp(i.startedAt).split(' ')[1]}</span>`,
          cls: 'nowrap',
        },
        { head: T('恢復花了', 'Restored in'), cell: (i) => (i.recoveredAt ? tx(fmtHoursText(hoursBetween(i.startedAt, i.recoveredAt))) : '–'), cls: 'num' },
        { head: T('負責人', 'Owner'), cell: (i) => who(i.ownerId), cls: 'nowrap' },
        { head: T('改善項目', 'Actions'), cell: (i) => `${i.actions.filter((a) => a.done).length}/${i.actions.length}`, cls: 'num' },
      ],
    });

    const changes = table<Change>({
      id: 'change-table',
      caption: T('變更行事曆', 'Change calendar'),
      empty: T('沒有排定的變更。', 'No changes are scheduled.'),
      rows: upcoming,
      rowAttrs: (c) => html` class="${c.id === chg?.id ? 'is-selected' : ''}"`,
      cols: [
        { head: T('日期', 'Date'), cell: (c) => html`<span class="num">${fmtDay(c.date)}</span>`, cls: 'nowrap' },
        { head: T('時段', 'Window'), cell: (c) => html`<span class="num">${c.window}</span>`, cls: 'nowrap' },
        {
          head: T('編號', 'ID'),
          cell: (c) => html`<a class="num" href="${href('/incidents', { chg: c.id })}" data-fk="chg:${c.id}">${c.id}</a>`,
          cls: 'nowrap',
        },
        {
          head: T('變更', 'Change'),
          cell: (c) => html`${tx(c.title)}${c.irreversible ? html` ${tag(T('不可逆', 'Irreversible'), 'crit')}` : ''}`,
          cls: 'wide',
        },
        { head: T('系統', 'System'), cell: (c) => systemName(state, c.systemId), cls: 'nowrap' },
        { head: T('類型', 'Type'), cell: (c) => tx(KIND_NAME[c.kind]), cls: 'nowrap' },
        {
          head: T('凍結期', 'Freeze'),
          cell: (c) => (freezeOn(c.date) ? tag(tx(freezeOn(c.date)?.name), c.kind === 'standard' ? 'plain' : 'warn') : '–'),
          cls: 'nowrap',
        },
        {
          head: T('狀態', 'Status'),
          cell: (c) =>
            c.status === 'done'
              ? mark('ok', tx(STATUS_NAME.done))
              : c.status === 'approved'
                ? mark('ok', tx(STATUS_NAME.approved))
                : mark('warn', tx(STATUS_NAME[c.status])),
          cls: 'nowrap',
        },
        { head: T('提出人', 'Raised by'), cell: (c) => personName(state, c.requesterId), cls: 'nowrap' },
      ],
    });

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(
          T('事件與變更', 'Incidents & changes'),
          T(
            '{o} 個事件處理中，{n} 個已結案。{w} 張變更等核准。',
            '{o} {o|incident|incidents} in progress, {n} closed. {w} {w|change awaits|changes await} approval.',
            {
              o: open.length,
              n: state.incidents.length - open.length,
              w: waiting.length,
            },
          ),
        )}
        ${can('release.approve') || can('incident.manage') ? '' : html`<p class="hint">${T('這個角色只能檢視，所有按鈕都是鎖的。', 'This role can only view; every button is locked.')}</p>`}
        <section class="panel">${tabs(
          [
            { id: 'incidents', label: T('事件', 'Incidents'), count: state.incidents.length },
            { id: 'changes', label: T('變更行事曆', 'Change calendar'), count: state.changes.length },
          ],
          tab,
        )}
        ${
          tab === 'changes'
            ? html`<p class="panel-body hint" id="freeze-list">${T('凍結期：', 'Freeze periods: ')}${windows.map((f, i) => html`${i ? T('；', '; ') : ''}${tx(f.name)} <span class="num">${f.start.slice(5).replace('-', '/')}–${f.end.slice(5).replace('-', '/')}</span>`)}${T(
                '。凍結期間只排標準變更與緊急變更。',
                '. Only standard and emergency changes are scheduled during a freeze.',
              )}</p>${changes}`
            : incidents
        }</section>
        ${tab === 'changes' ? (chg ? changeDetail(state, chg) : '') : inc ? incidentDetail(state, inc) : ''}
      </div>`,
    );
  }

  const offs = [
    on(root, 'click', '[data-tab]', (_e, el) => setQuery({ tab: el.dataset.tab === 'changes' ? 'changes' : null, inc: null, chg: null })),
    on(root, 'click', '[data-act="toggle-action"]', (_e, el) => {
      store.update((s) => {
        const incident = s.incidents.find((i) => i.id === el.dataset.inc);
        const action = incident?.actions[Number(el.dataset.i)];
        if (!incident || !action) return;
        action.done = !action.done;
        audit(s, action.done ? L('改善項目完成', 'Action completed') : L('改善項目改回進行中', 'Action reopened'), incident.id, action.text);
      });
    }),
    on(root, 'change', '[data-gate]', (_e, el) => {
      const checked = (el as HTMLInputElement).checked;
      store.update((s) => {
        const gate = s.changes.find((c) => c.id === el.dataset.chg)?.gates.find((g) => g.id === el.dataset.gate);
        if (!gate) return;
        gate.checkedBy = checked ? (persona().person?.id ?? persona().role) : undefined;
        audit(s, checked ? L('勾選把關項目', 'Checked gate item') : L('取消把關項目', 'Unchecked gate item'), el.dataset.chg ?? '', gate.text);
      });
    }),
    on(root, 'click', '[data-act="approve"]', (_e, el) => {
      store.update((s) => {
        const change = s.changes.find((c) => c.id === el.dataset.chg);
        if (change?.status !== 'requested' || approvalBlock(change)) return;
        change.status = 'approved';
        change.approvedBy = persona().person?.id ?? persona().role;
        audit(s, L('核准變更', 'Approved change'), change.id, change.title);
      });
      toast(T('已核准，稽核軌跡多一筆', 'Approved; one audit entry added'));
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
