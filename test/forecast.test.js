import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildForecast } from '../src/forecast.js';

const samples = [
  { t: 100, v: 100 },
  { t: 200, v: 104 },
  { t: 300, v: 96 },
  { t: 400, v: 500 },
  { t: 500, v: 480 },
];

const anomalyWindows = [{ start: 350, end: 550, reason: 'incident' }];

test('预测点与区间基于剔除事故后的基线均值', () => {
  const { forecast, naiveForecast } = buildForecast({
    samples,
    anomalyWindows,
    errorMargin: 0.1,
    horizonMs: 1000,
    now: 600,
  });

  assert.equal(forecast.point, 100);
  assert.equal(forecast.lower, 90);
  assert.ok(Math.abs(forecast.upper - 110) < 1e-9);
  assert.equal(forecast.excludedCount, 2);
  assert.equal(forecast.normalSampleCount, 3);

  assert.equal(naiveForecast.point, 256);
  assert.ok(Math.abs(naiveForecast.upper - 281.6) < 1e-9);
});

test('预测窗口与事故窗口重叠时标记 contaminated', () => {
  const { forecast } = buildForecast({
    samples,
    anomalyWindows: [{ start: 900, end: 1200 }],
    errorMargin: 0.1,
    horizonMs: 1000,
    now: 600,
  });
  assert.equal(forecast.contaminated, true);
  assert.equal(forecast.overlappingWindows.length, 1);
});

test('事故窗口已完全结束且不与预测窗口相交时不视为污染', () => {
  const { forecast } = buildForecast({
    samples,
    anomalyWindows,
    errorMargin: 0.1,
    horizonMs: 400,
    now: 600,
  });
  assert.equal(forecast.contaminated, false);
  assert.deepEqual(forecast.horizon, { start: 600, end: 1000 });
});

test('预测偏差通过 errorMargin 直接反映在区间宽度上', () => {
  const { forecast } = buildForecast({
    samples: samples.slice(0, 3),
    anomalyWindows: [],
    errorMargin: 0.35,
    horizonMs: 1000,
    now: 600,
  });
  assert.equal(forecast.lower, 65);
  assert.equal(forecast.upper, 135);
  assert.equal(forecast.errorMargin, 0.35);
});
