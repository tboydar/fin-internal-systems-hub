// 很小的畫面工具：安全的 HTML 樣板、事件委派、對話框與提示。
// 沒有用前端框架：每頁就是「資料 → HTML 字串」，資料變了就重畫該區塊。

/** 已經確認安全、可以直接放進 innerHTML 的 HTML。 */
export class Safe {
  constructor(readonly s: string) {}
  toString(): string {
    return this.s;
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(text: unknown): string {
  return String(text).replace(/[&<>"']/g, (c) => ESC[c]);
}

function render(value: unknown): string {
  if (value == null || value === false || value === true) return '';
  if (value instanceof Safe) return value.s;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

/**
 * 樣板標籤：${} 內的值一律先跳脫，只有 Safe（另一段 html``）才原樣插入。
 * 使用者輸入的文字（1:1 紀錄、需求描述…）因此不會變成 XSS。
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = '';
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) out += render(values[i]);
  });
  return new Safe(out);
}

export const raw = (s: string): Safe => new Safe(s);

/**
 * 把一段 HTML 放進元素。重畫之前如果鍵盤焦點在裡面，重畫之後放回同一個控制項，
 * 這樣用鍵盤操作時，按了按鈕不會被丟回頁面最上面。
 */
export function setHtml(el: Element, content: Safe): void {
  const active = document.activeElement;
  let back: string | null = null;
  if (active instanceof HTMLElement && el.contains(active)) {
    if (active.id) back = `#${CSS.escape(active.id)}`;
    else if (active.dataset.fk) back = `[data-fk="${CSS.escape(active.dataset.fk)}"]`;
  }
  el.innerHTML = content.s;
  if (back) el.querySelector<HTMLElement>(back)?.focus({ preventScroll: true });
}

/** 找一個一定存在的元素；找不到代表樣板寫錯了，直接丟錯。 */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`找不到元素：${sel}`);
  return el;
}

export function $maybe<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

/** 事件委派：在 root 上聽一次，就能處理之後重畫出來的元素。回傳取消函式。 */
export function on<K extends keyof HTMLElementEventMap>(
  root: HTMLElement,
  type: K,
  selector: string,
  handler: (event: HTMLElementEventMap[K], target: HTMLElement) => void,
): () => void {
  const listener = (event: HTMLElementEventMap[K]) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener as EventListener);
  return () => root.removeEventListener(type, listener as EventListener);
}

let toastTimer = 0;
export function toast(message: string, tone: 'ok' | 'warn' = 'ok'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const box = el;
  box.textContent = message;
  box.className = `toast is-show is-${tone}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.remove('is-show'), 3200);
}

/** 開啟對話框（原生 <dialog>，自帶焦點管理與 Esc 關閉）。回傳關閉函式。 */
export function openModal(content: Safe, onReady?: (dialog: HTMLDialogElement, close: () => void) => void): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = content.s;
  document.body.appendChild(dialog);
  const close = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || (e.target as Element).closest('[data-close]')) close();
  });
  dialog.showModal();
  onReady?.(dialog, close);
  return close;
}

/** 整數加千分位。 */
export function num(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 新台幣金額：NT$ 1,284,500。負數寫成 −NT$ 500。 */
export function nt(value: number): string {
  return `${value < 0 ? '−' : ''}NT$ ${num(Math.abs(Math.round(value)))}`;
}

/** 百分比，一位小數：96.4%。 */
export function pct(ratio: number): string {
  return `${num(ratio * 100, 1)}%`;
}
