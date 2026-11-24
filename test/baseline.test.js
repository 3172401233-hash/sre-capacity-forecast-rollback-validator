import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBaseline,
  isInAnomalyWindow,
  splitByAnomalies,
  summarize,
} from '../src/baseline.js';

const samples = [
  { t: 100, v: 100 },
  { t: 200, v: 110 },
  { t: 300, v: 90 },
  { t: 400, v: 500 },
  { t: 500, v: 520 },
  { t: 600, v: 105 },
];

const anomalyWindows = [{ start: 350, end: 550, reason: 'incident' }];

test('异常窗口采用半开区间 [start, end) 判定', () => {
  assert.equal(isInAnomalyWindow(350, anomalyWindows), true);
  assert.equal(isInAnomalyWindow(500, anomalyWindows), true);
  assert.equal(isInAnomalyWindow(550, anomalyWindows), false);
  assert.equal(isInAnomalyWindow(349, anomalyWindows), false);
});

test('事故峰值从基线样本中剔除，正常样本保留', () => {
  const { normalSamples, excludedSamples } = splitByAnomalies(
    samples,
    anomalyWindows,
  );
  assert.deepEqual(excludedSamples, [
    { t: 400, v: 500 },
    { t: 500, v: 520 },
  ]);
  assert.deepEqual(normalSamples.map((sample) => sample.t), [
    100, 200, 300, 600,
  ]);
});

test('基线统计不受事故峰值污染', () => {
  const { stats, excludedSamples } = buildBaseline(samples, anomalyWindows);
  assert.equal(stats.count, 4);
  assert.equal(stats.mean, 101.25);
  assert.equal(stats.max, 110);
  assert.equal(stats.min, 90);
  assert.equal(excludedSamples.length, 2);

  const naive = summarize(samples);
  assert.equal(naive.mean, 237.5);
  assert.ok(naive.mean > stats.mean);
});

test('无异常窗口时全部样本参与基线计算', () => {
  const { stats, excludedSamples } = buildBaseline(samples, []);
  assert.equal(stats.count, 6);
  assert.equal(excludedSamples.length, 0);
});
