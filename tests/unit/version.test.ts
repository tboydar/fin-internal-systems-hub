import { describe, expect, test } from 'bun:test';
import { formatVersion, resolveCommit, resolveVersion, sequence, taipeiDate, taipeiDayStart } from '../../scripts/app-version';

// 版號：v<台灣日期>.<當天第幾次 CI>

describe('版號', () => {
  test('日期用台灣時間：UTC 16:00 就是台灣的隔天零點', () => {
    expect(taipeiDate(new Date('2026-11-22T15:59:59Z'))).toBe('20261122');
    expect(taipeiDate(new Date('2026-11-22T16:00:00Z'))).toBe('20261123');
    expect(taipeiDate(new Date('2026-12-31T16:00:00Z'))).toBe('20270101');
    expect(taipeiDayStart(new Date('2026-11-23T09:00:00Z')).toISOString()).toBe('2026-11-22T16:00:00.000Z');
  });

  test('序號是這次的執行編號減掉今天之前最後一次的編號', () => {
    expect(sequence(12, 11)).toBe(1);
    expect(sequence(15, 11)).toBe(4);
    expect(sequence(3, 0)).toBe(3);
    expect(formatVersion(new Date('2026-11-23T01:00:00Z'), 1)).toBe('v20261123.1');
  });

  test('本機建置是 v<今天>.dev；設了 APP_VERSION 就直接用', async () => {
    expect(await resolveVersion({}, fetch, new Date('2026-11-23T01:00:00Z'))).toBe('v20261123.dev');
    expect(await resolveVersion({ APP_VERSION: 'v20261123.7', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1' })).toBe('v20261123.7');
  });

  const ci = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'someone/some-repo',
    GITHUB_RUN_ID: '900',
    GITHUB_RUN_NUMBER: '57',
    GITHUB_WORKFLOW_REF: 'someone/some-repo/.github/workflows/deploy.yml@refs/heads/main',
  };
  const respond = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

  test('在 CI：向 GitHub 查這次流程的建立時間，以及今天之前最後一次的編號', async () => {
    const asked: string[] = [];
    const version = await resolveVersion(ci, (url) => {
      asked.push(url);
      return url.includes('/actions/runs/900') ? respond({ created_at: '2026-11-23T18:30:00Z' }) : respond({ workflow_runs: [{ run_number: 54 }] });
    });
    // UTC 18:30 是台灣 11/24 的 02:30；第 57 次減掉之前的第 54 次，是當天第 3 次
    expect(version).toBe('v20261124.3');
    expect(asked[0]).toBe('https://api.github.com/repos/someone/some-repo/actions/runs/900');
    expect(asked[1]).toBe(
      `https://api.github.com/repos/someone/some-repo/actions/workflows/deploy.yml/runs?created=${encodeURIComponent('<2026-11-23T16:00:00Z')}&per_page=1`,
    );
  });

  test('在 CI：今天之前沒有任何執行，序號就是執行編號', async () => {
    const version = await resolveVersion({ ...ci, GITHUB_RUN_NUMBER: '12' }, (url) =>
      url.includes('/actions/runs/900') ? respond({ created_at: '2026-11-23T09:10:00Z' }) : respond({ workflow_runs: [] }),
    );
    expect(version).toBe('v20261123.12');
  });

  test('在 CI：查不到就改用執行編號，前面加 r', async () => {
    const version = await resolveVersion(ci, () => respond({}, false), new Date('2026-11-23T01:00:00Z'));
    expect(version).toBe('v20261123.r57');
  });

  test('commit 取前 7 碼', () => {
    expect(resolveCommit({ GITHUB_SHA: '4a14cee0123456789abcdef0123456789abcdef0' })).toBe('4a14cee');
    expect(resolveCommit({ APP_COMMIT: 'abc1234' })).toBe('abc1234');
  });
});
