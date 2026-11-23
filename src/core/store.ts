import { buildInitialState, STATE_VERSION } from '../mock';
import { setLang } from './i18n';
import type { AppState, Prefs } from './types';

// 單一資料來源。所有變更都走 store.update()：改資料 → 存 localStorage → 通知畫面。
// 2D 的頁面與 3D 的場景都只讀這裡，所以不會各算各的。
// 重新整理後資料還在；按「還原 Demo 資料」則用同一個 seed 重建。

export const STORAGE_PREFIX = 'fish:';
const STATE_KEY = `${STORAGE_PREFIX}state:v1`;
const PREFS_KEY = `${STORAGE_PREFIX}prefs:v1`;

export type ChangeKind = 'state' | 'prefs' | 'reset';
type Listener = (kind: ChangeKind) => void;

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 無痕模式或容量已滿時 localStorage 會丟例外：這時資料只留在記憶體，Demo 仍可操作。
  }
}

function defaultPrefs(): Prefs {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { role: 'techlead', lang: 'zh', lowFx: reduce, vendorId: 'v-crm' };
}

function loadState(): AppState {
  const stored = load<AppState>(STATE_KEY);
  if (stored && stored.version === STATE_VERSION) return stored;
  const fresh = buildInitialState();
  save(STATE_KEY, fresh);
  return fresh;
}

let state = loadState();
let prefs: Prefs = { ...defaultPrefs(), ...(load<Partial<Prefs>>(PREFS_KEY) ?? {}) };
setLang(prefs.lang);

const listeners = new Set<Listener>();
const emit = (kind: ChangeKind) => {
  for (const fn of [...listeners]) fn(kind);
};

export const store = {
  get state(): AppState {
    return state;
  },
  get prefs(): Prefs {
    return prefs;
  },
  /** 修改資料的唯一入口。 */
  update(mutate: (draft: AppState) => void): void {
    mutate(state);
    save(STATE_KEY, state);
    emit('state');
  },
  setPrefs(patch: Partial<Prefs>): void {
    prefs = { ...prefs, ...patch };
    setLang(prefs.lang);
    save(PREFS_KEY, prefs);
    emit('prefs');
  },
  /** 回到初始資料（登入身分、語言與特效偏好保留）。 */
  reset(): void {
    try {
      // 流程圖被拖曳過的版面也一併還原
      for (const key of Object.keys(localStorage)) if (key.startsWith(`${STORAGE_PREFIX}flow:`)) localStorage.removeItem(key);
    } catch {
      // localStorage 不可用時沒有東西要清
    }
    state = buildInitialState();
    save(STATE_KEY, state);
    emit('reset');
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** 產生下一個流水號，例如 nextId('adr', 'ADR-', 8) → ADR-009。 */
  nextId(kind: string, prefix: string, start: number, pad = 3): string {
    const n = (state.counters[kind] ?? start) + 1;
    state.counters[kind] = n;
    return `${prefix}${String(n).padStart(pad, '0')}`;
  },
};
