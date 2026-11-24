import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildForecast } from '../src/forecast.js';
import { evaluateRollback } from '../src/rollback.js';

const samples = [
  { t: 100, v: 100 },
  { t: 200, v: 104 },
  { t: 300, v: 96 },
  { t: 400, v: 500 },
  { t: 500, v: 480 },
];

const anomalyWindows = [{ start: 350, end: 550, reason: 'incident' }];

function buildCleanForecast(overrides = {}) {
  const { forecast } = buildForecast({
    samples,
    anomalyWindows,
    errorMargin: 0.1,
    horizonMs: 1000,
    now: 600,
    ...overrides,
  });
  return forecast;
}

function rollback(overrides = {}) {
  const forecast = overrides.forecast ?? buildCleanForecast();
  return evaluateRollback({
    scaledUpAt: 0,
    now: 100,
    cooldownMs: 300,
    scaleDownLatencyMs: 50,
    currentReplicas: 8,
    baselineReplicas: 4,
    forecast,
    anomalyWindows: [],
    replicaCapacity: 30,
    targetUtilization: 1,
    costPerReplicaPerHour: 2,
    batchJobs: [],
    ...overrides,
  });
}

test('冷却期未结束时禁止回滚并给出最早时间', () => {
  const result = rollback({ now: 100, cooldownMs: 300, scaledUpAt: 0 });
  assert.equal(result.canRollbackNow, false);
  assert.equal(result.eligible, false);
  assert.equal(result.cooldownRemainingMs, 200);
  assert.equal(result.earliestEligibleAt, 300);
  assert.equal(result.expectedCompletedAt, 350);
  assert.ok(result.blockingReasons.includes('cooldown_active'));
});

test('冷却期结束且无批任务时可立即回滚', () => {
  const result = rollback({ now: 300, cooldownMs: 300, scaledUpAt: 0 });
  assert.equal(result.canRollbackNow, true);
  assert.equal(result.eligible, true);
  assert.equal(result.earliestEligibleAt, 300);
  assert.equal(result.expectedCompletedAt, 350);
  assert.deepEqual(result.blockingReasons, []);
});

test('仍在运行的批任务会推迟回滚窗口', () => {
  const result = rollback({
    now: 400,
    cooldownMs: 300,
    scaledUpAt: 0,
    batchJobs: [
      { id: 'etl', endsAt: 600 },
      { id: 'export', endsAt: 500 },
    ],
  });
  assert.equal(result.canRollbackNow, false);
  assert.ok(result.blockingReasons.includes('batch_jobs_running'));
  assert.equal(result.earliestEligibleAt, 600);
  assert.deepEqual(
    result.batchJobBlockers.map((job) => job.id),
    ['export', 'etl'],
  );
});

test('已结束的批任务不再阻塞回滚', () => {
  const result = rollback({
    now: 700,
    cooldownMs: 300,
    scaledUpAt: 0,
    batchJobs: [{ id: 'finished-etl', endsAt: 600 }],
  });
  assert.equal(result.canRollbackNow, true);
  assert.equal(result.batchJobBlockers.length, 0);
});

test('预测上限超过基线容量时回滚不安全，不给出窗口（低基线容量）', () => {
  const result = rollback({
    now: 400,
    cooldownMs: 300,
    scaledUpAt: 0,
    baselineReplicas: 4,
    replicaCapacity: 20,
  });
  assert.equal(result.capacitySafe, false);
  assert.equal(result.eligible, false);
  assert.equal(result.earliestEligibleAt, null);
  assert.equal(result.expectedCompletedAt, null);
  assert.ok(
    result.blockingReasons.includes('forecast_unsafe_for_baseline_capacity'),
  );
});

test('回滚完成时刻落入事故窗口时判定不安全', () => {
  const forecast = buildCleanForecast();
  const result = rollback({
    forecast,
    anomalyWindows: [{ start: 340, end: 360 }],
    now: 300,
    cooldownMs: 300,
    scaledUpAt: 0,
    scaleDownLatencyMs: 50,
  });
  assert.equal(result.capacitySafe, false);
  assert.equal(result.earliestEligibleAt, null);
});

test('回滚窗口考虑批任务与冷却期的较大值并估算节省成本', () => {
  const result = rollback({
    now: 100,
    cooldownMs: 300,
    scaledUpAt: 0,
    replicaCapacity: 30,
    batchJobs: [{ id: 'etl', endsAt: 800 }],
  });
  assert.equal(result.earliestEligibleAt, 800);
  assert.equal(result.expectedCompletedAt, 850);
  assert.equal(result.hourlySavingsEstimate, 8);
});

test('当前副本已等于基线副本时无需回滚', () => {
  const result = rollback({
    currentReplicas: 4,
    baselineReplicas: 4,
    now: 100,
  });
  assert.equal(result.canRollbackNow, true);
  assert.equal(result.eligible, true);
  assert.equal(result.hourlySavingsEstimate, 0);
});
