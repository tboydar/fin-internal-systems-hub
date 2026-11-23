import { CLOSE_DAY, MONTH_END, TODAY, workdaysBetween } from './date';
import { L } from './i18n';
import type { AppState, Domain, Health, Iface, L10n, Run, System, SystemId } from './types';

// 從狀態推導出來的東西都放這裡。頁面與 3D 場景呼叫同一組函式，所以兩邊的數字一定一樣。

const WORST: Record<Health, number> = { ok: 0, warn: 1, crit: 2 };
export const worse = (a: Health, b: Health): Health => (WORST[a] >= WORST[b] ? a : b);

/** 這條介面最近一次的執行紀錄。 */
export function lastRun(state: AppState, ifaceId: string): Run | undefined {
  let latest: Run | undefined;
  for (const run of state.runs) if (run.ifaceId === ifaceId && (!latest || run.at > latest.at)) latest = run;
  return latest;
}

export function runsOf(state: AppState, ifaceId: string): Run[] {
  return state.runs.filter((r) => r.ifaceId === ifaceId).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** 這條介面會經過哪些系統：來源、目的，經整合層的再加上整合層。 */
export function touches(iface: Iface): SystemId[] {
  return iface.via === 'esb' ? [iface.source, 'esb', iface.target] : [iface.source, iface.target];
}

export interface IfaceStatus {
  health: Health;
  reason: L10n;
  run?: Run;
  /** 因為哪個系統被注入故障而停擺。 */
  faultOf?: SystemId;
}

const RUN_REASON: Record<Run['status'], L10n> = {
  ok: L('最近一次執行成功', 'Last run succeeded'),
  retried: L('重試後才成功', 'Succeeded only after retrying'),
  late: L('比排定時間晚完成', 'Finished later than scheduled'),
  held: L('上游還沒成功，先保留不執行', 'Held: waiting for an upstream interface'),
  fail: L('最近一次執行失敗', 'Last run failed'),
};

/** 一條介面現在的狀態：先看有沒有被注入故障，再看最近一次執行。 */
export function ifaceStatus(state: AppState, iface: Iface): IfaceStatus {
  const run = lastRun(state, iface.id);
  const faultOf = touches(iface).find((id) => state.faults.includes(id));
  if (faultOf) {
    const sys = state.systems.find((s) => s.id === faultOf);
    return { health: 'crit', reason: L(`${sys?.name.zh ?? faultOf} 停止服務（模擬）`, `${sys?.name.en ?? faultOf} is down (simulated)`), run, faultOf };
  }
  if (!run) return { health: 'ok', reason: L('還沒有執行紀錄', 'No runs yet') };
  const health: Health = run.status === 'fail' ? 'crit' : run.status === 'ok' ? 'ok' : 'warn';
  return { health, reason: run.note ?? RUN_REASON[run.status], run };
}

/** 一個系統的狀態：被注入故障就是中斷；否則取它經手的介面裡最差的。 */
export function systemHealth(state: AppState, system: System): Health {
  if (state.faults.includes(system.id)) return 'crit';
  let health: Health = 'ok';
  for (const iface of state.ifaces) {
    if (iface.source !== system.id && iface.target !== system.id) continue;
    health = worse(health, ifaceStatus(state, iface).health);
  }
  return health;
}

export function ifacesByHealth(state: AppState): Record<Health, Iface[]> {
  const out: Record<Health, Iface[]> = { ok: [], warn: [], crit: [] };
  for (const iface of state.ifaces) out[ifaceStatus(state, iface).health].push(iface);
  return out;
}

/** 某個系統經手的介面。 */
export function ifacesOf(state: AppState, systemId: SystemId): Iface[] {
  return state.ifaces.filter((i) => touches(i).includes(systemId));
}

export interface Impact {
  ifaces: Iface[];
  systems: SystemId[];
  domains: Domain[];
}

/**
 * 「如果它停了」：這個系統經手的介面全部中斷，再沿著相依關係（dependsOn）往下找會被擋住的介面。
 * 受影響的單位，是這些介面兩端的系統平常服務的單位。
 */
export function impactOf(state: AppState, systemId: SystemId): Impact {
  const hit = new Map<string, Iface>();
  for (const iface of ifacesOf(state, systemId)) hit.set(iface.id, iface);
  for (let grew = true; grew; ) {
    grew = false;
    for (const iface of state.ifaces) {
      if (!hit.has(iface.id) && iface.dependsOn.some((id) => hit.has(id))) {
        hit.set(iface.id, iface);
        grew = true;
      }
    }
  }
  const systems = new Set<SystemId>([systemId]);
  for (const iface of hit.values()) {
    systems.add(iface.source);
    systems.add(iface.target);
  }
  const domains = new Set<Domain>();
  for (const id of systems) for (const d of state.systems.find((s) => s.id === id)?.usedBy ?? []) domains.add(d);
  return { ifaces: [...hit.values()], systems: [...systems], domains: [...domains] };
}

/** 月結與關帳的倒數，單位是工作日。 */
export function closeCountdown(state: AppState): { today: string; monthEnd: string; closeDay: string; toMonthEnd: number; toClose: number; now: string } {
  return {
    today: TODAY,
    monthEnd: MONTH_END,
    closeDay: CLOSE_DAY,
    toMonthEnd: workdaysBetween(TODAY, MONTH_END),
    toClose: workdaysBetween(TODAY, CLOSE_DAY),
    now: state.clock,
  };
}
