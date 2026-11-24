import { addDays, at, dayOf, daysBetween, isWorkday, MONTH_END, two } from './date';
import { L } from './i18n';
import { worse } from './selectors';
import type { TwinModel } from './twin';
import type { AppState, DcId, Health, L10n, RegionId, SystemId } from './types';

// 多個據點、多個機房、多個時區。
// 3D 的「全台」與「海外」兩個比例尺要畫的東西，全部在這裡從狀態算出來；旁邊的清單與圖也讀同一份。
// 這個檔案不碰 three。
//
// 時差一律用時區名稱（IANA，例如 America/New_York）交給瀏覽器的時區資料庫去算，不寫死「差幾小時」：
// 紐約夏天與冬天跟台北的時差不一樣，寫死的數字每年會錯兩次。

/** 各地的上班時段：當地時間，週一到週五。各地的假日沒有算進來。 */
export const OPEN_HOURS = { from: 9, to: 18 };
/** 資訊處的一般支援時段：台北時間，工作日。其他時間只有值班。 */
export const SUPPORT_HOURS = { from: 8, to: 20 };
const TAIPEI = 'Asia/Taipei';
const TAIPEI_OFFSET = 480;

export const REGIONS: { id: RegionId; name: L10n }[] = [
  { id: 'north', name: L('北區', 'North') },
  { id: 'central', name: L('中區', 'Central') },
  { id: 'south', name: L('南區', 'South') },
  { id: 'overseas', name: L('海外', 'Overseas') },
];

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** 某個時刻，這個時區比 UTC 快幾分鐘（台北是 480）。 */
export function tzOffsetMin(tz: string, iso: string): number {
  const t = Math.floor(new Date(iso).getTime() / 1000) * 1000;
  const part: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(t))) if (p.type !== 'literal') part[p.type] = Number(p.value);
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return Math.round((wall - t) / 60_000);
}

export interface LocalClock {
  /** 當地是哪一天（YYYY-MM-DD）。 */
  day: string;
  /** 0 是星期日。 */
  weekday: number;
  hour: number;
  minute: number;
  offsetMin: number;
  /** 跟台北差幾天：-1 是台北的前一天。 */
  dayDelta: number;
}

/** 某個時刻，這個時區的時鐘上是幾點。 */
export function localClock(tz: string, iso: string): LocalClock {
  const offsetMin = tzOffsetMin(tz, iso);
  const local = new Date(new Date(iso).getTime() + offsetMin * 60_000);
  const day = local.toISOString().slice(0, 10);
  return { day, weekday: local.getUTCDay(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), offsetMin, dayDelta: daysBetween(dayOf(iso), day) };
}

/** 當地現在是不是上班時間。 */
export function isOpen(clock: LocalClock): boolean {
  return clock.weekday >= 1 && clock.weekday <= 5 && clock.hour >= OPEN_HOURS.from && clock.hour < OPEN_HOURS.to;
}

/** 模型看的是哪個時刻：重播時是月結日的那個整點，平常是 Demo 的現在。 */
export function instantOf(state: AppState, model: Pick<TwinModel, 'hour' | 'replay'>): string {
  return model.replay ? at(MONTH_END, `${two(model.hour)}:00`) : state.clock;
}

/** 據點每天在用的系統：跟營業廳（1F 業務）用的是同一批。 */
export function siteSystems(state: AppState): SystemId[] {
  return state.systems.filter((s) => s.usedBy.includes('sales')).map((s) => s.id);
}

export type SiteKind = 'branch' | 'overseas';

