/**
 * Pure, deterministic academic planning and timetable mathematical engine.
 *
 * This module has ZERO dependencies on network, external services, or the portal.
 * It provides mathematical schedules, holiday exclusion, subject mapping,
 * and recovery intelligence based on student-configured calendars and timetables.
 */

import {
  calculateRemainingClasses,
  getKolkataDateParts,
  isLaboratorySubject,
  adaptLegacyTimetableEntries,
  type LabGroup,
  type EngineTimetableEntry,
  type DateIterationResult,
  type EngineSubjectAudit,
  type ScheduleException,
} from "./date-iteration-engine";

export {
  calculateRemainingClasses,
  getKolkataDateParts,
  isLaboratorySubject,
};

export type {
  LabGroup,
  EngineTimetableEntry,
  DateIterationResult,
  EngineSubjectAudit,
  ScheduleException,
};


// ---------------------------------------------------------------------------
// FALLBACK DEFAULTS
// These constants are used ONLY as a last-resort guard when the user has NOT
// yet configured an Academic Calendar in the Planner.
//
// ⚡ They are NEVER hardcoded into the date-iteration engine itself.
// ⚡ Once a student uploads their own calendar the engine uses their specific
//    startDate, endDate, workingDays, holidays, and timetableOffDays — making
//    these constants completely irrelevant for configured users.
//
// They are kept here purely so the API can return a graceful "teaching period
// not yet configured" response instead of crashing with no calendar present.
// ---------------------------------------------------------------------------

/** Semester teaching-cutoff fallback (used only if student has no calendar). */
export const DEFAULT_TEACHING_END_DATE = "2026-11-04";
export const TEACHING_END_DATE = DEFAULT_TEACHING_END_DATE;

/**
 * Fallback holidays shown on the Planner preview when no calendar is uploaded.
 * Holidays are otherwise stored per-student in the AcademicHoliday table and
 * automatically read from the student's uploaded academic calendar document.
 */
export const DEFAULT_OFFICIAL_HOLIDAYS = [
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Diwali
  "2026-10-29", // Diwali 2
];
export const OFFICIAL_HOLIDAYS = DEFAULT_OFFICIAL_HOLIDAYS;

/**
 * Fallback off-day numbers (1=Mon … 7=Sun) used when the student has not
 * uploaded a timetable. Overridden by timetableOffDays stored in the DB.
 */
export const NORMAL_DEPARTMENTAL_OFF_DAYS = [1, 6, 7];


export interface HolidayItem {
  id?: string;
  date: string; // YYYY-MM-DD
  name?: string | null;
}

export interface AcademicCalendarConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  teachingEndDate?: string; // YYYY-MM-DD
  workingDays: number[]; // 1 = Monday, 2 = Tuesday, ..., 7 = Sunday
  holidays: HolidayItem[];
  /**
   * Day-of-week numbers (1=Mon..7=Sun) that are ALWAYS off for this student's
   * section/department according to their uploaded timetable.
   * Example: [1] means Monday is a department leave even if the academic calendar
   * considers Monday a working day.
   * These are combined with (not a replacement for) calendar workingDays and holidays.
   */
  timetableOffDays?: number[];
  /** Student's laboratory group: "G1" | "G2" | "Unknown" */
  group?: LabGroup;
}

export interface TimetableEntryItem {
  id?: string;
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  subjectCode: string;
  subjectName: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  room?: string | null;
  teacher?: string | null;
  matchedSubjectCode?: string | null;
  batch?: string | null;
  labGroup?: "G1" | "G2" | "All" | null;
  isLab?: boolean;
}

export interface ScheduledClassInstance {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subjectCode: string;
  subjectName: string;
  matchedSubjectCode?: string | null;
  batch?: string | null;
  room?: string | null;
  teacher?: string | null;
  isPassed: boolean;
}

