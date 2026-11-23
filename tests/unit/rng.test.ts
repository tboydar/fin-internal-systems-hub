import { describe, expect, test } from 'bun:test';
import { createRng, DEFAULT_SEED, forkRng } from '../../src/mock/rng';

describe('seeded RNG', () => {
  test('同一個 seed 產生同一串數字', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  test('不同的 seed 產生不同的數字', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  test('next() 落在 [0, 1)，int() 含頭含尾', () => {
    const rng = createRng(DEFAULT_SEED);
    for (let i = 0; i < 500; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const k = rng.int(3, 5);
      expect([3, 4, 5]).toContain(k);
    }
  });

  test('fork 出來的序列互不影響：多抽 A 不會改變 B', () => {
    const b1 = forkRng(7, 'b').next();
    const a = forkRng(7, 'a');
    for (let i = 0; i < 100; i++) a.next();
    expect(forkRng(7, 'b').next()).toBe(b1);
    expect(forkRng(7, 'a').next()).not.toBe(b1);
  });

  test('gauss() 的平均接近 0', () => {
    const rng = createRng(99);
    const mean = Array.from({ length: 4000 }, () => rng.gauss()).reduce((s, v) => s + v, 0) / 4000;
    expect(Math.abs(mean)).toBeLessThan(0.08);
  });
});
