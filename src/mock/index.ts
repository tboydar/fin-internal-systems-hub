import { DEFAULT_MATRIX } from '../core/rbac';
import type { AppState } from '../core/types';
import { buildApis, buildIfaces } from './ifaces';
import { buildBranches, buildPeople, buildSystems, buildVendors } from './org';
import { DEFAULT_SEED, forkRng } from './rng';
import { buildRuns } from './runs';

/** 資料結構有不相容的變更時把這個數字加一，舊的 localStorage 就會自動重建。 */
export const STATE_VERSION = 1;

/** 用固定 seed 產生整份初始資料。同一個 seed 的結果永遠相同。 */
export function buildInitialState(seed: number = DEFAULT_SEED): AppState {
  const ifaces = buildIfaces();
  return {
    version: STATE_VERSION,
    seed,
    systems: buildSystems(),
    vendors: buildVendors(),
    people: buildPeople(),
    tasks: [],
    reviews: [],
    ifaces,
    runs: buildRuns(forkRng(seed, 'runs'), ifaces),
    dlq: [],
    apis: buildApis(),
    reconRules: [],
    reconDiffs: [],
    tickets: [],
    deliverables: [],
    milestones: [],
    raci: [],
    changeRequests: [],
    demands: [],
    decisions: [],
    incidents: [],
    changes: [],
    adrs: [],
    docs: [],
    roadmap: [],
    branches: buildBranches(),
    audit: [],
    rbac: structuredClone(DEFAULT_MATRIX),
    scenario: null,
    faults: [],
    counters: {},
  };
}
