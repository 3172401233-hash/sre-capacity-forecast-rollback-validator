import { buildForecast } from './forecast.js';
import { evaluateScaling } from './scaling.js';
import { evaluateRollback } from './rollback.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`输入校验失败: ${message}`);
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateScenario(input) {
  assert(input && typeof input === 'object', '需要一个场景对象');
  assert(Array.isArray(input.samples) && input.samples.length > 0,
    'samples 必须是非空数组');
  for (const sample of input.samples) {
    assert(isFiniteNumber(sample.t) && isFiniteNumber(sample.v),
      '每个 sample 必须包含数值字段 t 与 v');
  }
  assert(isFiniteNumber(input.now), 'now 必须是数值时间戳');
  assert(isFiniteNumber(input.horizonMs) && input.horizonMs > 0,
    'horizonMs 必须是正数');
  assert(isFiniteNumber(input.errorMargin) &&
    input.errorMargin >= 0 && input.errorMargin < 1,
    'errorMargin 必须位于 [0, 1)');
  assert(isFiniteNumber(input.errorThreshold) &&
    input.errorThreshold >= 0 && input.errorThreshold < 1,
    'errorThreshold 必须位于 [0, 1)');
  assert(Number.isInteger(input.currentReplicas) &&
    input.currentReplicas >= 1,
    'currentReplicas 必须是 >= 1 的整数');
  assert(isFiniteNumber(input.replicaCapacity) &&
    input.replicaCapacity > 0,
    'replicaCapacity 必须是正数');
  assert(input.targetUtilization === undefined ||
    (isFiniteNumber(input.targetUtilization) &&
      input.targetUtilization > 0 &&
      input.targetUtilization <= 1),
    'targetUtilization 必须位于 (0, 1]');
  assert(isFiniteNumber(input.costPerReplicaPerHour) &&
    input.costPerReplicaPerHour >= 0,
    'costPerReplicaPerHour 必须是非负数');

  const anomalyWindows = input.anomalyWindows ?? [];
  assert(Array.isArray(anomalyWindows), 'anomalyWindows 必须是数组');
  for (const window of anomalyWindows) {
    assert(isFiniteNumber(window.start) && isFiniteNumber(window.end) &&
      window.end > window.start,
      '每个异常窗口必须满足 end > start');
  }

  if (input.rollback !== undefined) {
    const rollback = input.rollback;
    assert(isFiniteNumber(rollback.scaledUpAt) &&
      rollback.scaledUpAt <= input.now,
      'rollback.scaledUpAt 必须是不晚于 now 的时间戳');
    assert(isFiniteNumber(rollback.cooldownMs) && rollback.cooldownMs >= 0,
      'rollback.cooldownMs 必须是非负数');
    assert(isFiniteNumber(rollback.scaleDownLatencyMs) &&
      rollback.scaleDownLatencyMs >= 0,
      'rollback.scaleDownLatencyMs 必须是非负数');
    assert(Number.isInteger(rollback.baselineReplicas) &&
      rollback.baselineReplicas >= 1 &&
      rollback.baselineReplicas <= input.currentReplicas,
      'rollback.baselineReplicas 必须是 1 到 currentReplicas 之间的整数');
    const batchJobs = rollback.batchJobs ?? [];
    assert(Array.isArray(batchJobs), 'rollback.batchJobs 必须是数组');
    for (const job of batchJobs) {
      assert(typeof job.id === 'string' && job.id.length > 0,
        '每个批任务必须包含字符串 id');
      assert(isFiniteNumber(job.endsAt),
        '每个批任务必须包含数值 endsAt');
    }
  }
}

export function runCapacityReview(input) {
  validateScenario(input);

  const { forecast, naiveForecast } = buildForecast({
    samples: input.samples,
    anomalyWindows: input.anomalyWindows ?? [],
    errorMargin: input.errorMargin,
    horizonMs: input.horizonMs,
    now: input.now,
  });

  const scaling = evaluateScaling({
    currentReplicas: input.currentReplicas,
    replicaCapacity: input.replicaCapacity,
    targetUtilization: input.targetUtilization ?? 1,
    costPerReplicaPerHour: input.costPerReplicaPerHour,
    forecast,
    naiveForecast,
    errorThreshold: input.errorThreshold,
  });

  let rollback = null;
  if (input.rollback !== undefined) {
    rollback = evaluateRollback({
      ...input.rollback,
      now: input.now,
      currentReplicas: input.currentReplicas,
      forecast,
      anomalyWindows: input.anomalyWindows ?? [],
      replicaCapacity: input.replicaCapacity,
      targetUtilization: input.targetUtilization ?? 1,
      costPerReplicaPerHour: input.costPerReplicaPerHour,
    });
  }

  return {
    forecast,
    naiveForecast,
    scaling,
    rollback,
  };
}
