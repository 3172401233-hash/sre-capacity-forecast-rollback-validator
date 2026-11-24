export const MS_PER_HOUR = 3_600_000;

export function isInAnomalyWindow(time, anomalyWindows) {
  return anomalyWindows.some(({ start, end }) => time >= start && time < end);
}

export function splitByAnomalies(samples, anomalyWindows = []) {
  const normalSamples = [];
  const excludedSamples = [];
  for (const sample of samples) {
    if (isInAnomalyWindow(sample.t, anomalyWindows)) {
      excludedSamples.push(sample);
    } else {
      normalSamples.push(sample);
    }
  }
  return { normalSamples, excludedSamples };
}

export function summarize(samples) {
  const count = samples.length;
  if (count === 0) {
    return { count: 0, mean: 0, max: 0, min: 0, stddev: 0 };
  }
  const values = samples.map((sample) => sample.v);
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  return {
    count,
    mean,
    max: Math.max(...values),
    min: Math.min(...values),
    stddev: Math.sqrt(variance),
  };
}

export function buildBaseline(samples, anomalyWindows = []) {
  const { normalSamples, excludedSamples } = splitByAnomalies(
    samples,
    anomalyWindows,
  );
  return {
    stats: summarize(normalSamples),
    normalSamples,
    excludedSamples,
  };
}