export interface SiteView {
  id: string;
  kind: SiteKind;
  name: L10n;
  city: L10n | null;
  regionId: RegionId;
  lon: number;
  lat: number;
  tz: string;
  clock: LocalClock;
  open: boolean;
  /** 這個小時正在跑、而且動到這個據點在用的系統的批次。據點沒上班就不算。 */
  overlaps: string[];
  /** 上班中、但台北的一般支援不在（只有值班）。 */
  uncovered: boolean;
  /** 連回機房那條線的狀態：在用的系統有任何一個停了是中斷；都在跑但有介面出狀況是注意。 */
  health: Health;
  /** 據點在用、但現在停著的系統。 */
  blockedBy: SystemId[];
  staff: number;
  pendingApprovals: number;
  /** 流量分級 1–3，由人數決定。 */
  level: number;
  /** 現在連到哪個機房：平常是總行，演練中是備援中心。 */
  home: DcId;
}

export interface DcView {
  id: DcId;
  name: L10n;
  role: L10n;
  city: L10n;
  lon: number;
  lat: number;
  note: L10n;
  /** 現在在這個機房跑的系統。 */
  running: SystemId[];
  /** 正式環境在這裡、但現在停著的系統。 */
  down: SystemId[];
  /** 在這裡有一套待命環境的系統（只有備援中心有）。 */
  standby: SystemId[];
  health: Health;
}

export interface RegionView {
  id: RegionId;
  name: L10n;
  sites: string[];
  staff: number;
  pendingApprovals: number;
  open: number;
  health: Health;
}

/** 機房之間的幹線。 */
export interface TrunkView {
  id: 'vendor' | 'replica';
  from: DcId;
  to: DcId;
  active: boolean;
  level: number;
  health: Health;
}

/** 時區桌上的一格：比 UTC 快（或慢）幾小時、當地幾點。 */
export interface StripView {
  offset: number;
  hour: number;
  /** 當地時鐘在上班時段裡（不管星期幾）。 */
  working: boolean;
}

export interface SitesModel {
  /** 模型看的時刻（台北時間的 ISO 字串）。 */
  instant: string;
  taipei: LocalClock;
  /** 台北的一般支援現在有沒有人。 */
  supportOn: boolean;
  sites: SiteView[];
  dcs: DcView[];
  regions: RegionView[];
  trunks: TrunkView[];
  strips: StripView[];
  /** 當地正午落在哪一格（可以有小數）。時區桌上的太陽放在這裡。 */
  noonOffset: number;
  /** 這個小時在跑的批次（每日與每月）。 */
  batches: string[];
}

const staffLevel = (staff: number) => (staff >= 50 ? 3 : staff >= 25 ? 2 : 1);

/**
 * 多據點的模型。吃同一份 twinModel 的結果，所以時間、故障與演練都跟總行那個比例尺一致。
 */
