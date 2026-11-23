// Hash 路由：#/integration?iface=INT-014。
// GitHub Pages 是純靜態主機，沒有伺服器端改寫；用 hash 可以保證重新整理不會 404。

export const HOME = '/overview';

export interface Route {
  path: string;
  query: URLSearchParams;
}

export function currentRoute(): Route {
  const raw = location.hash.replace(/^#/, '') || HOME;
  const [path, qs = ''] = raw.split('?');
  return { path: path || HOME, query: new URLSearchParams(qs) };
}

export function href(path: string, query?: Record<string, string>): string {
  const qs = query ? new URLSearchParams(query).toString() : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: string, query?: Record<string, string>): void {
  const next = href(path, query);
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

/** 只改查詢參數、留在同一頁。值給 null 就拿掉那個參數。 */
export function setQuery(patch: Record<string, string | null>): void {
  const route = currentRoute();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) route.query.delete(key);
    else route.query.set(key, value);
  }
  const qs = route.query.toString();
  location.hash = `#${route.path}${qs ? `?${qs}` : ''}`;
}

export function onRouteChange(fn: () => void): void {
  window.addEventListener('hashchange', fn);
}
