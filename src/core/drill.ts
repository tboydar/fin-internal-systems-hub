import type { AppState, DcId, SystemId } from './types';

// 演練：「總行機房停擺」。
// 不改任何資料，只回答一個問題：停擺之後過了這麼久，哪些系統已經在備援中心接手、哪些還沒回來。
// 答案完全由每個系統的復原時間目標（RTO）推出來，所以 3D、清單與測試看到的是同一份。

export interface Drill {
  /** 第幾個時間點（steps 的索引）。 */
  step: number;
  /** 停擺之後過了幾小時。 */
  elapsedHr: number;
  /** 可以看的時間點：停擺當下，加上每一個復原時間目標。 */
  steps: number[];
  /** 還沒回來的系統。 */
  down: SystemId[];
  /** 已經在備援中心接手的系統。 */
  recovered: SystemId[];
  /** 不在總行機房、所以不受影響的系統。 */
  untouched: SystemId[];
  /** 下一個系統回來是停擺後第幾小時；都回來了是 null。 */
  nextHr: number | null;
  /** 全部回來要幾小時：最慢的那個系統決定。 */
  allBackHr: number;
}

const LOST: DcId = 'dc-hq';

/** 演練可以看的時間點，由小到大。 */
export function drillSteps(state: AppState): number[] {
  const hours = state.systems.filter((s) => s.dcId === LOST).map((s) => s.dr.rtoHr);
  return [...new Set([0, ...hours])].sort((a, b) => a - b);
}

/** 停擺後第 step 個時間點的狀況。step 超出範圍會被拉回來。 */
export function drillAt(state: AppState, step: number): Drill {
  const steps = drillSteps(state);
  const at = Math.min(Math.max(Math.trunc(step) || 0, 0), steps.length - 1);
  const elapsedHr = steps[at];
  const inside = state.systems.filter((s) => s.dcId === LOST);
  const down = inside.filter((s) => s.dr.rtoHr > elapsedHr);
  return {
    step: at,
    elapsedHr,
    steps,
    down: down.map((s) => s.id),
    recovered: inside.filter((s) => s.dr.rtoHr <= elapsedHr).map((s) => s.id),
    untouched: state.systems.filter((s) => s.dcId !== LOST).map((s) => s.id),
    nextHr: down.length ? Math.min(...down.map((s) => s.dr.rtoHr)) : null,
    allBackHr: steps[steps.length - 1],
  };
}