export interface SubjectScheduleMetrics {
  subjectCode: string;
  totalScheduled: number;
  scheduledPassed: number;
  scheduledRemaining: number;
  isGroupDivided?: boolean;
  labRemaining?: { G1: number; G2: number };
  remainingByGroup?: Record<string, number> | null;
  countedDates?: string[];
  nextClass: ScheduledClassInstance | null;
  upcomingThisWeek: ScheduledClassInstance[];
  upcomingThisMonth: ScheduledClassInstance[];
  semesterEndDate: string;
  teachingEndDate?: string;
}

export interface PlannerRecoveryInsight {
  currentAttended: number;
  currentTotal: number;
  currentPercentage: number;
  targetPercentage: number;
  classesNeeded: number;
  scheduledRemaining: number;
  isReachable: boolean;
  maxPossiblePercentage: number;
  safeBunksRemaining: number;
  status: "ALREADY_ABOVE" | "RECOVERABLE" | "IMPOSSIBLE" | "NO_CLASSES";
  message: string;
}

/**
 * Format a Date object to YYYY-MM-DD string in local time.
 */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parse YYYY-MM-DD string into a local midnight Date.
 */
export function parseDateString(str: string): Date {
  const parts = str.split("-").map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return new Date();
  }
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}

/**
 * Check if a date string falls on any configured holiday.
 */
export function isHoliday(dateStr: string, holidays: HolidayItem[]): boolean {
  return holidays.some((h) => h.date === dateStr);
}

/**
 * Normalizes JS day of week (0=Sun, 1=Mon, ..., 6=Sat) to standard 1=Mon ... 7=Sun.
 */
