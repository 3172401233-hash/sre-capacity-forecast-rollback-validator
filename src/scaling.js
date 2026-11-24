function requiredReplicas(load, replicaCapacity, targetUtilization = 1) {
  if (replicaCapacity <= 0 || targetUtilization <= 0) {
    throw new Error('replicaCapacity 与 targetUtilization 必须为正数');
  }
  const effectiveCapacity = replicaCapacity * targetUtilization;
  return Math.max(1, Math.ceil(load / effectiveCapacity));
}

function hourlyCost(replicas, costPerReplicaPerHour) {
  return replicas * costPerReplicaPerHour;
}

export function evaluateScaling(input) {
  const {
    currentReplicas,
    replicaCapacity,
    targetUtilization = 1,
    costPerReplicaPerHour,
    forecast,
    naiveForecast,
    errorThreshold,
  } = input;

  const errorTooHigh = forecast.errorMargin > errorThreshold;
  const contaminated = forecast.contaminated;
  const untrusted = contaminated || errorTooHigh;

  const pointReplicas = requiredReplicas(
    forecast.point,
    replicaCapacity,
    targetUtilization,
  );
  const upperReplicas = requiredReplicas(
    forecast.upper,
    replicaCapacity,
    targetUtilization,
  );
  const naiveReplicas = requiredReplicas(
    naiveForecast.point,
    replicaCapacity,
    targetUtilization,
  );

  const recommendedReplicas = untrusted
    ? currentReplicas
    : Math.max(currentReplicas, upperReplicas);

  let action;
  if (untrusted) {
    action = 'hold';
  } else if (recommendedReplicas > currentReplicas) {
    action = 'scale_up';
  } else {
    action = 'none';
  }

  const reasons = [];
  if (contaminated) {
    reasons.push('forecast_window_overlaps_incident');
  }
  if (errorTooHigh) {
    reasons.push('forecast_error_above_threshold');
  }
  if (!untrusted && pointReplicas <= currentReplicas) {
    reasons.push('current_capacity_sufficient');
  }

  const inflatedByIncident = naiveReplicas > upperReplicas;

  return {
    trusted: !untrusted,
    action,
    reasons,
    currentReplicas,
    recommendedReplicas,
    pointReplicas,
    upperReplicas,
    naiveReplicas,
    inflatedByIncident,
    costs: {
      currentPerHour: hourlyCost(
        currentReplicas,
        costPerReplicaPerHour,
      ),
      recommendedPerHour: hourlyCost(
        recommendedReplicas,
        costPerReplicaPerHour,
      ),
      rejectedNaivePerHour: hourlyCost(
        naiveReplicas,
        costPerReplicaPerHour,
      ),
      costPerReplicaPerHour,
    },
  };
}
