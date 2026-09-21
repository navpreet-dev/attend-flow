/**
 * Pure, deterministic mathematical utilities for attendance recovery and scenario simulations.
 * These functions have zero dependencies on external services or network calls.
 */

export interface RecoveryResult {
  currentAttended: number;
  currentTotal: number;
  currentPercentage: number;
  targetPercentage: number;
  /** Minimum consecutive attended classes required to reach target */
  classesNeeded: number;
  /** Resulting percentage if the required classes are attended */
  projectedPercentage: number;
  status:
    | "ALREADY_ABOVE"
    | "RECOVERABLE"
    | "IMPOSSIBLE_REMAINING_LIMIT"
    | "IMPOSSIBLE_TARGET"
    | "NO_CLASSES";
  /** If a remaining classes limit was provided */
  remainingLimit?: number;
  /** Maximum possible percentage if all remaining classes are attended */
  maxPossiblePercentage?: number;
  /** Student-friendly explanatory message */
  message: string;
}

export interface SimulationResult {
  initialAttended: number;
  initialTotal: number;
  initialPercentage: number;
  attendMore: number;
  bunkMore: number;
  projectedAttended: number;
  projectedTotal: number;
  projectedPercentage: number;
  deltaPercentage: number;
  targetPercentage: number;
  isAboveTarget: boolean;
  safeBunksRemaining: number;
  mustAttendRemaining: number;
  summaryText: string;
}

/**
 * Calculates exact consecutive classes required to reach a target percentage.
 *
 * Formula:
 * Let A = attended, T = total, R = consecutive future attended classes, P = target / 100.
 * (A + R) / (T + R) >= P
 * A + R >= P * T + P * R
 * R * (1 - P) >= P * T - A
 * R >= (P * T - A) / (1 - P)
 * R = Math.ceil((target * T - 100 * A) / (100 - target))
 */
export function calculateRecovery(
  attended: number,
  total: number,
  targetPercentage: number,
  remainingClasses?: number
): RecoveryResult {
  const safeAttended = Math.max(0, Math.floor(attended || 0));
  const safeTotal = Math.max(safeAttended, Math.floor(total || 0));
  const safeTarget = Math.min(100, Math.max(0, targetPercentage || 0));

  const currentPct =
    safeTotal > 0
      ? Math.round((safeAttended / safeTotal) * 10000) / 100
      : 0;

  if (safeTotal === 0) {
    return {
      currentAttended: 0,
      currentTotal: 0,
      currentPercentage: 0,
      targetPercentage: safeTarget,
      classesNeeded: safeTarget > 0 ? 1 : 0,
      projectedPercentage: safeTarget > 0 ? 100 : 0,
      status: "NO_CLASSES",
      message: "No classes have been recorded for this subject yet.",
    };
  }

  // Already above or equal to target
  if (currentPct >= safeTarget) {
    return {
      currentAttended: safeAttended,
      currentTotal: safeTotal,
      currentPercentage: currentPct,
      targetPercentage: safeTarget,
      classesNeeded: 0,
      projectedPercentage: currentPct,
      status: "ALREADY_ABOVE",
      remainingLimit: remainingClasses,
      message: `Your attendance is already at or above your ${safeTarget}% target.`,
    };
  }

  // Target 100% when already missed at least 1 class is mathematically impossible
  if (safeTarget >= 100) {
    if (safeAttended < safeTotal) {
      return {
        currentAttended: safeAttended,
        currentTotal: safeTotal,
        currentPercentage: currentPct,
        targetPercentage: 100,
        classesNeeded: Number.POSITIVE_INFINITY,
        projectedPercentage: currentPct,
        status: "IMPOSSIBLE_TARGET",
        remainingLimit: remainingClasses,
        message: "A 100% attendance is mathematically impossible because at least 1 class has already been missed.",
      };
    }
  }

  // Calculate required consecutive classes R
  const numerator = safeTarget * safeTotal - 100 * safeAttended;
  const denominator = 100 - safeTarget;
  const needed = Math.max(0, Math.ceil(numerator / denominator));

  const newAttended = safeAttended + needed;
  const newTotal = safeTotal + needed;
  const projectedPct =
    newTotal > 0
      ? Math.round((newAttended / newTotal) * 10000) / 100
      : 0;

  // Check against optional remaining classes limit
  if (typeof remainingClasses === "number" && remainingClasses >= 0) {
    const limit = Math.floor(remainingClasses);
    const maxAttended = safeAttended + limit;
    const maxTotal = safeTotal + limit;
    const maxPossiblePct =
      maxTotal > 0
        ? Math.round((maxAttended / maxTotal) * 10000) / 100
        : 0;

    if (needed > limit) {
      return {
        currentAttended: safeAttended,
        currentTotal: safeTotal,
        currentPercentage: currentPct,
        targetPercentage: safeTarget,
        classesNeeded: needed,
        projectedPercentage: projectedPct,
        status: "IMPOSSIBLE_REMAINING_LIMIT",
        remainingLimit: limit,
        maxPossiblePercentage: maxPossiblePct,
        message: `Even with 100% attendance in the ${limit} remaining class${limit === 1 ? "" : "es"}, the maximum reachable attendance is ${maxPossiblePct.toFixed(1)}% (need ${needed} classes for ${safeTarget}%).`,
      };
    }

    return {
      currentAttended: safeAttended,
      currentTotal: safeTotal,
      currentPercentage: currentPct,
      targetPercentage: safeTarget,
      classesNeeded: needed,
      projectedPercentage: projectedPct,
      status: "RECOVERABLE",
      remainingLimit: limit,
      maxPossiblePercentage: maxPossiblePct,
      message: `You need to attend the next ${needed} class${needed === 1 ? "" : "es"} in a row (out of ${limit} remaining) to reach ${safeTarget}%.`,
    };
  }

  return {
    currentAttended: safeAttended,
    currentTotal: safeTotal,
    currentPercentage: currentPct,
    targetPercentage: safeTarget,
    classesNeeded: needed,
    projectedPercentage: projectedPct,
    status: "RECOVERABLE",
    message: `You need to attend the next ${needed} class${needed === 1 ? "" : "es"} in a row without missing one to reach ${safeTarget}%.`,
  };
}

