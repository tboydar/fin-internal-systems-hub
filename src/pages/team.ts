import { audit, can } from '../core/auth';
import { addDays, TODAY } from '../core/date';
import { busFactors, docDue, isStale, loadOf, openTasksOf, SKILLS } from '../core/derive';
import { L, T, tx } from '../core/i18n';
import { href, type Route, setQuery } from '../core/router';
import { store } from '../core/store';
import type { Adr, AppState, Doc, DocKind, Person, Task } from '../core/types';
import { $, html, on, pct, raw, type Safe, setHtml, toast } from '../ui/dom';
import { canOpen, type PageHandle } from '../ui/shell';
import { actionBtn, facts, mark, pageHead, personName, systemName, table, tabs, tag } from '../ui/widgets';

// 團隊與規範：負載、技能矩陣與 bus factor、1:1 紀錄、文件庫、ADR、新人上手路徑。
// 負載是從還沒做完的任務算出來的，所以改派一個任務，兩個人的負載會一起變。

const KIND_NAME: Record<Person['kind'], [string, string]> = {
  internal: ['內部', 'Internal'],
  vendor: ['委外', 'Vendor'],
  business: ['業務單位窗口', 'Business contact'],
};
const DOC_KIND: Record<DocKind, [string, string]> = {
  standard: ['開發規範', 'Standard'],
  api: ['API', 'API'],
  errors: ['錯誤碼', 'Error codes'],
  runbook: ['Runbook', 'Runbook'],
  process: ['流程', 'Process'],
  onboarding: ['新人上手', 'Onboarding'],
};
const TABS = ['people', 'skills', 'notes', 'docs', 'adr', 'onboarding'] as const;
type Tab = (typeof TABS)[number];

