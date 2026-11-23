import { raw, type Safe } from './dom';

// 一套線性圖示：24×24、1.5px 線寬、圓角端點，全部用 currentColor。不使用 emoji。

const PATHS: Record<string, string> = {
  overview:
    '<rect x="3.5" y="3.5" width="7" height="8"/><rect x="13.5" y="3.5" width="7" height="5"/><rect x="13.5" y="11.5" width="7" height="9"/><rect x="3.5" y="14.5" width="7" height="6"/>',
  integration:
    '<circle cx="5.5" cy="6" r="2.2"/><circle cx="18.5" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.7 6h8.6M6.6 8l4.2 8M17.4 8l-4.2 8"/>',
  consistency: '<path d="M4 7h10M4 12h7M4 17h10"/><path d="M16 10.5l2 2 3.5-4"/><path d="M16.5 16.5l4 0"/>',
  vendors:
    '<path d="M3.5 20.5v-11l6-3v14M9.5 20.5v-8l5-2.5 6 2.5v8M2.5 20.5h19"/><path d="M6 11.5v0M6 14.5v0M6 17.5v0M13 14.5v0M13 17.5v0M17 14.5v0M17 17.5v0"/>',
  team: '<circle cx="8.5" cy="8" r="3"/><path d="M2.5 19.5c.6-3.4 3-5 6-5s5.4 1.6 6 5"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14.6c3 0 4.9 1.5 5.5 4.4"/>',
  roadmap: '<path d="M3.5 6.5h8v3.5h-8zM8.5 13.5h9v3.5h-9zM13.5 6.5h7"/><path d="M3.5 3v18"/>',
  demands: '<path d="M5 3.5h10l4 4v13H5z"/><path d="M15 3.5v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/>',
  incidents: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  rbac: '<rect x="4.5" y="10.5" width="15" height="10" rx="1"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4v4h4"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5z"/>',
  next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.500v-9z"/><path d="M4 7.500l8 4.500 8-4.500M12 12v9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name: string, size = 18): Safe {
  return raw(
    `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`,
  );
}

/** 狀態的形狀：正常是圓、注意是三角、中斷是方塊。顏色之外多一個線索，色盲也分得出來。 */
const SHAPES = {
  ok: '<circle cx="6" cy="6" r="4.2"/>',
  warn: '<path d="M6 1.300l5.200 9.400H.8z"/>',
  crit: '<rect x="1.600" y="1.600" width="8.800" height="8.800"/>',
} as const;

export function shape(health: keyof typeof SHAPES, size = 11): Safe {
  return raw(`<svg class="mark-shape" width="${size}" height="${size}" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">${SHAPES[health]}</svg>`);
}