export function sitesModel(state: AppState, model: TwinModel): SitesModel {
  const instant = instantOf(state, model);
  const taipei = localClock(TAIPEI, instant);
  const supportOn = isWorkday(taipei.day) && taipei.hour >= SUPPORT_HOURS.from && taipei.hour < SUPPORT_HOURS.to;
  const used = siteSystems(state);
  const healthOf = new Map(model.systems.map((s) => [s.id, s.health]));
  const blockedBy = used.filter((id) => model.down.includes(id));
  // 連不上（用到的系統停了）才是中斷；系統還在跑、只是有介面出狀況，據點看到的是「注意」
  const linkHealth: Health = blockedBy.length ? 'crit' : used.some((id) => (healthOf.get(id) ?? 'ok') !== 'ok') ? 'warn' : 'ok';
  const batchIfaces = state.ifaces.filter(
    (i) => (i.schedule.kind === 'daily' || i.schedule.kind === 'monthly') && model.flows.find((f) => f.id === i.id)?.active,
  );
  const touching = batchIfaces.filter((i) => used.includes(i.source) || used.includes(i.target)).map((i) => i.id);
  const home: DcId = model.drill ? 'dc-dr' : 'dc-hq';

  const view = (
    kind: SiteKind,
    s: { id: string; name: L10n; lon: number; lat: number; staff: number; pendingApprovals: number },
    regionId: RegionId,
    tz: string,
    city: L10n | null,
  ): SiteView => {
    const clock = tz === TAIPEI ? taipei : localClock(tz, instant);
    const open = isOpen(clock);
    return {
      id: s.id,
      kind,
      name: s.name,
      city,
      regionId,
      lon: s.lon,
      lat: s.lat,
      tz,
      clock,
      open,
      overlaps: open ? touching : [],
      uncovered: open && !supportOn,
      health: linkHealth,
      blockedBy,
      staff: s.staff,
      pendingApprovals: s.pendingApprovals,
      level: staffLevel(s.staff),
      home,
    };
  };
  const sites = [
    ...state.branches.map((b) => view('branch', b, b.regionId, TAIPEI, null)),
    ...state.overseas.map((o) => view('overseas', o, 'overseas', o.tz, o.city)),
  ];

  const standby = state.systems.filter((s) => s.dcId === 'dc-hq' && s.dr.mode !== 'backup').map((s) => s.id);
  const dcs = state.dataCentres.map((dc): DcView => {
    const mine = state.systems.filter((s) => s.dcId === dc.id).map((s) => s.id);
    const running = model.systems.filter((s) => s.place === dc.id && !model.down.includes(s.id)).map((s) => s.id);
    const down = mine.filter((id) => model.down.includes(id));
    // 跟據點同一套規則：有系統停了才是中斷；都在跑但有介面出狀況是注意。
    // 備援中心平常只是待命；演練中還有系統沒接手完是注意。
    const health: Health =
      dc.id === 'dc-dr'
        ? model.drill?.down.length
          ? 'warn'
          : 'ok'
        : down.length
          ? 'crit'
          : mine.some((id) => (healthOf.get(id) ?? 'ok') !== 'ok')
            ? 'warn'
            : 'ok';
    return { ...dc, running, down, standby: dc.id === 'dc-dr' ? standby : [], health: model.drill && dc.id === 'dc-hq' ? 'crit' : health };
  });

  const regions = REGIONS.map((r): RegionView => {
    const inside = sites.filter((s) => s.regionId === r.id);
    return {
      id: r.id,
      name: r.name,
      sites: inside.map((s) => s.id),
      staff: inside.reduce((sum, s) => sum + s.staff, 0),
      pendingApprovals: inside.reduce((sum, s) => sum + s.pendingApprovals, 0),
      open: inside.filter((s) => s.open).length,
      health: inside.map((s) => s.health).reduce(worse, 'ok' as Health),
    };
  });

  // CRM 在廠商那邊：動到 CRM 的介面，資料都要走廠商機房與自家機房之間的專線
  const crmFlows = model.flows.filter((f) => f.active && (f.from === 'crm' || f.to === 'crm'));
  const trunks: TrunkView[] = [
    {
      id: 'vendor',
      from: 'dc-vendor',
      to: home,
      active: crmFlows.length > 0,
      level: Math.max(1, ...crmFlows.map((f) => f.level)),
      health: crmFlows.map((f): Health => (f.stalled ? 'crit' : f.health)).reduce(worse, 'ok' as Health),
    },
    // 總行往備援中心的資料複寫；總行機房停擺時當然也停了
    { id: 'replica', from: 'dc-hq', to: 'dc-dr', active: !model.drill, level: 1, health: 'ok' },
  ];

  const utcHour = ((((taipei.hour * 60 + taipei.minute - TAIPEI_OFFSET) / 60) % 24) + 24) % 24;
  const strips = Array.from({ length: 24 }, (_, i): StripView => {
    const offset = i - 11;
    const hour = Math.floor((((utcHour + offset) % 24) + 24) % 24);
    return { offset, hour, working: hour >= OPEN_HOURS.from && hour < OPEN_HOURS.to };
  });
  let noonOffset = 12 - utcHour;
  if (noonOffset > 12.5) noonOffset -= 24;
  if (noonOffset < -11.5) noonOffset += 24;

  return { instant, taipei, supportOn, sites, dcs, regions, trunks, strips, noonOffset, batches: batchIfaces.map((i) => i.id) };
}