export function getStandardDayOfWeek(d: Date): number {
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

/**
 * Matches a timetable subject against an array of existing AttendFlow portal subjects.
 * Provides exact, normalized, or none match confidence.
 */
export function matchTimetableSubject(
  timetableName: string,
  availableSubjects: { subjectCode: string; subjectName: string }[]
): { matchedCode: string | null; confidence: "exact" | "normalized" | "none" } {
  const trimmed = timetableName.trim();
  if (!trimmed) return { matchedCode: null, confidence: "none" };

  // 1. Exact match on subjectCode or subjectName (case-insensitive)
  const exact = availableSubjects.find(
    (s) =>
      s.subjectCode.toLowerCase() === trimmed.toLowerCase() ||
      s.subjectName.toLowerCase() === trimmed.toLowerCase()
  );
  if (exact) {
    return { matchedCode: exact.subjectCode, confidence: "exact" };
  }

  // 2. Normalized alphanumeric match
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanTarget = clean(trimmed);
  if (cleanTarget) {
    const normalized = availableSubjects.find((s) => {
      const cCode = clean(s.subjectCode);
      const cName = clean(s.subjectName);
      return (
        cCode === cleanTarget ||
        cName === cleanTarget ||
        (cleanTarget.length >= 4 && (cName.includes(cleanTarget) || cleanTarget.includes(cName)))
      );
    });
    if (normalized) {
      return { matchedCode: normalized.subjectCode, confidence: "normalized" };
    }
  }

  return { matchedCode: null, confidence: "none" };
}

/**
 * Generates all scheduled class instances between calendar start and end dates.
 * Excludes non-working days and holidays.
 */
export function generateScheduledClasses(
  calendar: AcademicCalendarConfig,
  timetable: TimetableEntryItem[],
  asOf: Date = new Date(),
  selectedGroup?: LabGroup | string
): ScheduledClassInstance[] {
  if (!calendar.startDate || !calendar.endDate || timetable.length === 0) {
    return [];
  }

  const start = parseDateString(calendar.startDate);
  const end = parseDateString(calendar.endDate);

  if (start.getTime() > end.getTime()) {
    return [];
  }

  const workingDaysSet = new Set(
    calendar.workingDays && calendar.workingDays.length > 0
      ? calendar.workingDays
      : [1, 2, 3, 4, 5]
  );
  const holidaySet = new Set(calendar.holidays.map((h) => h.date));

  // Timetable-specific section/department off-days (e.g. Monday off for BCA-3B).
  // These override workingDays — even if Monday is a calendar working day,
  // if the timetable says Monday is off for this section it must be excluded.
  const timetableOffDaysSet = new Set<number>(calendar.timetableOffDays || []);

  // Dynamically adapt timetable entries so G1/G2 batches are resolved for parallel labs
  const adaptedTimetable = adaptLegacyTimetableEntries(
    timetable.map((t) => ({
      ...t,
      matchedSubjectCode: t.matchedSubjectCode || t.subjectCode,
      batch: t.batch || (t as any).labGroup || null,
      isLab: isLaboratorySubject(t),
    }))
  );

  // Map timetable by day of week for fast lookup
  const dayMap = new Map<number, TimetableEntryItem[]>();
  for (const entry of adaptedTimetable) {
    const list = dayMap.get(entry.dayOfWeek) || [];
    list.push(entry as TimetableEntryItem);
    dayMap.set(entry.dayOfWeek, list);
  }

  const instances: ScheduledClassInstance[] = [];
  const current = new Date(start);

  const asOfDateStr = toDateString(asOf);
  const asOfHours = String(asOf.getHours()).padStart(2, "0");
  const asOfMinutes = String(asOf.getMinutes()).padStart(2, "0");
  const asOfTimeStr = `${asOfHours}:${asOfMinutes}`;

  // Loop day by day through the semester period
  while (current.getTime() <= end.getTime()) {
    const dateStr = toDateString(current);
    const dayOfWeek = getStandardDayOfWeek(current);

    // Skip if non-working day, timetable-specific off-day, or academic calendar holiday
    if (workingDaysSet.has(dayOfWeek) && !timetableOffDaysSet.has(dayOfWeek) && !holidaySet.has(dateStr)) {
      const classesOnDay = dayMap.get(dayOfWeek) || [];
      for (const cls of classesOnDay) {
        // Filter by group if specific group requested
        if (selectedGroup && selectedGroup !== "Both" && selectedGroup !== "Unknown") {
          const clsGroup = (cls.batch || cls.labGroup || "").trim().toUpperCase();
          if (clsGroup && clsGroup !== selectedGroup.trim().toUpperCase()) {
            continue;
          }
        }

        // Determine whether this class has already passed
        let isPassed = false;
        if (dateStr < asOfDateStr) {
          isPassed = true;
        } else if (dateStr === asOfDateStr) {
          // If class end time is earlier than current time, it has passed
          const clsEndTime = cls.endTime || cls.startTime || "23:59";
          isPassed = clsEndTime <= asOfTimeStr;
        }

        instances.push({
          date: dateStr,
          dayOfWeek,
          startTime: cls.startTime,
          endTime: cls.endTime,
          subjectCode: cls.subjectCode,
          subjectName: cls.subjectName,
          matchedSubjectCode: cls.matchedSubjectCode || cls.subjectCode,
          room: cls.room,
          teacher: cls.teacher,
          isPassed,
        });
      }
    }

    // Next day
    current.setDate(current.getDate() + 1);
  }

  // Sort chronologically by date and start time
  return instances.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
}

/**
 * Calculates schedule metrics for a specific AttendFlow subject code.
 */
export function calculateSubjectScheduleMetrics(
  targetSubjectCode: string,
  calendar: AcademicCalendarConfig | null,
  timetable: TimetableEntryItem[],
  asOf: Date = new Date(),
  group: LabGroup = "Both"
): SubjectScheduleMetrics {
  if (!calendar) {
    return {
      subjectCode: targetSubjectCode,
      totalScheduled: 0,
      scheduledPassed: 0,
      scheduledRemaining: 0,
      isGroupDivided: false,
      nextClass: null,
      upcomingThisWeek: [],
      upcomingThisMonth: [],
      semesterEndDate: "",
      teachingEndDate: TEACHING_END_DATE,
    };
  }

  // Active group parameter from user selection takes precedence!
  const effectiveGroup =
    group && group !== "Both" && group !== "Unknown"
      ? group
      : calendar.group && calendar.group !== "Both" && calendar.group !== "Unknown"
      ? calendar.group
      : group || "Both";
  // Cap teaching end date at TEACHING_END_DATE (or calendar.teachingEndDate if specified)
  const effectiveTeachingEndDate =
    calendar.teachingEndDate ||
    (calendar.endDate && calendar.endDate < TEACHING_END_DATE
      ? calendar.endDate
      : TEACHING_END_DATE);

  const remainingResult = calculateRemainingClasses({
    now: asOf,
    timezone: "Asia/Kolkata",
    calendar: {
      startDate: calendar.startDate,
      teachingEndDate: effectiveTeachingEndDate,
      workingDays: calendar.workingDays,
      excludedDays: calendar.timetableOffDays,
      holidays: calendar.holidays,
    },
    timetable: timetable.map((t) => ({
      ...t,
      matchedSubjectCode: t.matchedSubjectCode || t.subjectCode,
      batch: t.batch || (t as any).labGroup || null,
      isLab: isLaboratorySubject(t),
    })),
    studentContext: {
      group: effectiveGroup,
    },
  });

  const subjectAudit =
    remainingResult.bySubject[targetSubjectCode] ||
    Object.values(remainingResult.bySubject).find(
      (s) => s.subjectName.toLowerCase() === targetSubjectCode.toLowerCase()
    );

  const allInstances = generateScheduledClasses(calendar, timetable, asOf, effectiveGroup);
  // Filter instances matching targetSubjectCode either by matchedSubjectCode or subjectCode
  const subjectInstances = allInstances.filter(
    (inst) =>
      inst.matchedSubjectCode === targetSubjectCode ||
      inst.subjectCode === targetSubjectCode
  );

  const passed = subjectInstances.filter((i) => i.isPassed);

  const remainingCount = subjectAudit
    ? subjectAudit.remainingClasses
    : subjectInstances.filter((i) => !i.isPassed).length;

  const asOfDateStr = toDateString(asOf);
  const asOfDate = parseDateString(asOfDateStr);

  // Next 7 days
  const sevenDaysLater = new Date(asOfDate);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const sevenDaysStr = toDateString(sevenDaysLater);

  // Next 30 days
  const thirtyDaysLater = new Date(asOfDate);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  const thirtyDaysStr = toDateString(thirtyDaysLater);

  const upcomingRemaining = subjectInstances.filter(
    (i) =>
      !i.isPassed &&
      i.date <= effectiveTeachingEndDate &&
      (subjectAudit ? subjectAudit.countedDates.includes(i.date) : true)
  );

  const upcomingThisWeek = upcomingRemaining.filter(
    (i) => i.date >= asOfDateStr && i.date <= sevenDaysStr
  );
  const upcomingThisMonth = upcomingRemaining.filter(
    (i) => i.date >= asOfDateStr && i.date <= thirtyDaysStr
  );

  const isGroupDivided = subjectAudit ? Boolean(subjectAudit.isGroupDivided) : false;

  return {
    subjectCode: targetSubjectCode,
    totalScheduled: passed.length + remainingCount,
    scheduledPassed: passed.length,
    scheduledRemaining: remainingCount,
    isGroupDivided,
    labRemaining:
      isGroupDivided && subjectAudit && subjectAudit.remainingByGroup
        ? {
            G1: subjectAudit.remainingByGroup["G1"] ?? 0,
            G2: subjectAudit.remainingByGroup["G2"] ?? 0,
          }
        : undefined,
    remainingByGroup:
      isGroupDivided && subjectAudit ? subjectAudit.remainingByGroup : null,
    countedDates: subjectAudit?.countedDates,
    nextClass: upcomingRemaining[0] || null,
    upcomingThisWeek,
    upcomingThisMonth,
    semesterEndDate: calendar.endDate,
    teachingEndDate: effectiveTeachingEndDate,
  };
}

/**
 * Recovery insight calculation combining current attendance with future scheduled classes.
 */
export function calculatePlannerRecovery(params: {
  attended: number;
  total: number;
  targetPercentage: number;
  scheduledRemaining: number;
}): PlannerRecoveryInsight {
  const safeAttended = Math.max(0, Math.floor(params.attended || 0));
  const safeTotal = Math.max(safeAttended, Math.floor(params.total || 0));
  const safeTarget = Math.min(100, Math.max(0, params.targetPercentage || 0));
  const safeRemaining = Math.max(0, Math.floor(params.scheduledRemaining || 0));

  const currentPct =
    safeTotal > 0 ? Math.round((safeAttended / safeTotal) * 10000) / 100 : 0;

  if (safeTotal === 0) {
    return {
      currentAttended: 0,
      currentTotal: 0,
      currentPercentage: 0,
      targetPercentage: safeTarget,
      classesNeeded: safeTarget > 0 ? 1 : 0,
      scheduledRemaining: safeRemaining,
      isReachable: safeRemaining >= 1,
      maxPossiblePercentage: safeRemaining > 0 ? 100 : 0,
      safeBunksRemaining: 0,
      status: "NO_CLASSES",
      message: "No classes recorded yet for this subject.",
    };
  }

  // Already above or equal to target
  if (currentPct >= safeTarget) {
    // How many of the remaining scheduled classes could be missed while staying >= target?
    // Formula: (A + remaining - bunks) / (T + remaining) >= P
    // bunks <= A + remaining - P * (T + remaining)
    const maxTotalFuture = safeTotal + safeRemaining;
    const minAttendedFuture = Math.ceil((safeTarget * maxTotalFuture) / 100);
    // Even if attending 0 more: (safeAttended / maxTotalFuture)
    let safeBunks = 0;
    if (safeRemaining > 0) {
      // If we attend all, max attended is safeAttended + safeRemaining
      // Bunks allowed from the future scheduled classes:
      const maxAttendedPossible = safeAttended + safeRemaining;
      safeBunks = Math.max(
        0,
        Math.min(safeRemaining, Math.floor(maxAttendedPossible - (safeTarget * maxTotalFuture) / 100))
      );
    }

    return {
      currentAttended: safeAttended,
      currentTotal: safeTotal,
      currentPercentage: currentPct,
      targetPercentage: safeTarget,
      classesNeeded: 0,
      scheduledRemaining: safeRemaining,
      isReachable: true,
      maxPossiblePercentage:
        safeRemaining > 0
          ? Math.round(((safeAttended + safeRemaining) / (safeTotal + safeRemaining)) * 10000) / 100
          : currentPct,
      safeBunksRemaining: safeBunks,
      status: "ALREADY_ABOVE",
      message:
        safeRemaining > 0
          ? `Your attendance is on track at ${currentPct.toFixed(1)}%. Based on your timetable, there are ${safeRemaining} scheduled classes remaining.`
          : `Your attendance is on track at ${currentPct.toFixed(1)}%.`,
    };
  }

  // Calculate needed consecutive attended classes
  const numerator = safeTarget * safeTotal - 100 * safeAttended;
  const denominator = 100 - safeTarget;
  const needed =
    denominator <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, Math.ceil(numerator / denominator));

  const maxAttendedPossible = safeAttended + safeRemaining;
  const maxTotalPossible = safeTotal + safeRemaining;
  const maxPossiblePct =
    maxTotalPossible > 0
      ? Math.round((maxAttendedPossible / maxTotalPossible) * 10000) / 100
      : 0;

  const isReachable = needed <= safeRemaining && Number.isFinite(needed);

  if (!isReachable) {
    return {
      currentAttended: safeAttended,
      currentTotal: safeTotal,
      currentPercentage: currentPct,
      targetPercentage: safeTarget,
      classesNeeded: needed,
      scheduledRemaining: safeRemaining,
      isReachable: false,
      maxPossiblePercentage: maxPossiblePct,
      safeBunksRemaining: 0,
      status: "IMPOSSIBLE",
      message: `Need ${needed} attended classes for ${safeTarget}%, but your timetable has ${safeRemaining} classes remaining. Max reachable is ${maxPossiblePct.toFixed(1)}%.`,
    };
  }

  return {
    currentAttended: safeAttended,
    currentTotal: safeTotal,
    currentPercentage: currentPct,
    targetPercentage: safeTarget,
    classesNeeded: needed,
    scheduledRemaining: safeRemaining,
    isReachable: true,
    maxPossiblePercentage: maxPossiblePct,
    safeBunksRemaining: 0,
    status: "RECOVERABLE",
    message: `Need to attend the next ${needed} class${needed === 1 ? "" : "es"} in a row to reach ${safeTarget}%. Your timetable has ${safeRemaining} scheduled classes remaining.`,
  };
}

