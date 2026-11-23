// 算出這次建置的版號：v<台灣日期>.<當天第幾次 CI>，例如 v20261123.3。
//
// - 在 GitHub Actions 裡：日期是這次流程建立的時間（台灣時間），序號是同一個流程當天的第幾次執行。
//   失敗或被取消的執行也佔一個號碼，所以每跑一次 CI 就加一。
// - 在本機：v<今天>.dev
// - 設了 APP_VERSION 就直接用它（要在本機重現某一版的建置結果時用）。
//
// 執行：bun scripts/app-version.ts（印出版號）。建置時由 vite.config.ts 呼叫。

import { execFileSync } from 'node:child_process';

type Env = Record<string, string | undefined>;
type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// 台灣沒有日光節約時間，固定是 UTC+8
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 某個時間點在台灣是哪一天，格式 YYYYMMDD。 */
export function taipeiDate(at: Date): string {
  return new Date(at.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', '');
}

/** 那個時間點所在的台灣日期的零點。 */
export function taipeiDayStart(at: Date): Date {
  const shifted = new Date(at.getTime() + TAIPEI_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - TAIPEI_OFFSET_MS);
}

/** 當天第幾次：這次的執行編號，減掉「今天之前最後一次」的執行編號。 */
export function sequence(runNumber: number, lastRunNumberBeforeToday: number): number {
  return Math.max(1, runNumber - lastRunNumberBeforeToday);
}

export function formatVersion(at: Date, seq: number | string): string {
  return `v${taipeiDate(at)}.${seq}`;
}

async function ciVersion(env: Env, fetcher: Fetcher): Promise<string> {
  const runNumber = Number(env.GITHUB_RUN_NUMBER);
  const workflowFile = (env.GITHUB_WORKFLOW_REF ?? '').split('@')[0].split('/').pop();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'app-version' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const api = async (path: string): Promise<unknown> => {
    const res = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return res.json();
  };
  const run = (await api(`actions/runs/${env.GITHUB_RUN_ID}`)) as { created_at: string };
  const created = new Date(run.created_at);
  const start = taipeiDayStart(created).toISOString().replace('.000Z', 'Z');
  // 今天之前最後一次執行（清單由新到舊）。沒有的話，今天的第一次就是第 1 號。
  const before = (await api(`actions/workflows/${workflowFile}/runs?created=${encodeURIComponent(`<${start}`)}&per_page=1`)) as {
    workflow_runs?: { run_number: number }[];
  };
  return formatVersion(created, sequence(runNumber, before.workflow_runs?.[0]?.run_number ?? 0));
}

export async function resolveVersion(env: Env = process.env, fetcher: Fetcher = fetch, now: Date = new Date()): Promise<string> {
  if (env.APP_VERSION) return env.APP_VERSION;
  if (!env.GITHUB_ACTIONS || !env.GITHUB_RUN_ID) return formatVersion(now, 'dev');
  try {
    return await ciVersion(env, fetcher);
  } catch (error) {
    // 查不到當天的序號時，改用流程本身的執行編號，前面加 r 以示區別。版號仍然每次都不同。
    console.warn(`app-version: ${String(error)}，改用執行編號`);
    return formatVersion(now, `r${env.GITHUB_RUN_NUMBER ?? '0'}`);
  }
}

/** 這次建置對應的 commit（前 7 碼）。查不到就回空字串。 */
export function resolveCommit(env: Env = process.env): string {
  if (env.APP_COMMIT) return env.APP_COMMIT;
  if (env.GITHUB_SHA) return env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

if (import.meta.main) console.log(await resolveVersion());
