import { can } from '../core/auth';
import { T, tx } from '../core/i18n';
import { PERM_NAME, type Perm, ROLE_NAME } from '../core/rbac';
import { href } from '../core/router';
import { store } from '../core/store';
import type { AppState, Health, SystemId, VendorId } from '../core/types';
import { html, raw, type Safe } from './dom';
import { icon, shape } from './icons';

// 各頁共用的小元件。

export function healthLabel(health: Health): string {
  return health === 'ok' ? T('正常', 'OK') : health === 'warn' ? T('注意', 'Attention') : T('中斷', 'Down');
}

/** 狀態標記：形狀＋顏色＋文字，三個一起出現。 */
export function mark(health: Health, label?: string): Safe {
  return html`<span class="mark is-${health}">${shape(health)}<span>${label ?? healthLabel(health)}</span></span>`;
}

/** 一般的小標籤（沒有狀態含意時用）。 */
export function tag(label: string, tone: 'plain' | 'primary' | Health = 'plain'): Safe {
  return html`<span class="tag ${tone === 'plain' ? '' : `is-${tone}`}">${label}</span>`;
}

export interface ActionButton {
  act: string;
  label: string;
  /** 需要的權限。沒有時按鈕會顯示成上鎖，並說明缺哪個權限。 */
  perm?: Perm;
  /** 權限要看資料才能決定時，直接給判斷結果，會覆蓋 perm 的查詢。 */
  allowed?: boolean;
  /** 與權限無關的停用（例如已經在最後一個階段）。給一句原因，會顯示在提示裡。 */
  disabledWhy?: string;
  primary?: boolean;
  small?: boolean;
  icon?: string;
  data?: Record<string, string>;
}

/**
 * 依權限顯示的按鈕。沒有權限時不隱藏，而是顯示成上鎖並說明缺哪個權限，
 * 這樣切換角色時可以清楚看到「誰能做什麼」。上鎖按鈕的點擊由 shell 統一攔下。
 */
export function actionBtn(o: ActionButton): Safe {
  const allowed = o.allowed ?? (o.perm ? can(o.perm) : true);
  const why = allowed
    ? ''
    : T('「{role}」沒有這個權限：{perm}', '“{role}” lacks this permission: {perm}', {
        role: tx(ROLE_NAME[store.prefs.role]),
        perm: o.perm ? tx(PERM_NAME[o.perm]) : o.label,
      });
  const data = Object.entries(o.data ?? {}).map(([k, v]) => html` data-${k}="${v}"`);
  const fk = `${o.act}:${Object.values(o.data ?? {}).join(':')}`;
  const state = !allowed ? html` aria-disabled="true" data-why="${why}"` : o.disabledWhy ? html` aria-disabled="true" data-why="${o.disabledWhy}"` : '';
  const cls = `btn${o.primary ? ' btn-primary' : ''}${o.small ? ' btn-sm' : ''}`;
  return html`<button type="button" class="${cls}" data-act="${o.act}" data-fk="${fk}"${data}${state} title="${why || o.disabledWhy || ''}">${!allowed ? icon('lock', 14) : o.icon ? icon(o.icon, 15) : ''}${o.label}</button>`;
}

/** 頁首：標題，加上一行由資料算出的現況（不是固定的介紹文字）。 */
export function pageHead(title: string, summary?: Safe | string, actions?: Safe): Safe {
  return html`<header class="page-head"><div><h1>${title}</h1>${summary ? html`<p class="page-sum" id="page-sum">${summary}</p>` : ''}</div>${actions ? html`<div class="actions">${actions}</div>` : ''}</header>`;
}

export function tabs(items: { id: string; label: string; count?: number }[], active: string): Safe {
  return html`<div class="tabs" role="tablist">${items.map(
    (i) =>
      html`<button type="button" role="tab" class="tab" data-tab="${i.id}" data-fk="tab:${i.id}" aria-selected="${String(i.id === active)}">${i.label}${i.count === undefined ? '' : html`<span class="num tab-n">${i.count}</span>`}</button>`,
  )}</div>`;
}

