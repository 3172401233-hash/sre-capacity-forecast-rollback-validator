import { isInAnomalyWindow } from './baseline.js';

export function evaluateRollback(input) {
  const {
    scaledUpAt,
    now,
    cooldownMs,
    scaleDownLatencyMs,
    currentReplicas,
    baselineReplicas,
    forecast,
    anomalyWindows = [],
    replicaCapacity,
    targetUtilization = 1,
    batchJobs = [],
  } = input;

  if (currentReplicas <= baselineReplicas) {
    return {
      eligible: true,
      canRollbackNow: true,
      earliestEligibleAt: now,
      expectedCompletedAt: now + scaleDownLatencyMs,
      blockingReasons: [],
      batchJobBlockers: [],
      capacitySafe: true,
      cooldownRemainingMs: 0,
      hourlySavingsEstimate: 0,
    };
  }

  const cooldownEndsAt = scaledUpAt + cooldownMs;
  const cooldownRemainingMs = Math.max(0, cooldownEndsAt - now);

  const activeJobs = batchJobs
    .filter((job) => now < job.endsAt)
    .map((job) => ({
      id: job.id,
      endsAt: job.endsAt,
      waitingMs: Math.max(0, job.endsAt - now),
    }))
    .sort((a, b) => a.endsAt - b.endsAt);

  const lastBatchEndsAt = activeJobs.length
    ? activeJobs[activeJobs.length - 1].endsAt
    : now;

  const candidates = [cooldownEndsAt, lastBatchEndsAt];
  let earliestEligibleAt = Math.max(...candidates);

  const blockingReasons = [];
  if (now < cooldownEndsAt) {
    blockingReasons.push('cooldown_active');
  }
  if (activeJobs.length > 0) {
    blockingReasons.push('batch_jobs_running');
  }

  const effectiveCapacity = replicaCapacity * targetUtilization;
  const safeLoad = baselineReplicas * effectiveCapacity;
  const rollbackForecastTime = earliestEligibleAt + scaleDownLatencyMs;
  const anomalyAtRollback = isInAnomalyWindow(
    rollbackForecastTime,
    anomalyWindows,
  );
  const capacitySafe = forecast.upper <= safeLoad && !anomalyAtRollback;

  if (!capacitySafe) {
    blockingReasons.push('forecast_unsafe_for_baseline_capacity');
    earliestEligibleAt = null;
  }

  const canRollbackNow =
    capacitySafe &&
    now >= cooldownEndsAt &&
    activeJobs.length === 0;

  const removedReplicas = currentReplicas - baselineReplicas;

  return {
    eligible: capacitySafe && blockingReasons.length === 0,
    canRollbackNow,
    earliestEligibleAt,
    expectedCompletedAt:
      earliestEligibleAt === null
        ? null
        : earliestEligibleAt + scaleDownLatencyMs,
    blockingReasons,
    batchJobBlockers: activeJobs,
    capacitySafe,
    safeLoadUpperBound: safeLoad,
    cooldownRemainingMs,
    scaleDownLatencyMs,
    hourlySavingsEstimate: estimateSavings(
      removedReplicas,
      input.costPerReplicaPerHour,
    ),
  };
}

function estimateSavings(removedReplicas, costPerReplicaPerHour = 0) {
  return removedReplicas * costPerReplicaPerHour;
}
