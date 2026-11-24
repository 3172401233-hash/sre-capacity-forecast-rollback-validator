import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildForecast } from '../src/forecast.js';
import { evaluateScaling } from '../src/scaling.js';

const cleanSamples = [
  { t: 100, v: 100 },
  { t: 200, v: 104 },
  { t: 300, v: 96 },
];

function review({
  samples = cleanSamples,
  anomalyWindows = [],
  errorMargin = 0.1,
  errorThreshold = 0.2,
  currentReplicas = 4,
  replicaCapacity = 25,
  targetUtilization = 1,
  costPerReplicaPerHour = 2,
  now = 600,
  horizonMs = 1000,
} = {}) {
  const { forecast, naiveForecast } = buildForecast({
    samples,
    anomalyWindows,
    errorMargin,
    horizonMs,
    now,
  });
  return evaluateScaling({
    currentReplicas,
    replicaCapacity,
    targetUtilization,
    costPerReplicaPerHour,
    forecast,
    naiveForecast,
    errorThreshold,
  });
}

test('可信且容量不足时按预测上限扩容', () => {
  const result = review({ currentReplicas: 4, replicaCapacity: 25 });
  assert.equal(result.trusted, true);
  assert.equal(result.action, 'scale_up');
  assert.equal(result.pointReplicas, 4);
  assert.equal(result.upperReplicas, 5);
  assert.equal(result.recommendedReplicas, 5);
  assert.equal(result.costs.recommendedPerHour, 10);
  assert.equal(result.costs.currentPerHour, 8);
});

test('可信但当前容量足够时不扩容', () => {
  const result = review({ currentReplicas: 5, replicaCapacity: 25 });
  assert.equal(result.trusted, true);
  assert.equal(result.action, 'none');
  assert.equal(result.recommendedReplicas, 5);
  assert.ok(result.reasons.includes('current_capacity_sufficient'));
});

test('预测窗口包含事故流量时建议不可信，保持现状', () => {
  const result = review({
    samples: [
      ...cleanSamples,
      { t: 400, v: 500 },
      { t: 500, v: 480 },
    ],
    anomalyWindows: [{ start: 350, end: 1200 }],
    currentReplicas: 4,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.action, 'hold');
  assert.equal(result.recommendedReplicas, 4);
  assert.ok(result.reasons.includes('forecast_window_overlaps_incident'));
  assert.equal(result.naiveReplicas, 11);
  assert.equal(result.inflatedByIncident, true);
});

test('预测偏差超过阈值时建议不可信，拒绝扩容', () => {
  const result = review({
    errorMargin: 0.3,
    errorThreshold: 0.2,
    currentReplicas: 4,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.action, 'hold');
  assert.ok(result.reasons.includes('forecast_error_above_threshold'));
  assert.equal(result.recommendedReplicas, 4);
});

test('目标利用率降低时所需副本数增加', () => {
  const result = review({
    currentReplicas: 5,
    replicaCapacity: 25,
    targetUtilization: 0.8,
  });
  assert.equal(result.pointReplicas, 5);
  assert.equal(result.upperReplicas, 6);
  assert.equal(result.action, 'scale_up');
});

test('非法副本容量抛出错误', () => {
  assert.throws(
    () => review({ replicaCapacity: 0 }),
    /replicaCapacity/,
  );
});