export interface Column<R> {
  head: string;
  cell: (row: R) => Safe | string | number;
  /** num：靠右、等寬數字。 */
  cls?: 'num' | 'nowrap' | 'wide';
}

export interface TableOptions<R> {
  cols: Column<R>[];
  rows: R[];
  /** 沒有資料時顯示的文字。要寫出「為什麼是空的」，不要只寫「沒有資料」。 */
  empty: string;
  caption?: string;
  /** 給每一列加屬性，例如可點選的列。 */
  rowAttrs?: (row: R) => Safe | string;
  id?: string;
}

/** 資料表。全站的表格都走這裡，樣式、空狀態與橫向捲動才會一致。 */
export function table<R>(o: TableOptions<R>): Safe {
  const head = o.cols.map((c) => html`<th scope="col" class="${c.cls === 'num' ? 'num' : ''}">${c.head}</th>`);
  const body = o.rows.length
    ? o.rows.map((row) => html`<tr${o.rowAttrs ? o.rowAttrs(row) : ''}>${o.cols.map((c) => html`<td class="${c.cls ?? ''}">${c.cell(row)}</td>`)}</tr>`)
    : html`<tr class="empty"><td colspan="${o.cols.length}">${o.empty}</td></tr>`;
  return html`<div class="table-wrap" tabindex="0" role="group" aria-label="${o.caption ?? ''}"><table class="table"${o.id ? html` id="${o.id}"` : ''}>${o.caption ? html`<caption class="sr-only">${o.caption}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** 區塊：標題列＋內容。1px 邊線，沒有陰影。 */
export function panel(title: string, body: Safe, opts: { note?: Safe | string; actions?: Safe; id?: string } = {}): Safe {
  return html`<section class="panel"${opts.id ? html` id="${opts.id}"` : ''}><div class="panel-head"><h2>${title}</h2>${opts.note ? html`<span class="panel-note">${opts.note}</span>` : ''}${opts.actions ? html`<div class="actions">${opts.actions}</div>` : ''}</div>${body}</section>`;
}

/** 定義清單：左邊名稱、右邊值。 */
export function facts(rows: [label: string, value: Safe | string | number][]): Safe {
  return html`<dl class="facts">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function personName(state: AppState, id: string | null | undefined): string {
  if (!id) return T('未指派', 'Unassigned');
  const p = state.people.find((x) => x.id === id);
  return p ? tx(p.name) : id;
}

export function systemName(state: AppState, id: SystemId): string {
  const s = state.systems.find((x) => x.id === id);
  return s ? tx(s.name) : id;
}

export function vendorName(state: AppState, id: VendorId | null): string {
  if (!id) return T('內部維護', 'In-house');
  const v = state.vendors.find((x) => x.id === id);
  return v ? tx(v.name) : id;
}

/** 站內連結。 */
export function link(label: string | Safe, path: string, query?: Record<string, string>): Safe {
  return html`<a href="${href(path, query)}">${label}</a>`;
}

/** 行內小長條：一排直條，每條一次執行，高度一樣，用形狀與顏色區分結果。 */
export function runStrip(statuses: Health[], label: string): Safe {
  const w = 5;
  const gap = 2;
  const bars = statuses
    .map((h, i) => {
      const x = i * (w + gap);
      // 正常：實心短條；注意：上半截；中斷：整條加粗框
      const y = h === 'ok' ? 6 : h === 'warn' ? 3 : 0;
      return `<rect class="is-${h}" x="${x}" y="${y}" width="${w}" height="${14 - y}"/>`;
    })
    .join('');
  return raw(`<svg class="strip" width="${statuses.length * (w + gap)}" height="14" role="img" aria-label="${label.replace(/"/g, '&quot;')}">${bars}</svg>`);
}
