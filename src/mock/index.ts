import { at, DEMO_NOW } from '../core/date';
import { L } from '../core/i18n';
import { DEFAULT_MATRIX } from '../core/rbac';
import type { AppState, AuditEntry, L10n, RoleId } from '../core/types';
import { buildDecisions, buildDemands } from './demands';
import { buildApis, buildIfaces } from './ifaces';
import { buildAdrs, buildDocs, buildRoadmap } from './knowledge';
import { buildChanges, buildIncidents } from './ops';
import { buildBranches, buildPeople, buildSystems, buildVendors } from './org';
import { buildReconDiffs, buildReconRules } from './recon';
import { DEFAULT_SEED, forkRng } from './rng';
import { buildRuns } from './runs';
import { buildChangeRequests, buildDeliverables, buildMilestones, buildRaci, buildTickets } from './vendors';
import { buildReviews, buildTasks } from './work';

/** 資料結構有不相容的變更時把這個數字加一，舊的 localStorage 就會自動重建。 */
export const STATE_VERSION = 4;

/** 稽核軌跡一開始就有的幾筆：最近兩週真的會留下紀錄的動作。 */
function buildAudit(): AuditEntry[] {
  const row = (n: number, day: string, time: string, actor: L10n, role: RoleId | 'system', action: L10n, target: string, detail: L10n): AuditEntry => ({
    id: `AU-${String(n).padStart(4, '0')}`,
    at: at(day, time),
    actor,
    role,
    action,
    target,
    detail,
  });
  const tl = L('褚以衡', 'Yi-Heng Chu');
  const admin = L('系統管理員帳號', 'System administrator account');
  return [
    row(
      8,
      '2026-11-26',
      '17:42',
      tl,
      'techlead',
      L('核准變更', 'Approved change'),
      'CHG-242',
      L('AD 簽章憑證更新，12/5 10:00–12:00', 'Renew the AD signing certificate, 12/5 10:00–12:00'),
    ),
    row(
      7,
      '2026-11-26',
      '17:40',
      tl,
      'techlead',
      L('核准變更', 'Approved change'),
      'CHG-241',
      L('月結前參數檢核，11/27 18:00–19:00', 'Pre-month-end parameter check, 11/27 18:00–19:00'),
    ),
    row(
      6,
      '2026-11-21',
      '09:12',
      tl,
      'techlead',
      L('核准變更', 'Approved change'),
      'CHG-240',
      L('應付對帳查詢加兩個索引', 'Add two indexes for the payables reconciliation query'),
    ),
    row(
      5,
      '2026-11-20',
      '14:05',
      admin,
      'admin',
      L('收回權限', 'Revoked permission'),
      'vendorpm',
      L('委外廠商 PM：看介面的技術細節', 'Vendor PM: See interface technical details'),
    ),
    row(
      4,
      '2026-11-19',
      '16:30',
      tl,
      'techlead',
      L('核准變更', 'Approved change'),
      'CHG-239',
      L('整合層重試間隔調整', 'Adjust integration-layer retry intervals'),
    ),
    row(
      3,
      '2026-11-13',
      '18:20',
      tl,
      'techlead',
      L('核准變更', 'Approved change'),
      'CHG-238',
      L('ERP 11.4.2 稅務法規修補上線', 'Release ERP tax patch 11.4.2'),
    ),
    row(
      2,
      '2026-11-13',
      '15:02',
      tl,
      'techlead',
      L('驗收通過', 'Accepted deliverable'),
      'DL-404',
      L('嶼衡資訊：月結效能調校報告', 'Birchlight Systems: month-end performance tuning report'),
    ),
    row(
      1,
      '2026-11-09',
      '11:15',
      tl,
      'techlead',
      L('核定變更請求', 'Decided change request'),
      'CR-031',
      L('核准：月結期間駐點顧問延長到 21:00', 'Approved: on-site consultant until 21:00 during month-end'),
    ),
  ];
}

/** 用固定 seed 產生整份初始資料。同一個 seed 的結果永遠相同。 */
export function buildInitialState(seed: number = DEFAULT_SEED): AppState {
  const ifaces = buildIfaces();
  const vendors = buildVendors();
  const audit = buildAudit();
  return {
    version: STATE_VERSION,
    seed,
    clock: DEMO_NOW,
    systems: buildSystems(),
    vendors,
    people: buildPeople(),
    tasks: buildTasks(),
    reviews: buildReviews(),
    ifaces,
    runs: buildRuns(forkRng(seed, 'runs'), ifaces),
    dlq: [],
    apis: buildApis(),
    reconRules: buildReconRules(),
    reconDiffs: buildReconDiffs(),
    tickets: buildTickets(forkRng(seed, 'tickets'), vendors),
    deliverables: buildDeliverables(),
    milestones: buildMilestones(),
    raci: buildRaci(vendors),
    changeRequests: buildChangeRequests(),
    demands: buildDemands(),
    decisions: buildDecisions(),
    incidents: buildIncidents(),
    changes: buildChanges(),
    adrs: buildAdrs(),
    docs: buildDocs(),
    roadmap: buildRoadmap(),
    branches: buildBranches(),
    audit,
    rbac: structuredClone(DEFAULT_MATRIX),
    scenario: null,
    faults: [],
    counters: { audit: audit.length },
  };
}
