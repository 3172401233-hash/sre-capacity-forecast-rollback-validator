import { buildBaseline, summarize } from './baseline.js';

function interval(point, errorMargin) {
  return {
    point,
    lower: point * (1 - errorMargin),
    upper: point * (1 + errorMargin),
  };
}

export function buildForecast({
  samples,
  anomalyWindows = [],
  errorMargin,
  horizonMs,
  now,
}) {
  const { stats, normalSamples, excludedSamples } = buildBaseline(
    samples,
    anomalyWindows,
  );
  const naiveStats = summarize(samples);
  const horizon = { start: now, end: now + horizonMs };
  const overlappingWindows = anomalyWindows.filter(
    (window) => window.start < horizon.end && window.end > horizon.start,
  );
  return {
    forecast: {
      horizon,
      errorMargin,
      ...interval(stats.mean, errorMargin),
      baselineStats: stats,
      contaminated: overlappingWindows.length > 0,
      overlappingWindows,
      excludedCount: excludedSamples.length,
      normalSampleCount: normalSamples.length,
    },
    naiveForecast: {
      ...interval(naiveStats.mean, errorMargin),
      stats: naiveStats,
    },
  };
}
