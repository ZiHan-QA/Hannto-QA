(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HanntoQAResourceAccounting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPSILON = 0.001;
  const DEFAULT_DAILY_CAPACITY = 1;
  const DAILY_CUTOFF_HOUR = 23;
  const DAILY_CUTOFF_MINUTE = 59;

  function roundPoints(value) {
    return Math.round((Number(value) || 0) * 10000) / 10000;
  }

  function isDailyCutoffReached(now = new Date(), hour = DAILY_CUTOFF_HOUR, minute = DAILY_CUTOFF_MINUTE) {
    return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
  }

  function classifyCapacity(points, capacity = DEFAULT_DAILY_CAPACITY) {
    const actual = Math.max(0, Number(points) || 0);
    const limit = Math.max(0, Number(capacity) || 0);
    if (actual > limit + EPSILON) return 'over';
    if (actual < limit - EPSILON) return 'under';
    return 'normal';
  }

  /**
   * Fill cumulative actual points into the earliest eligible workday first.
   * Standard actual is capped by the member's capacity on each day. Any points
   * that cannot fit are returned as overflow and must not silently become
   * standard capacity.
   */
  function allocateActualPoints(options) {
    const totalPoints = Math.max(0, Number(options?.totalPoints) || 0);
    const dates = [...(options?.dates || [])];
    const capacityByDate = options?.capacityByDate || {};
    const existingByDate = options?.existingByDate || {};
    let remaining = totalPoints;
    const standardByDate = {};

    for (const date of dates) {
      if (remaining <= EPSILON) break;
      const capacity = Math.max(0, Number(capacityByDate[date] ?? DEFAULT_DAILY_CAPACITY) || 0);
      const occupied = Math.max(0, Number(existingByDate[date]) || 0);
      const available = Math.max(0, capacity - occupied);
      const allocated = Math.min(remaining, available);
      if (allocated <= EPSILON) continue;
      standardByDate[date] = roundPoints(allocated);
      remaining = roundPoints(remaining - allocated);
    }

    return {
      standardByDate,
      standardTotal: roundPoints(totalPoints - remaining),
      overflowPoints: roundPoints(remaining),
    };
  }

  /**
   * Roll unfinished effort to later workdays. Carryover starts only after the
   * source deadline has passed the daily cutoff; it skips dates that are not
   * supplied by the canonical work calendar.
   */
  function allocateCarryover(options) {
    if (!options?.cutoffReached || options?.completed || options?.waived) return {};
    let remaining = Math.max(0, Number(options.remainingPoints) || 0);
    const result = {};
    for (const date of options.workDates || []) {
      if (remaining <= EPSILON) break;
      const capacity = Math.max(0, Number(options.capacityByDate?.[date] ?? DEFAULT_DAILY_CAPACITY) || 0);
      const scheduled = Math.max(0, Number(options.scheduledByDate?.[date]) || 0);
      const available = Math.max(0, capacity - scheduled);
      const allocated = Math.min(remaining, available || capacity);
      if (allocated <= EPSILON) continue;
      result[date] = roundPoints(allocated);
      remaining = roundPoints(remaining - allocated);
    }
    return result;
  }

  function splitStandardAndOverflow(rawPoints, capacity = DEFAULT_DAILY_CAPACITY) {
    const raw = Math.max(0, Number(rawPoints) || 0);
    const limit = Math.max(0, Number(capacity) || 0);
    return {
      standardPoints: roundPoints(Math.min(raw, limit)),
      overflowPoints: roundPoints(Math.max(0, raw - limit)),
    };
  }

  return Object.freeze({
    EPSILON,
    DEFAULT_DAILY_CAPACITY,
    DAILY_CUTOFF_HOUR,
    DAILY_CUTOFF_MINUTE,
    roundPoints,
    isDailyCutoffReached,
    classifyCapacity,
    allocateActualPoints,
    allocateCarryover,
    splitStandardAndOverflow,
  });
});
