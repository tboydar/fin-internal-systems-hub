import { hourOf } from './date';
import { type Drill, drillAt } from './drill';
import { L } from './i18n';
import { ifaceStatus, impactOf, systemHealth, worse } from './selectors';
import type { AppState, DcId, Domain, Health, Iface, L10n, SystemId } from './types';

// 3D 微縮總行要畫的東西，全部在這裡從狀態算出來。
// 這個檔案不碰 three：3D 場景只負責把這份模型畫出來，旁邊的 2D 清單也讀同一份模型，
// 所以兩邊不會各算各的。沒有 WebGL 的時候，同一份模型直接變成一張表。

/** 總行的樓層，由下往上。地下一樓是機房。 */
export const FLOORS: { domain: Domain; name: L10n }[] = [
  { domain: 'sales', name: L('1F 業務', '1F Sales') },
  { domain: 'finance', name: L('2F 財務', '2F Finance') },
  { domain: 'hr', name: L('3F 人資', '3F HR') },
  { domain: 'procurement', name: L('4F 採購', '4F Procurement') },
  { domain: 'it', name: L('5F 資訊', '5F IT') },
];

/** 機房裡機櫃由左到右的順序。整合層放中間，因為大部分的資料都經過它。 */
export const RACKS: SystemId[] = ['hr', 'crm', 'wf', 'iam', 'esb', 'dw', 'erp-po', 'erp-ap', 'erp-gl'];

export interface TwinFlow {
  id: string;
  from: SystemId;
  to: SystemId;
  viaEsb: boolean;
  /** 這條介面是哪個單位的事（也就是哪一層樓）。 */
  domain: Domain;
  health: Health;
  /** 這個小時有沒有資料在跑。 */
  active: boolean;
  /** 演練中：這條介面會中斷或被擋住。只有演練時才會是 true，平常的故障看 health。 */
  stalled: boolean;
  /** 流量分級 1–4，決定小紙片的數量與速度。 */
  level: number;
  /** 這個小時大約跑幾筆。 */
  records: number;
}

export interface TwinModel {
  /** 目前看的是幾點（0–23）。 */
  hour: number;
  /** true 是重播月結日；false 是 Demo 的現在。 */
  replay: boolean;
  /** place 是這個系統現在在哪個機房跑：平常是它自己的機房，演練中接手之後是備援中心。 */
  systems: { id: SystemId; health: Health; faulty: boolean; place: DcId }[];
  flows: TwinFlow[];
  /** systems 是這個單位每天在用的系統。 */
  floors: { domain: Domain; health: Health; affected: boolean; systems: SystemId[] }[];
  branchHealth: Health;
  /** 被注入故障的系統、正在看影響範圍的系統，加上演練中還沒回來的系統。 */
  down: SystemId[];
  /** 「總行機房停擺」演練的進度；沒有在演練是 null。 */
  drill: Drill | null;
  /** 影響範圍：受影響的介面編號、系統與樓層。沒有故障也沒有在看影響範圍時是 null。 */
  affected: { ifaceIds: string[]; systems: SystemId[]; domains: Domain[] } | null;
}

/** 一條介面在某個小時大約跑幾筆。即時與固定間隔的介面攤平成每小時；批次集中在排定的那一小時。 */
export function recordsAt(iface: Iface, hour: number): number {
  if (!iface.schedule.hours.includes(hour)) return 0;
  const s = iface.schedule;
  if (s.kind === 'realtime') return Math.round(iface.volume / s.hours.length);
  if (s.kind === 'interval') return Math.round(iface.volume * (60 / (s.everyMin ?? 60)));
  return iface.volume;
}

function level(records: number): number {
  if (records >= 5000) return 4;
  if (records >= 500) return 3;
  if (records >= 50) return 2;
  return 1;
}

/**
 * 3D 與 2D 共用的模型。
 * hour 給 null 就看 Demo 的現在；給 0–23 就重播月結日的那個小時（每月一次的批次也算進來）。
 * probe 是正在看「如果它停了」的系統（還沒真的注入故障）。
 * drillStep 是「總行機房停擺」演練看到第幾個時間點；null 是沒有在演練。
 * probe 與演練都只是「如果」：不改資料，也不改介面的 health。
 */
export function twinModel(state: AppState, hour: number | null = null, probe: SystemId | null = null, drillStep: number | null = null): TwinModel {
  const replay = hour !== null;
  const at = hour ?? hourOf(state.clock);
  const drill = drillStep === null ? null : drillAt(state, drillStep);
  const down = [...new Set([...state.faults, ...(probe ? [probe] : []), ...(drill?.down ?? [])])];
  const flows: TwinFlow[] = state.ifaces.map((iface) => {
    // 每月一次的批次只在月結日跑；看「現在」的時候，除非今天剛好有排，否則不算
    const monthlyOff = iface.schedule.kind === 'monthly' && !replay && iface.id !== 'INT-015';
    const records = monthlyOff ? 0 : recordsAt(iface, at);
    return {
      id: iface.id,
      from: iface.source,
      to: iface.target,
      viaEsb: iface.via === 'esb',
      domain: iface.domain,
      health: ifaceStatus(state, iface).health,
      active: records > 0,
      stalled: false,
      level: level(records),
      records,
    };
  });
  let affected: TwinModel['affected'] = null;
  if (down.length) {
    const ifaceIds = new Set<string>();
    const systems = new Set<SystemId>();
    const domains = new Set<Domain>();
    for (const id of down) {
      const impact = impactOf(state, id);
      for (const i of impact.ifaces) ifaceIds.add(i.id);
      for (const s of impact.systems) systems.add(s);
      for (const d of impact.domains) domains.add(d);
    }
    affected = { ifaceIds: [...ifaceIds], systems: [...systems], domains: [...domains] };
    if (drill) for (const flow of flows) flow.stalled = ifaceIds.has(flow.id);
  }
  const crm = state.systems.find((s) => s.id === 'crm');
  return {
    hour: at,
    replay,
    systems: RACKS.map((id) => {
      const sys = state.systems.find((s) => s.id === id);
      return {
        id,
        health: sys ? systemHealth(state, sys) : 'ok',
        faulty: state.faults.includes(id),
        place: drill?.recovered.includes(id) ? 'dc-dr' : (sys?.dcId ?? 'dc-hq'),
      };
    }),
    flows,
    floors: FLOORS.map(({ domain }) => ({
      domain,
      systems: state.systems.filter((s) => s.usedBy.includes(domain)).map((s) => s.id),
      health: state.ifaces
        .filter((i) => i.domain === domain)
        .map((i) => ifaceStatus(state, i).health)
        .reduce(worse, 'ok' as Health),
      affected: affected?.domains.includes(domain) ?? false,
    })),
    branchHealth: crm ? systemHealth(state, crm) : 'ok',
    down,
    drill,
    affected,
  };
}

/** 月結日 24 小時裡，每個小時有幾條介面在跑、合計幾筆。時間軸下面的長條與「夜間批次集中」的說明都讀這個。 */
export function dayProfile(state: AppState): { hour: number; ifaces: number; records: number }[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const running = state.ifaces.filter((i) => recordsAt(i, hour) > 0);
    return { hour, ifaces: running.length, records: running.reduce((sum, i) => sum + recordsAt(i, hour), 0) };
  });
}
