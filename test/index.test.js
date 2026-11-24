import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCapacityReview, validateScenario } from '../src/index.js';

const incidentSamples = [
  { t: 1000000, v: 100 },
  { t: 2000000, v: 105 },
  { t: 3000000, v: 98 },
  { t: 4000000, v: 102 },
  { t: 5000000, v: 104 },
  { t: 6000000, v: 101 },
  { t: 7000000, v: 99 },
  { t: 8000000, v: 480 },
  { t: 9000000, v: 520 },
];

const baseInput = {
  now: 10000000,
  samples: incidentSamples,
  anomalyWindows: [{ start: 7500000, end: 9200000 }],
  errorMargin: 0.1,
  errorThreshold: 0.2,
  horizonMs: 3600000,
  currentReplicas: 12,
  replicaCapacity: 25,
  targetUtilization: 0.8,
  costPerReplicaPerHour: 2,
};

test('端到端：事故峰值剔除后预测可信且无需继续扩容', () => {
  const result = runCapacityReview(baseInput);
  assert.equal(result.forecast.excludedCount, 2);
  assert.equal(result.forecast.normalSampleCount, 7);
  assert.equal(result.forecast.contaminated, false);
  assert.equal(result.scaling.trusted, true);
  assert.equal(result.scaling.action, 'none');
  assert.equal(result.scaling.recommendedReplicas, 12);
  assert.equal(result.scaling.inflatedByIncident, true);
  assert.ok(result.scaling.naiveReplicas > result.scaling.upperReplicas);
});

test('端到端：预测窗口包含事故流量时扩容建议不可信', () => {
  const result = runCapacityReview({
    ...baseInput,
    anomalyWindows: [{ start: 11000000, end: 12000000 }],
  });
  assert.equal(result.forecast.contaminated, true);
  assert.equal(result.scaling.trusted, false);
  assert.equal(result.scaling.action, 'hold');
  assert.ok(
    result.scaling.reasons.includes('forecast_window_overlaps_incident'),
  );
});

test('端到端：回滚受冷却期与批任务共同约束，窗口取较大值', () => {
  const result = runCapacityReview({
    ...baseInput,
    rollback: {
      scaledUpAt: 9400000,
      cooldownMs: 1800000,
      scaleDownLatencyMs: 300000,
      baselineReplicas: 6,
      batchJobs: [
        { id: 'nightly-etl', endsAt: 10500000 },
        { id: 'report-export', endsAt: 10200000 },
      ],
    },
  });
  assert.equal(result.rollback.canRollbackNow, false);
  assert.equal(result.rollback.eligible, false);
  assert.equal(result.rollback.capacitySafe, true);
  assert.equal(result.rollback.earliestEligibleAt, 11200000);
  assert.equal(result.rollback.expectedCompletedAt, 11500000);
  assert.equal(result.rollback.cooldownRemainingMs, 1200000);
  assert.deepEqual(
    result.rollback.blockingReasons,
    ['cooldown_active', 'batch_jobs_running'],
  );
  assert.equal(result.rollback.hourlySavingsEstimate, 12);
});

test('端到端：批任务结束且冷却到期后可回滚', () => {
  const result = runCapacityReview({
    ...baseInput,
    now: 11300000,
    rollback: {
      scaledUpAt: 9400000,
      cooldownMs: 1800000,
      scaleDownLatencyMs: 300000,
      baselineReplicas: 6,
      batchJobs: [{ id: 'nightly-etl', endsAt: 10500000 }],
    },
  });
  assert.equal(result.rollback.canRollbackNow, true);
  assert.equal(result.rollback.eligible, true);
  assert.equal(result.rollback.earliestEligibleAt, 11300000);
  assert.equal(result.rollback.expectedCompletedAt, 11600000);
});

test('端到端：回滚后基线容量无法承载预测上限时保持扩容态', () => {
  const result = runCapacityReview({
    ...baseInput,
    rollback: {
      scaledUpAt: 9400000,
      cooldownMs: 1800000,
      scaleDownLatencyMs: 300000,
      baselineReplicas: 4,
      batchJobs: [],
    },
  });
  assert.equal(result.rollback.capacitySafe, false);
  assert.equal(result.rollback.earliestEligibleAt, null);
  assert.ok(
    result.rollback.blockingReasons.includes(
      'forecast_unsafe_for_baseline_capacity',
    ),
  );
});

test('输入校验：缺字段、非法误差、非法副本均被拒绝', () => {
  assert.throws(() => validateScenario(null), /场景对象/);
  assert.throws(
    () => validateScenario({ ...baseInput, samples: [] }),
    /samples/,
  );
  assert.throws(
    () => validateScenario({ ...baseInput, errorMargin: 1.5 }),
    /errorMargin/,
  );
  assert.throws(
    () => validateScenario({ ...baseInput, currentReplicas: 0 }),
    /currentReplicas/,
  );
  assert.throws(
    () =>
      validateScenario({
        ...baseInput,
        anomalyWindows: [{ start: 100, end: 50 }],
      }),
    /异常窗口/,
  );
  assert.throws(
    () =>
      validateScenario({
        ...baseInput,
        rollback: {
          scaledUpAt: baseInput.now + 1,
          cooldownMs: 100,
          scaleDownLatencyMs: 100,
          baselineReplicas: 6,
        },
      }),
    /scaledUpAt/,
  );
});