/**
 * Calculates attendance outcome under hypothetical future scenarios (attend X, bunk Y).
 */
export function simulateAttendance(
  attended: number,
  total: number,
  attendMore: number,
  bunkMore: number,
  targetPercentage: number
): SimulationResult {
  const safeAttended = Math.max(0, Math.floor(attended || 0));
  const safeTotal = Math.max(safeAttended, Math.floor(total || 0));
  const safeAttendMore = Math.max(0, Math.floor(attendMore || 0));
  const safeBunkMore = Math.max(0, Math.floor(bunkMore || 0));
  const safeTarget = Math.min(100, Math.max(0, targetPercentage || 0));

  const initialPct =
    safeTotal > 0
      ? Math.round((safeAttended / safeTotal) * 10000) / 100
      : 0;

  const projAttended = safeAttended + safeAttendMore;
  const projTotal = safeTotal + safeAttendMore + safeBunkMore;
  const projPct =
    projTotal > 0
      ? Math.round((projAttended / projTotal) * 10000) / 100
      : 0;

  const delta = Math.round((projPct - initialPct) * 100) / 100;
  const isAbove = projPct >= safeTarget;

  // Safe bunks remaining under the new projected state
  let safeBunks = 0;
  if (safeTarget > 0 && projPct >= safeTarget) {
    safeBunks = Math.max(
      0,
      Math.floor((100 * projAttended - safeTarget * projTotal) / safeTarget)
    );
  }

  // Must attend classes needed if new projected state is below target
  let mustAttendCount = 0;
  if (projPct < safeTarget && safeTarget < 100) {
    const num = safeTarget * projTotal - 100 * projAttended;
    const den = 100 - safeTarget;
    mustAttendCount = Math.max(0, Math.ceil(num / den));
  }

  let summaryText = "";
  if (safeAttendMore === 0 && safeBunkMore === 0) {
    summaryText = `Current standing: ${initialPct.toFixed(1)}% (${safeAttended}/${safeTotal}).`;
  } else if (safeAttendMore > 0 && safeBunkMore === 0) {
    summaryText = `Attending ${safeAttendMore} class${safeAttendMore === 1 ? "" : "es"} increases attendance by +${delta.toFixed(1)}% to ${projPct.toFixed(1)}%.`;
  } else if (safeAttendMore === 0 && safeBunkMore > 0) {
    summaryText = `Bunking ${safeBunkMore} class${safeBunkMore === 1 ? "" : "es"} drops attendance by ${delta.toFixed(1)}% to ${projPct.toFixed(1)}%.`;
  } else {
    summaryText = `Attending ${safeAttendMore} and bunking ${safeBunkMore} results in ${projPct.toFixed(1)}% (${delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}%).`;
  }

  return {
    initialAttended: safeAttended,
    initialTotal: safeTotal,
    initialPercentage: initialPct,
    attendMore: safeAttendMore,
    bunkMore: safeBunkMore,
    projectedAttended: projAttended,
    projectedTotal: projTotal,
    projectedPercentage: projPct,
    deltaPercentage: delta,
    targetPercentage: safeTarget,
    isAboveTarget: isAbove,
    safeBunksRemaining: safeBunks,
    mustAttendRemaining: mustAttendCount,
    summaryText,
  };
}

