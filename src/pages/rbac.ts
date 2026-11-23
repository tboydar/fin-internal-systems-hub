import { audit, can } from '../core/auth';
import { fmtStamp } from '../core/date';
import { L, T, tx } from '../core/i18n';
import { DEFAULT_MATRIX, isLocked, PERM_GROUPS, PERM_NAME, PERMS, type Perm, ROLE_DESC, ROLE_NAME, ROLES, sodConflicts } from '../core/rbac';
import { navigate } from '../core/router';
import { store } from '../core/store';
import type { AuditEntry, RoleId } from '../core/types';
import { html, on, raw, type Safe, setHtml, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { landingOf, type PageHandle } from '../ui/shell';
import { actionBtn, mark, pageHead, panel, table } from '../ui/widgets';

// 權限矩陣：角色 × 權限。系統管理員可以直接勾選，全站立即生效；
// 每次修改都會重新檢查職責分離，並寫一筆稽核軌跡。

export function mount(root: HTMLElement): PageHandle {
  function cell(role: RoleId, perm: Perm, edit: boolean): Safe {
    const has = store.state.rbac[role].includes(perm);
    const label = `${tx(ROLE_NAME[role])}: ${tx(PERM_NAME[perm])}`;
    if (isLocked(role, perm)) {
      const why = T('固定開啟，避免把自己鎖在外面', 'Always on, so nobody gets locked out');
      return html`<span class="yes" title="${why}">${icon('lock', 15)}<span class="sr-only">${why}</span></span>`;
    }
    if (edit)
      return html`<input type="checkbox" id="cb-${role}-${perm}" data-role="${role}" data-perm="${perm}" ${has ? raw('checked') : ''} aria-label="${label}" />`;
    return has
      ? html`<span class="yes">${icon('check', 16)}<span class="sr-only">${T('有', 'Granted')}</span></span>`
      : html`<span class="no">–<span class="sr-only">${T('沒有', 'Not granted')}</span></span>`;
  }

  function render(): void {
    const s = store.state;
    const edit = can('rbac.edit');
    const current = store.prefs.role;
    const conflicts = sodConflicts(s.rbac);
    const summary = T('{r} 個角色、{p} 項權限、{c} 個職責分離衝突。', '{r} roles, {p} permissions, {c} segregation-of-duties {c|conflict|conflicts}.', {
      r: ROLES.length,
      p: PERMS.length,
      c: conflicts.length,
    });

    const matrix = html`<div class="table-wrap" tabindex="0" role="group" aria-label="${T('權限矩陣', 'Permission matrix')}"><table class="table rbac">
      <thead><tr><th scope="col">${T('權限', 'Permission')}</th>${ROLES.map(
        (r) => html`<th scope="col" class="${r === current ? 'is-current' : ''}"><b>${tx(ROLE_NAME[r])}</b><span class="th-note">${tx(ROLE_DESC[r])}</span>
          ${
            r === current
              ? html`<span class="tag is-primary">${T('目前登入', 'Signed in')}</span>`
              : html`<button type="button" class="btn btn-sm" data-signin="${r}" data-fk="signin:${r}" aria-label="${T('用「{role}」登入', 'Sign in as {role}', { role: tx(ROLE_NAME[r]) })}">${T('用它登入', 'Sign in')}</button>`
          }</th>`,
      )}</tr></thead>
      <tbody>${PERM_GROUPS.map(
        (g) => html`<tr class="group"><th scope="rowgroup" colspan="${ROLES.length + 1}">${tx(g.name)}</th></tr>
          ${g.perms.map((p) => html`<tr><th scope="row">${tx(PERM_NAME[p])}</th>${ROLES.map((r) => html`<td class="${r === current ? 'is-current' : ''}">${cell(r, p, edit)}</td>`)}</tr>`)}`,
      )}</tbody>
    </table></div>`;

    const sod = table({
      caption: T('職責分離衝突', 'Segregation-of-duties conflicts'),
      empty: T('沒有衝突：沒有任何角色同時握有不該放在一起的權限。', 'No conflicts: no role holds permissions that must be kept apart.'),
      rows: conflicts,
      cols: [
        { head: T('狀態', 'Status'), cell: () => mark('crit', T('衝突', 'Conflict')), cls: 'nowrap' },
        { head: T('角色', 'Role'), cell: (c) => tx(ROLE_NAME[c.role]), cls: 'nowrap' },
        { head: T('規則', 'Rule'), cell: (c) => html`<span class="num">${c.ruleId}</span> ${tx(c.why)}` },
        { head: T('同時握有的權限', 'Permissions held together'), cell: (c) => c.perms.map((p) => tx(PERM_NAME[p])).join(T('、', ', ')), cls: 'wide' },
      ],
    });

    const trail = can('audit.view')
      ? table<AuditEntry>({
          caption: T('稽核軌跡', 'Audit trail'),
          empty: T(
            '還沒有紀錄。修改權限、核准變更、重送資料之後，這裡會多一筆。',
            'No entries yet. Editing permissions, approving changes or resending data adds one here.',
          ),
          rows: s.audit.slice(0, 40),
          cols: [
            { head: T('時間', 'Time'), cell: (a) => html`<span class="num">${fmtStamp(a.at)}</span>`, cls: 'nowrap' },
            {
              head: T('誰', 'Who'),
              cell: (a) => `${tx(a.actor)}${a.role === 'system' ? '' : T('（{r}）', ' ({r})', { r: tx(ROLE_NAME[a.role]) })}`,
              cls: 'nowrap',
            },
            { head: T('做了什麼', 'Action'), cell: (a) => tx(a.action), cls: 'nowrap' },
            { head: T('對象', 'Target'), cell: (a) => html`<span class="num">${a.target}</span>`, cls: 'nowrap' },
            { head: T('內容', 'Detail'), cell: (a) => tx(a.detail), cls: 'wide' },
          ],
        })
      : html`<p class="hint">${icon('lock', 14)}${T('「{role}」沒有看稽核軌跡的權限。', '“{role}” has no permission to view the audit trail.', { role: tx(ROLE_NAME[current]) })}</p>`;

    setHtml(
      root,
      html`<div class="page">
        ${pageHead(T('權限矩陣', 'Permissions'), summary, actionBtn({ act: 'reset-matrix', label: T('還原成預設矩陣', 'Restore the default matrix'), perm: 'rbac.edit', icon: 'reset' }))}
        <p class="hint">${
          edit
            ? T(
                '勾選後立刻生效，設定存在這個瀏覽器。每次修改會寫一筆稽核軌跡。',
                'Changes take effect immediately and are stored in this browser. Each change writes an audit entry.',
              )
            : html`${icon('lock', 14)}${T('「{role}」只能檢視。要修改請用「系統管理員」登入。', '“{role}” can only view. Sign in as System administrator to edit.', { role: tx(ROLE_NAME[current]) })}`
        }</p>
        ${panel(T('職責分離檢查', 'Segregation-of-duties check'), sod, { note: T('{n} 個衝突', '{n} {n|conflict|conflicts}', { n: conflicts.length }), id: 'sod' })}
        ${panel(T('角色與權限', 'Roles and permissions'), matrix)}
        ${panel(T('稽核軌跡', 'Audit trail'), trail, { note: can('audit.view') ? T('最近 {n} 筆', 'Latest {n}', { n: Math.min(40, s.audit.length) }) : '', id: 'audit' })}
      </div>`,
    );
  }

  const offs = [
    on(root, 'change', '[data-perm]', (_e, el) => {
      const role = el.dataset.role as RoleId;
      const perm = el.dataset.perm as Perm;
      const grant = (el as HTMLInputElement).checked;
      const before = sodConflicts(store.state.rbac).length;
      store.update((s) => {
        s.rbac[role] = grant ? [...new Set([...s.rbac[role], perm])] : s.rbac[role].filter((p) => p !== perm);
        audit(
          s,
          grant ? L('授予權限', 'Granted permission') : L('收回權限', 'Revoked permission'),
          role,
          L(`${ROLE_NAME[role].zh}：${PERM_NAME[perm].zh}`, `${ROLE_NAME[role].en}: ${PERM_NAME[perm].en}`),
        );
      });
      const after = sodConflicts(store.state.rbac).length;
      if (after > before) {
        toast(
          T('已授予，但造成職責分離衝突。請看上方的檢查結果。', 'Granted, but this creates a segregation-of-duties conflict. See the check above.'),
          'warn',
        );
      } else {
        toast(
          grant
            ? T('已授予「{role}」：{perm}', 'Granted to “{role}”: {perm}', { role: tx(ROLE_NAME[role]), perm: tx(PERM_NAME[perm]) })
            : T('已收回「{role}」：{perm}', 'Revoked from “{role}”: {perm}', { role: tx(ROLE_NAME[role]), perm: tx(PERM_NAME[perm]) }),
        );
      }
    }),
    on(root, 'click', '[data-signin]', (_e, el) => {
      const role = el.dataset.signin as RoleId;
      store.setPrefs({ role });
      navigate(landingOf(role));
    }),
    on(root, 'click', '[data-act="reset-matrix"]', () => {
      store.update((s) => {
        s.rbac = structuredClone(DEFAULT_MATRIX);
        audit(s, L('還原權限矩陣', 'Restored permission matrix'), 'rbac', L('全部角色回到預設權限', 'All roles back to default permissions'));
      });
      toast(T('已還原成預設矩陣', 'Default matrix restored'));
    }),
    store.subscribe((kind) => {
      if (kind === 'state') render();
    }),
  ];
  render();
  return {
    destroy() {
      for (const off of offs) off();
    },
  };
}