export function mount(root: HTMLElement, first: Route): PageHandle {
  let route = first;
  const two = (pair: [string, string]) => T(pair[0], pair[1]);

  function loadCell(state: AppState, p: Person): Safe {
    const load = loadOf(state, p);
    if (!load) return html`<span class="muted">${T('不排工程任務', 'No engineering tasks')}</span>`;
    const level = load.ratio > 1.1 ? 'crit' : load.ratio > 0.9 ? 'warn' : 'ok';
    return html`<span class="load"><span class="bar is-${level}" role="img" aria-label="${pct(load.ratio)}"><i style="width:${Math.min(100, Math.round(load.ratio * 100))}%"></i></span>
      ${mark(level, pct(load.ratio))} <span class="muted num">${load.days}/${p.capacityDays} ${T('天', 'd')}</span></span>`;
  }

  function peopleTab(state: AppState): Safe {
    const assignable = state.people.filter((p) => p.capacityDays > 0 && p.active);
    const open = state.tasks.filter((t) => t.status !== 'done');
    return html`${table<Person>({
      id: 'people-table',
      caption: T('成員', 'Members'),
      empty: T('沒有成員。', 'No members.'),
      rows: state.people,
      cols: [
        { head: T('姓名', 'Name'), cell: (p) => html`${tx(p.name)}${p.active ? '' : html` ${tag(T('已停用', 'Inactive'))}`}`, cls: 'nowrap' },
        { head: T('職稱', 'Title'), cell: (p) => tx(p.title), cls: 'nowrap' },
        { head: T('類別', 'Type'), cell: (p) => `${two(KIND_NAME[p.kind])}${p.vendorId ? T('（{v}）', ' ({v})', { v: tx(p.dept) }) : ''}`, cls: 'nowrap' },
        { head: T('負責範圍', 'Scope'), cell: (p) => tx(p.scope), cls: 'wide' },
        { head: T('兩週內的負載', 'Load over two weeks'), cell: (p) => loadCell(state, p), cls: 'nowrap' },
        {
          head: T('任務', 'Tasks'),
          cell: (p) =>
            p.capacityDays
              ? openTasksOf(state, p.id).length
              : state.demands.filter((d) => d.requesterId === p.id).length
                ? T('{n} 件需求', '{n} requests', { n: state.demands.filter((d) => d.requesterId === p.id).length })
                : '–',
          cls: 'num',
        },
        {
          head: T('帳號', 'Account'),
          cell: (p) =>
            actionBtn({
              act: 'toggle-member',
              label: p.active ? T('停用', 'Deactivate') : T('啟用', 'Activate'),
              perm: 'member.manage',
              small: true,
              data: { person: p.id },
            }),
          cls: 'nowrap',
        },
      ],
    })}
    <div class="panel-body stack"><h3>${T('任務指派', 'Task assignment')}</h3>
    <p class="hint">${can('task.assign') ? T('換一個人，兩個人的負載會立刻跟著變。', 'Pick someone else and both people’s load changes at once.') : T('只有 Tech Lead 能改派任務。', 'Only the Tech Lead can reassign tasks.')}</p>
    ${table<Task>({
      id: 'task-table',
      caption: T('還沒做完的任務', 'Open tasks'),
      empty: T('所有任務都做完了。', 'All tasks are done.'),
      rows: open,
      cols: [
        { head: T('編號', 'ID'), cell: (t) => html`<span class="num">${t.id}</span>`, cls: 'nowrap' },
        { head: T('任務', 'Task'), cell: (t) => tx(t.title), cls: 'wide' },
        { head: T('系統', 'System'), cell: (t) => systemName(state, t.systemId), cls: 'nowrap' },
        { head: T('人天', 'Days'), cell: (t) => t.effortDays, cls: 'num' },
        { head: T('期限', 'Due'), cell: (t) => html`<span class="num">${t.due}</span>`, cls: 'nowrap' },
        {
          head: T('負責人', 'Assignee'),
          cell: (t) =>
            can('task.assign')
              ? html`<select data-task="${t.id}" id="assign-${t.id}" aria-label="${T('{id} 的負責人', 'Assignee of {id}', { id: t.id })}"><option value="">${T('未指派', 'Unassigned')}</option>${assignable.map(
                  (p) => html`<option value="${p.id}" ${p.id === t.assigneeId ? raw('selected') : ''}>${tx(p.name)}</option>`,
                )}</select>`
              : personName(state, t.assigneeId),
          cls: 'nowrap',
        },
      ],
    })}</div>`;
  }

  function skillsTab(state: AppState): Safe {
    const members = state.people.filter((p) => p.kind !== 'business');
    const bus = busFactors(state);
    const dot = (level: number) =>
      level
        ? html`<span class="skill is-${level}" title="${[T('不會', 'None'), T('看得懂', 'Can read'), T('能獨立處理', 'Independent'), T('能教人', 'Can teach')][level]}">${level}</span>`
        : html`<span class="muted">–</span>`;
    return html`<div class="table-wrap" tabindex="0" role="group" aria-label="${T('技能矩陣', 'Skill matrix')}"><table class="table" id="skill-table">
      <thead><tr><th scope="col">${T('成員', 'Member')}</th>${SKILLS.map((s) => html`<th scope="col" class="num">${tx(s.name)}</th>`)}</tr></thead>
      <tbody>${members.map((p) => html`<tr><th scope="row">${tx(p.name)} <span class="muted">${two(KIND_NAME[p.kind])}</span></th>${SKILLS.map((s) => html`<td class="num">${dot(p.skills[s.key] ?? 0)}</td>`)}</tr>`)}
        <tr class="total"><th scope="row">${T('Bus factor（內部能獨立處理的人數）', 'Bus factor (internal people who can work independently)')}</th>${bus.map(
          (b) => html`<td class="num">${mark(b.internal.length <= 1 ? 'crit' : b.internal.length === 2 ? 'warn' : 'ok', String(b.internal.length))}</td>`,
        )}</tr>
      </tbody></table></div>
      <p class="panel-body hint">${T('0 不會、1 看得懂、2 能獨立處理、3 能教人。委外成員不算進 bus factor，因為廠商的人會換。', '0 none, 1 can read, 2 independent, 3 can teach. Vendor staff do not count towards the bus factor because vendors rotate people.')}
      ${
        bus.filter((b) => b.internal.length <= 1).length
          ? T('只剩一個人的：{s}。', 'Down to one person: {s}.', {
              s: bus
                .filter((b) => b.internal.length <= 1)
                .map((b) => `${tx(b.name)}（${b.internal.map((p) => tx(p.name)).join('')}）`)
                .join(T('、', ', ')),
            })
          : ''
      }</p>`;
  }

  function notesTab(state: AppState): Safe {
    if (!can('oneonone.manage'))
      return html`<p class="panel-body hint">${T('1:1 紀錄只有 Tech Lead 看得到。', '1:1 notes are visible to the Tech Lead only.')}</p>`;
    const reports = state.people.filter((p) => p.kind === 'internal' && p.id !== 'tl');
    const rows = reports.flatMap((p) => p.oneOnOnes.map((n) => ({ ...n, person: p }))).sort((a, b) => (a.date < b.date ? 1 : -1));
    return html`${table({
      id: 'notes-table',
      caption: T('1:1 紀錄', '1:1 notes'),
      empty: T('還沒有 1:1 紀錄。', 'No 1:1 notes yet.'),
      rows,
      cols: [
        { head: T('日期', 'Date'), cell: (n) => html`<span class="num">${n.date}</span>`, cls: 'nowrap' },
        { head: T('跟誰', 'With'), cell: (n) => tx(n.person.name), cls: 'nowrap' },
        { head: T('談了什麼', 'What was discussed'), cell: (n) => html`<b>${tx(n.topic)}</b><br />${tx(n.notes)}`, cls: 'wide' },
        { head: T('說好要做的事', 'Agreed actions'), cell: (n) => tx(n.actions), cls: 'wide' },
      ],
    })}
    <form class="panel-body stack" id="note-form"><h3>${T('新增一筆', 'Add a note')}</h3>
      <div class="form-row"><label for="note-who">${T('跟誰', 'With')}</label><select id="note-who">${reports.map((p) => html`<option value="${p.id}">${tx(p.name)}</option>`)}</select></div>
      <div class="form-row"><label for="note-topic">${T('主題', 'Topic')}</label><input id="note-topic" type="text" maxlength="60" /></div>
      <div class="form-row"><label for="note-text">${T('談了什麼', 'What was discussed')}</label><textarea id="note-text" rows="3"></textarea></div>
      <div class="form-row"><label for="note-actions">${T('說好要做的事', 'Agreed actions')}</label><textarea id="note-actions" rows="2"></textarea></div>
      <div class="actions"><button type="submit" class="btn btn-primary">${T('存下這筆紀錄', 'Save this note')}</button><span class="muted">${T('只存在這個瀏覽器。', 'Stored in this browser only.')}</span></div>
    </form>`;
  }

  function docsTab(state: AppState, picked: Doc | undefined): Safe {
    return html`${table<Doc>({
      id: 'doc-table',
      caption: T('文件庫', 'Document library'),
      empty: T('文件庫是空的。', 'The library is empty.'),
      rows: state.docs,
      rowAttrs: (d) => html` class="${d.id === picked?.id ? 'is-selected' : ''}"`,
      cols: [
        {
          head: T('狀態', 'Status'),
          cell: (d) =>
            isStale(d)
              ? mark('crit', T('過期', 'Overdue'))
              : docDue(d) <= addDays(TODAY, 30)
                ? mark('warn', T('快到期', 'Due soon'))
                : mark('ok', T('有效', 'Current')),
          cls: 'nowrap',
        },
        {
          head: T('編號', 'ID'),
          cell: (d) => html`<a class="num" href="${href('/team', { tab: 'docs', doc: d.id })}" data-fk="doc:${d.id}">${d.id}</a>`,
          cls: 'nowrap',
        },
        { head: T('文件', 'Document'), cell: (d) => tx(d.title), cls: 'wide' },
        { head: T('類型', 'Type'), cell: (d) => tag(two(DOC_KIND[d.kind])), cls: 'nowrap' },
        { head: T('負責人', 'Owner'), cell: (d) => personName(state, d.ownerId), cls: 'nowrap' },
        { head: T('上次檢視', 'Last reviewed'), cell: (d) => html`<span class="num">${d.reviewed}</span>`, cls: 'nowrap' },
        { head: T('下次該檢視', 'Next review due'), cell: (d) => html`<span class="num">${docDue(d)}</span>`, cls: 'nowrap' },
        {
          head: T('檢視', 'Review'),
          cell: (d) =>
            actionBtn({
              act: 'review-doc',
              label: T('今天檢視過了', 'Reviewed today'),
              perm: 'doc.review',
              small: true,
              data: { doc: d.id },
              disabledWhy: d.reviewed === TODAY ? T('今天已經檢視過', 'Already reviewed today') : undefined,
            }),
          cls: 'nowrap',
        },
      ],
    })}${
      picked
        ? html`<div class="panel-body stack" id="doc-detail"><h3><span class="num">${picked.id}</span> ${tx(picked.title)}</h3><ul class="outline">${picked.outline.map((line) => html`<li>${tx(line)}</li>`)}</ul>
            <p class="hint">${T('這裡只列大綱。Demo 沒有放完整的文件內容。', 'Only the outline is shown; the demo does not include the full document.')}</p></div>`
        : ''
    }`;
  }

  function adrTab(state: AppState, picked: Adr | undefined): Safe {
    const STATUS: Record<Adr['status'], Safe> = {
      accepted: mark('ok', T('已採用', 'Accepted')),
      proposed: mark('warn', T('提案中', 'Proposed')),
      superseded: html`<span class="muted">${T('已被取代', 'Superseded')}</span>`,
    };
    return html`${table<Adr>({
      id: 'adr-table',
      caption: T('架構決策紀錄', 'Architecture decision records'),
      empty: T('還沒有 ADR。', 'No ADRs yet.'),
      rows: state.adrs,
      rowAttrs: (a) => html` class="${a.id === picked?.id ? 'is-selected' : ''}"`,
      cols: [
        { head: T('狀態', 'Status'), cell: (a) => STATUS[a.status], cls: 'nowrap' },
        {
          head: T('編號', 'ID'),
          cell: (a) => html`<a class="num" href="${href('/team', { tab: 'adr', adr: a.id })}" data-fk="adr:${a.id}">${a.id}</a>`,
          cls: 'nowrap',
        },
        { head: T('決定', 'Decision'), cell: (a) => tx(a.title), cls: 'wide' },
        { head: T('日期', 'Date'), cell: (a) => html`<span class="num">${a.date}</span>`, cls: 'nowrap' },
        { head: T('提案人', 'Author'), cell: (a) => personName(state, a.authorId), cls: 'nowrap' },
        { head: T('上次檢視', 'Last reviewed'), cell: (a) => html`<span class="num">${a.reviewed}</span>`, cls: 'nowrap' },
        {
          head: T('起因', 'Triggered by'),
          cell: (a) =>
            a.incidentId
              ? canOpen('/incidents')
                ? html`<a class="num" href="${href('/incidents', { inc: a.incidentId })}">${a.incidentId}</a>`
                : a.incidentId
              : '–',
          cls: 'nowrap',
        },
      ],
    })}${
      picked
        ? html`<div class="panel-body stack" id="adr-detail"><h3><span class="num">${picked.id}</span> ${tx(picked.title)}</h3>${facts([
            [T('背景', 'Context'), tx(picked.context)],
            [T('決定', 'Decision'), tx(picked.decision)],
            [T('代價', 'Consequences'), tx(picked.consequences)],
          ])}</div>`
        : ''
    }`;
  }

  function onboardingTab(state: AppState): Safe {
    const doc = (id: string) => state.docs.find((d) => d.id === id);
    const steps: [string, string, string[], string | null][] = [
      [
        T('第 1 天', 'Day 1'),
        T('帳號、權限、開發環境。先讀開發規範與分支規範。', 'Accounts, access, development environment. Read the development and branching standards first.'),
        ['DOC-14', 'DOC-01', 'DOC-02'],
        null,
      ],
      [
        T('第 2 天', 'Day 2'),
        T(
          '看整合架構圖，點過每一條介面，知道誰負責、失敗了會怎樣。',
          'Go through the integration map, open every interface, learn who owns it and what happens when it fails.',
        ),
        ['DOC-05', 'DOC-04'],
        '/integration',
      ],
      [T('第 3 天', 'Day 3'), T('跟一次夜間批次，對照月結 Runbook。', 'Shadow one night batch against the month-end runbook.'), ['DOC-07'], '/overview'],
      [
        T('第 4 天', 'Day 4'),
        T('在測試環境重送一筆 DLQ，照 Runbook 做。', 'Resend one DLQ record in the test environment, following the runbook.'),
        ['DOC-08', 'DOC-06'],
        null,
      ],
      [
        T('第 5 天', 'Day 5'),
        T('改一條對帳規則並送 Code Review；SQL 要附執行計畫。', 'Change one reconciliation rule and send it for review; the SQL needs a query plan.'),
        ['DOC-15'],
        '/consistency',
      ],
      [
        T('第 2 週', 'Week 2'),
        T('跟一次事件檢討會與一次變更核准，知道凍結期怎麼算。', 'Sit in on one incident review and one change approval; learn how freezes are calculated.'),
        ['DOC-13', 'DOC-12'],
        '/incidents',
      ],
    ];
    return html`<ol class="path" id="onboarding">${steps.map(
      ([when, what, docs, page]) =>
        html`<li><b>${when}</b><span>${what}</span><span class="path-docs">${docs.map((id) => {
          const d = doc(id);
          return d
            ? html`<a href="${href('/team', { tab: 'docs', doc: id })}">${id} ${tx(d.title)}</a>${isStale(d) ? html` ${tag(T('過期', 'Overdue'), 'crit')}` : ''}`
            : '';
        })}${page && canOpen(page) ? html`<a class="btn btn-sm" href="${href(page)}">${T('打開那一頁', 'Open that page')}</a>` : ''}</span></li>`,
    )}</ol>`;
  }

  function render(): void {
    const state = store.state;
    const query = route.query.get('tab');
    const tab: Tab = (TABS as readonly string[]).includes(query ?? '') ? (query as Tab) : 'people';
    const stale = state.docs.filter((d) => isStale(d));
    const over = state.people.filter((p) => (loadOf(state, p)?.ratio ?? 0) > 1.1);
    const single = busFactors(state).filter((b) => b.internal.length <= 1);
    const body =
      tab === 'skills'
        ? skillsTab(state)
        : tab === 'notes'
          ? notesTab(state)
          : tab === 'docs'
            ? docsTab(
                state,
                state.docs.find((d) => d.id === route.query.get('doc')),
              )
            : tab === 'adr'
              ? adrTab(
                  state,
                  state.adrs.find((a) => a.id === route.query.get('adr')),
                )
              : tab === 'onboarding'
                ? onboardingTab(state)
                : peopleTab(state);
    setHtml(
      root,
      html`<div class="page">
        ${pageHead(
          T('團隊與規範', 'Team & standards'),
          T(
            '{o} 位負載超過 110%，{s} 項技能只剩一位內部成員能處理，{d} 份文件過期。',
            '{o} over 110% load, {s} {s|skill has|skills have} only one internal person, {d} {d|document is|documents are} overdue for review.',
            {
              o: over.length,
              s: single.length,
              d: stale.length,
            },
          ),
        )}
        <section class="panel">${tabs(
          [
            { id: 'people', label: T('成員與負載', 'Members and load'), count: state.people.length },
            { id: 'skills', label: T('技能矩陣', 'Skill matrix') },
            { id: 'notes', label: T('1:1 紀錄', '1:1 notes') },
            { id: 'docs', label: T('文件庫', 'Documents'), count: state.docs.length },
            { id: 'adr', label: 'ADR', count: state.adrs.length },
            { id: 'onboarding', label: T('新人上手', 'Onboarding') },
          ],
          tab,
        )}${body}</section>
      </div>`,
    );
  }

  const offs = [
    on(root, 'click', '[data-tab]', (_e, el) => setQuery({ tab: el.dataset.tab ?? null, doc: null, adr: null })),
    on(root, 'change', '[data-task]', (_e, el) => {
      const to = (el as HTMLSelectElement).value || null;
      store.update((s) => {
        const task = s.tasks.find((t) => t.id === el.dataset.task);
        if (!task) return;
        task.assigneeId = to;
        audit(
          s,
          L('指派任務', 'Assigned task'),
          task.id,
          L(
            `${task.title.zh} → ${to ? (s.people.find((p) => p.id === to)?.name.zh ?? to) : '未指派'}`,
            `${task.title.en} → ${to ? (s.people.find((p) => p.id === to)?.name.en ?? to) : 'Unassigned'}`,
          ),
        );
      });
      toast(T('已改派，負載已經重算', 'Reassigned; load recalculated'));
    }),
    on(root, 'click', '[data-act="toggle-member"]', (_e, el) => {
      store.update((s) => {
        const p = s.people.find((x) => x.id === el.dataset.person);
        if (!p) return;
        p.active = !p.active;
        audit(s, p.active ? L('啟用成員', 'Activated member') : L('停用成員', 'Deactivated member'), p.id, p.name);
      });
    }),
    on(root, 'click', '[data-act="review-doc"]', (_e, el) => {
      store.update((s) => {
        const d = s.docs.find((x) => x.id === el.dataset.doc);
        if (!d) return;
        d.reviewed = TODAY;
        audit(s, L('檢視文件', 'Reviewed document'), d.id, d.title);
      });
      toast(T('已記下今天檢視過', 'Recorded as reviewed today'));
    }),
    on(root, 'submit', '#note-form', (event) => {
      event.preventDefault();
      const topic = $<HTMLInputElement>('#note-topic', root).value.trim();
      const text = $<HTMLTextAreaElement>('#note-text', root).value.trim();
      const actions = $<HTMLTextAreaElement>('#note-actions', root).value.trim();
      const who = $<HTMLSelectElement>('#note-who', root).value;
      if (!topic || !text) {
        toast(T('主題與內容都要寫', 'Both a topic and the discussion are required'), 'warn');
        (topic ? $('#note-text', root) : $('#note-topic', root)).focus();
        return;
      }
      store.update((s) => {
        const p = s.people.find((x) => x.id === who);
        if (!p) return;
        p.oneOnOnes.unshift({
          id: `${p.id}-${p.oneOnOnes.length + 1}`,
          date: TODAY,
          topic: { zh: topic, en: topic },
          notes: { zh: text, en: text },
          actions: { zh: actions || '–', en: actions || '–' },
        });
        audit(s, L('新增 1:1 紀錄', 'Added 1:1 note'), p.id, L(`與 ${p.name.zh}`, `With ${p.name.en}`));
      });
      toast(T('已存下這筆 1:1 紀錄', '1:1 note saved'));
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