// ── 月結日這個「營業日」，在各地是什麼時候

export interface DayRow {
  id: string;
  name: L10n;
  offsetMin: number;
  /** 當地上班與下班，換成台北時間、從月結日 00:00 起算的小時數（超過 24 就是台北的隔天）。 */
  openAt: number;
  closeAt: number;
  /** 上班時段裡會遇到的批次。 */
  overlaps: { ifaceId: string; at: number }[];
  /** 上班時段裡，台北的一般支援不在的小時數。 */
  uncoveredHr: number;
}

export interface BusinessDay {
  /** 月結日。 */
  day: string;
  rows: DayRow[];
  /** 這段時間裡總行會跑的批次。touches 是它有沒有動到據點在用的系統。 */
  batches: { ifaceId: string; at: number; touches: boolean }[];
  /** 台北一般支援在的時段。 */
  support: { from: number; to: number }[];
  /** 全集團過完這個營業日：最早開門到最晚關門。 */
  span: { from: number; to: number; hours: number };
  /** 圖的範圍。 */
  window: { from: number; to: number };
}

const clockHours = (time: string) => Number(time.slice(0, 2)) + Number(time.slice(3, 5)) / 60;

/**
 * 月結日（同一個日曆日）在每個據點是台北的幾點到幾點。
 * 台北的月結日結束時，洛杉磯的同一天還沒開始上班；總行的夜間批次，是紐約的上班時間。
 */
export function businessDay(state: AppState): BusinessDay {
  const day = MONTH_END;
  const window = { from: 0, to: 36 };
  const used = siteSystems(state);
  const noon = at(day, '12:00');
  const batches = [0, 1]
    .flatMap((plus) =>
      state.ifaces
        // 每月一次的批次只在月結日那天跑
        .filter((i) => i.schedule.at && (i.schedule.kind === 'daily' || (i.schedule.kind === 'monthly' && plus === 0)))
        .map((i) => ({ ifaceId: i.id, at: clockHours(i.schedule.at ?? '00:00') + plus * 24, touches: used.includes(i.source) || used.includes(i.target) })),
    )
    .filter((b) => b.at < window.to)
    .sort((a, b) => a.at - b.at);
  const support = [0, 1]
    .filter((plus) => isWorkday(addDays(day, plus)))
    .map((plus) => ({ from: SUPPORT_HOURS.from + plus * 24, to: SUPPORT_HOURS.to + plus * 24 }));
  const covered = (hour: number) => support.some((s) => hour >= s.from && hour < s.to);

  const row = (id: string, name: L10n, tz: string): DayRow => {
    const offsetMin = tzOffsetMin(tz, noon);
    const shift = (TAIPEI_OFFSET - offsetMin) / 60;
    const openAt = OPEN_HOURS.from + shift;
    const closeAt = OPEN_HOURS.to + shift;
    let uncoveredHr = 0;
    for (let h = openAt; h < closeAt; h++) if (!covered(h)) uncoveredHr++;
    return {
      id,
      name,
      offsetMin,
      openAt,
      closeAt,
      overlaps: batches.filter((b) => b.touches && b.at >= openAt && b.at < closeAt).map((b) => ({ ifaceId: b.ifaceId, at: b.at })),
      uncoveredHr,
    };
  };
  const rows = [row('tw', L('總行與國內據點', 'Head office and domestic branches'), TAIPEI), ...state.overseas.map((o) => row(o.id, o.name, o.tz))].sort(
    (a, b) => a.openAt - b.openAt,
  );
  const from = Math.min(...rows.map((r) => r.openAt));
  const to = Math.max(...rows.map((r) => r.closeAt));
  return { day, rows, batches, support, span: { from, to, hours: to - from }, window };
}
