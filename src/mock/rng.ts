// 固定 seed 的亂數產生器（mulberry32）。
// 同一個 seed 一定產生同一串數字，所以「重設 Demo 資料」每次結果都一樣。

export interface Rng {
  next(): number;
  float(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  /** 近似常態分布（平均 0、標準差 1），用來做時序資料的雜訊。 */
  gauss(): number;
}

export const DEFAULT_SEED = 20261123;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const float = (min: number, max: number) => min + next() * (max - min);
  return {
    next,
    float,
    int: (min, max) => Math.floor(float(min, max + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    gauss: () => {
      const u = Math.max(next(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

/** 每個資料集各自拿一條獨立的亂數序列：改動其中一個，不會連帶改變其他資料集。 */
export function forkRng(seed: number, name: string): Rng {
  return createRng(hash(`${seed}:${name}`));
}
