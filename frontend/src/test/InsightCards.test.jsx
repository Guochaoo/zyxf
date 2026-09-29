import { describe, test, expect } from 'vitest';
import { densifyBySpline } from '../components/InsightCards.jsx';

// IMPROVE-58 第 5 组：densifyBySpline 是手写的 Fritsch–Carlson 单调三次样条
// （从 liveline 的 drawSpline 移植），纯函数、易测、但一旦切线公式写错只会表现为
// 「hover 小球离线」这种视觉漂移，肉眼很难发现。这里锁住它的数学性质。
const DAY = 86400;
const pts = (...values) => values.map((value, i) => ({ time: i * DAY, value, date: `${i + 1}/1` }));

describe('densifyBySpline', () => {
  test('点数不足或缺省采样密度时原样返回（不做插值）', () => {
    const single = pts(5);
    expect(densifyBySpline(single)).toBe(single);
    expect(densifyBySpline([])).toEqual([]);
    const two = pts(1, 2);
    expect(densifyBySpline(two, 1)).toBe(two); // samplesPerSegment < 2
    expect(densifyBySpline(two, 0)).toBe(two);
  });

  test('输出长度 = (n-1) × 每段采样数 + 1，且时间严格递增', () => {
    const out = densifyBySpline(pts(1, 4, 9), 8);
    expect(out).toHaveLength(2 * 8 + 1);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].time).toBeGreaterThan(out[i - 1].time);
    }
    expect(out[0].value).toBe(1);
    expect(out.at(-1).value).toBe(9);
  });

  test('原始数据点逐个精确复现（u=0 采样 + 末点），插值不改变锚点', () => {
    const points = pts(3, 7, 2, 11);
    const samples = 6;
    const out = densifyBySpline(points, samples);
    for (let i = 0; i < points.length - 1; i += 1) {
      expect(out[i * samples].value).toBe(points[i].value);
      expect(out[i * samples].time).toBe(points[i].time);
    }
    expect(out.at(-1).value).toBe(points.at(-1).value);
  });

  test('每段采样继承该段起点的日期，dayValue 是当天真实值而不是插值', () => {
    const points = pts(0, 10);
    const out = densifyBySpline(points, 4);
    for (const p of out.slice(0, 4)) {
      expect(p.date).toBe(points[0].date);
      expect(p.dayValue).toBe(0); // tooltip 显示真实日值，不显示样条插值
    }
    expect(out.at(-1).dayValue).toBe(10);
    expect(out.at(-1).date).toBe(points[1].date);
  });

  test('单调递增数据：输出非递减且不过冲（落在该段两端之间）', () => {
    const out = densifyBySpline(pts(1, 5, 6, 20), 12);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].value).toBeGreaterThanOrEqual(out[i - 1].value);
    }
    // 逐段区间校验：严格单调的三次插值不允许越过端点（Fritsch–Carlson 的意义）
    const edges = [1, 5, 6, 20];
    for (let seg = 0; seg < edges.length - 1; seg += 1) {
      for (const p of out.slice(seg * 12, (seg + 1) * 12)) {
        expect(p.value).toBeGreaterThanOrEqual(edges[seg] - 1e-9);
        expect(p.value).toBeLessThanOrEqual(edges[seg + 1] + 1e-9);
      }
    }
  });

  test('单调递减数据：输出非递增', () => {
    const out = densifyBySpline(pts(20, 6, 5, 1), 10);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].value).toBeLessThanOrEqual(out[i - 1].value);
    }
  });

  test('全等数据（斜率为 0）退化成直线：切线被强制为 0，不产生过冲波动', () => {
    const out = densifyBySpline(pts(4, 4, 4), 9);
    expect(out).toHaveLength(2 * 9 + 1);
    for (const p of out) expect(p.value).toBe(4);
  });

  test('平台后突跳：平段被夹平（斜率 0 → 两端切线归零），突跳段仍单调', () => {
    const out = densifyBySpline(pts(0, 0, 9), 8);
    for (const p of out.slice(0, 8)) expect(p.value).toBe(0);
    const tail = out.slice(8);
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i].value).toBeGreaterThanOrEqual(tail[i - 1].value);
    }
    expect(out.at(-1).value).toBe(9);
  });
});