export interface RecoveryDateResult {
  reachable: boolean;
  recoveryDate?: string; // YYYY-MM-DD
  formattedDate?: string; // e.g. "Thu, 15 Oct 2026"
  dayName?: string;
  classesNeeded: number;
  classesRemaining: number;
  message: string;
}

/**
 * Predicts the exact calendar date a student will reach their target percentage
 * based on their consecutive future scheduled class dates.
 */
export function calculateRecoveryDate(
  classesNeeded: number,
  upcomingClasses: { date: string; dayOfWeek?: number }[]
): RecoveryDateResult {
  const needed = Math.max(0, Math.floor(classesNeeded || 0));
  const remaining = upcomingClasses.length;

  if (needed === 0) {
    return {
      reachable: true,
      classesNeeded: 0,
      classesRemaining: remaining,
      message: "Attendance is already at or above target.",
    };
  }

  if (remaining < needed) {
    return {
      reachable: false,
      classesNeeded: needed,
      classesRemaining: remaining,
      message: `Need ${needed} classes, but only ${remaining} scheduled class${remaining === 1 ? "" : "es"} remain in the semester.`,
    };
  }

  const targetClass = upcomingClasses[needed - 1];
  if (!targetClass || !targetClass.date) {
    return {
      reachable: false,
      classesNeeded: needed,
      classesRemaining: remaining,
      message: "Unable to determine recovery date from schedule.",
    };
  }

  const parts = targetClass.date.split("-").map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const formatted = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long" });

  return {
    reachable: true,
    recoveryDate: targetClass.date,
    formattedDate: formatted,
    dayName,
    classesNeeded: needed,
    classesRemaining: remaining,
    message: `Attend all next ${needed} classes to reach target on ${formatted}.`,
  };
}

export interface SemesterProjectionResult {
  currentAttended: number;
  currentTotal: number;
  currentPercentage: number;
  scheduledRemaining: number;
  semesterTotalClasses: number;
  bunksPlanned: number;
  projectedAttended: number;
  projectedPercentage: number;
  maxPossiblePercentage: number;
  safeBunksTotal: number;
  targetPercentage: number;
  isAboveTarget: boolean;
  message: string;
}

/**
 * Calculates projected attendance at semester end given planned bunks in remaining classes.
 */
export function simulateSemesterProjection(
  attended: number,
  total: number,
  scheduledRemaining: number,
  bunksPlanned: number,
  targetPercentage: number
): SemesterProjectionResult {
  const safeAttended = Math.max(0, Math.floor(attended || 0));
  const safeTotal = Math.max(safeAttended, Math.floor(total || 0));
  const safeRemaining = Math.max(0, Math.floor(scheduledRemaining || 0));
  const safeBunks = Math.min(safeRemaining, Math.max(0, Math.floor(bunksPlanned || 0)));
  const safeTarget = Math.min(100, Math.max(0, targetPercentage || 0));

  const currentPct =
    safeTotal > 0 ? Math.round((safeAttended / safeTotal) * 10000) / 100 : 0;

  const semesterTotal = safeTotal + safeRemaining;
  const maxPossibleAttended = safeAttended + safeRemaining;
  const maxPossiblePct =
    semesterTotal > 0
      ? Math.round((maxPossibleAttended / semesterTotal) * 10000) / 100
      : 0;

  // Maximum safe bunks across the entire remaining semester
  let safeBunksTotal = 0;
  if (semesterTotal > 0) {
    const minAttendedForTarget = Math.ceil((safeTarget * semesterTotal) / 100);
    safeBunksTotal = Math.max(
      0,
      Math.min(safeRemaining, maxPossibleAttended - minAttendedForTarget)
    );
  }

  // Projected with planned bunks
  const projAttended = safeAttended + (safeRemaining - safeBunks);
  const projPct =
    semesterTotal > 0
      ? Math.round((projAttended / semesterTotal) * 10000) / 100
      : 0;

  const isAbove = projPct >= safeTarget;

  let message = "";
  if (safeBunks === 0) {
    message = `Attending all ${safeRemaining} remaining classes yields a final ${projPct.toFixed(1)}% at semester end.`;
  } else {
    message = `Bunking ${safeBunks} of ${safeRemaining} remaining classes leaves you with ${projPct.toFixed(1)}% (${isAbove ? "Above" : "Below"} ${safeTarget}% target).`;
  }

  return {
    currentAttended: safeAttended,
    currentTotal: safeTotal,
    currentPercentage: currentPct,
    scheduledRemaining: safeRemaining,
    semesterTotalClasses: semesterTotal,
    bunksPlanned: safeBunks,
    projectedAttended: projAttended,
    projectedPercentage: projPct,
    maxPossiblePercentage: maxPossiblePct,
    safeBunksTotal,
    targetPercentage: safeTarget,
    isAboveTarget: isAbove,
    message,
  };
}