/**
 * Bunk simulation incorporating future scheduled timetable classes.
 */
export function calculatePlannerBunkSimulation(params: {
  currentAttended: number;
  currentTotal: number;
  hypotheticalAttended: number;
  hypotheticalBunked: number;
  scheduledRemaining: number;
  targetPercentage: number;
}): {
  projectedAttended: number;
  projectedTotal: number;
  projectedPercentage: number;
  classesRemainingAfterSim: number;
  isAboveTarget: boolean;
  message: string;
} {
  const {
    currentAttended,
    currentTotal,
    hypotheticalAttended,
    hypotheticalBunked,
    scheduledRemaining,
    targetPercentage,
  } = params;

  const safeAttended = Math.max(0, Math.floor(currentAttended || 0));
  const safeTotal = Math.max(safeAttended, Math.floor(currentTotal || 0));
  const safeSimAttended = Math.max(0, Math.floor(hypotheticalAttended || 0));
  const safeSimBunked = Math.max(0, Math.floor(hypotheticalBunked || 0));
  const totalSimulated = safeSimAttended + safeSimBunked;

  const projAttended = safeAttended + safeSimAttended;
  const projTotal = safeTotal + totalSimulated;
  const projPct =
    projTotal > 0 ? Math.round((projAttended / projTotal) * 10000) / 100 : 0;

  const remainingAfter = Math.max(0, scheduledRemaining - totalSimulated);
  const isAbove = projPct >= targetPercentage;

  let message = "";
  if (totalSimulated === 0) {
    message = `Current standing: ${projPct.toFixed(1)}% (${safeAttended}/${safeTotal}).`;
  } else if (safeSimBunked > 0 && safeSimAttended === 0) {
    message = `If you miss the next ${safeSimBunked} scheduled class${safeSimBunked === 1 ? "" : "es"}, attendance will be ${projPct.toFixed(1)}% (${remainingAfter} classes will remain on timetable).`;
  } else if (safeSimAttended > 0 && safeSimBunked === 0) {
    message = `If you attend the next ${safeSimAttended} scheduled class${safeSimAttended === 1 ? "" : "es"}, attendance increases to ${projPct.toFixed(1)}% (${remainingAfter} classes will remain).`;
  } else {
    message = `Attending ${safeSimAttended} and missing ${safeSimBunked} results in ${projPct.toFixed(1)}% with ${remainingAfter} classes remaining.`;
  }

  return {
    projectedAttended: projAttended,
    projectedTotal: projTotal,
    projectedPercentage: projPct,
    classesRemainingAfterSim: remainingAfter,
    isAboveTarget: isAbove,
    message,
  };
}
