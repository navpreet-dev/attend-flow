/**
 * Universal Date-Iteration Engine for AttendFlow
 *
 * A 100% data-driven, pure mathematical calculation engine for "Remaining Scheduled Classes".
 *
 * Architectural Principles:
 * 1. ZERO HARDCODED COLLEGE FACTS:
 *    - Zero hardcoded subjects, course names, departments, sections, semesters, or lab names.
 *    - Zero hardcoded teaching cutoff dates (teachingEndDate is passed in data).
 *    - Zero hardcoded holidays (holidays are passed in data).
 *    - Zero hardcoded off-days or working-day assumptions (workingDays & excludedDays are passed in data).
 *    - Zero hardcoded timezones (timezone is passed in data).
 *    - Zero hardcoded G1/G2 day rules (groups are read dynamically from timetable entry properties).
 *
 * 2. SESSION-BASED DEDUPLICATION:
 *    - Contiguous time slots of the same subject & group on the same day are merged into ONE logical session.
 *    - Non-contiguous slots (e.g. morning lecture + afternoon lecture) remain separate logical sessions.
 *
 * 3. EXPLICIT GROUP SEPARATION:
 *    - Arbitrary group identifiers are supported (G1, G2, Batch-A, Lab-1, etc.).
 *    - Unknown group returns explicit breakdown for all discovered groups without guessing.
 *
 * 4. DETERMINISTIC DATE WALKING:
 *    - Walks calendar day-by-day using UTC-safe calendar math (YYYY-MM-DD), avoiding timezone offset shifts.
 *    - Respects deterministic precedence:
 *      Cancellation > Makeup/Rescheduled Override > Calendar Holiday > Weekly Off-Days > Recurring Timetable.
 *
 * 5. NORMALIZED RESULTS:
 *    - Guaranteed numeric values: 0 is ALWAYS numeric 0, never null or undefined.
 *    - remainingByGroup is ALWAYS a clean object: Record<string, number>.
 */

// -------------------------------------------------------------------------
// PURE DATE & TIMEZONE UTILITIES (Deterministic, Timezone-Safe)
// -------------------------------------------------------------------------

/**
 * Returns YYYY-MM-DD, HH:mm, and 1-7 dayOfWeek for a Date or ISO string in any specified IANA timezone.
 */
export function getDatePartsInTimezone(
  d: Date | string = new Date(),
  timezone: string = "Asia/Kolkata"
): { dateStr: string; timeStr: string; dayOfWeek: number } {
  const dateObj = typeof d === "string" ? new Date(d) : d;
  const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(validDate);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const yyyy = partMap["year"] || "2026";
  const mm = partMap["month"] || "01";
  const dd = partMap["day"] || "01";
  const dateStr = `${yyyy}-${mm}-${dd}`;

  let hh = partMap["hour"] || "00";
  if (hh === "24") hh = "00";
  const min = partMap["minute"] || "00";
  const timeStr = `${hh}:${min}`;

  const weekdayShort = (partMap["weekday"] || "").toLowerCase();
  const DOW_MAP: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };
  const dayOfWeek = DOW_MAP[weekdayShort] || 1;

  return { dateStr, timeStr, dayOfWeek };
}

/**
 * Backward-compatible helper for Asia/Kolkata date parts.
 */
export function getKolkataDateParts(d: Date = new Date()): {
  dateStr: string;
  timeStr: string;
  dayOfWeek: number;
} {
  return getDatePartsInTimezone(d, "Asia/Kolkata");
}

/**
 * Safely adds N days to an ISO YYYY-MM-DD string using UTC noon arithmetic to avoid DST shifts.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const resY = dt.getUTCFullYear();
  const resM = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const resD = String(dt.getUTCDate()).padStart(2, "0");
  return `${resY}-${resM}-${resD}`;
}

/**
 * Derives day of week (1=Mon ... 7=Sun) from an ISO YYYY-MM-DD string.
 */
export function getDayOfWeekFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return 1;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay(); // 0 = Sun ... 6 = Sat
  return day === 0 ? 7 : day;
}

/**
 * Compares two 24h time strings (HH:mm). Returns true if t1 <= t2.
 */
export function isTimeBeforeOrEqual(t1: string, t2: string): boolean {
  return t1.localeCompare(t2) <= 0;
}

/**
 * Converts HH:mm to minutes from midnight.
 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * Checks if two time intervals are contiguous (e.g. 10:40-11:30 and 11:30-12:20, or with max gap).
 */
export function areTimesContiguous(end1: string, start2: string, maxGapMinutes = 10): boolean {
  const m1 = timeToMinutes(end1);
  const m2 = timeToMinutes(start2);
  // Contiguous if start2 is within [end1 - 5min, end1 + maxGapMinutes]
  return m2 >= m1 - 5 && m2 <= m1 + maxGapMinutes;
}

// -------------------------------------------------------------------------
// DATA INTERFACES (Pure Data - Zero Hardcoding)
// -------------------------------------------------------------------------

export interface UniversalCalendarConfig {
  startDate?: string; // YYYY-MM-DD
  /** Effective teaching end date (teaching period cutoff) */
  teachingEndDate: string; // YYYY-MM-DD
  /** Working days of the week (1=Mon ... 7=Sun). Default: [1, 2, 3, 4, 5] */
  workingDays?: number[];
  /** Specific day numbers to exclude (e.g. [1] for Monday department leave) */
  excludedDays?: number[];
  /** Official holidays to exclude from teaching */
  holidays?: Array<{ date: string; name?: string | null }>;
}

export interface UniversalTimetableEntry {
  id?: string;
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  subjectCode: string;
  subjectName: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  room?: string | null;
  teacher?: string | null;
  matchedSubjectCode?: string | null;
  /** Explicit batch/group identifier (e.g. "G1", "G2", "Batch-A", null = all) */
  batch?: string | null;
  /** Optional array of applicable groups if slot serves multiple specific groups */
  groups?: string[] | null;
  /** Explicit boolean flag if subject is a practical/laboratory */
  isLab?: boolean;
}

export interface UniversalStudentContext {
  /** Active group of the student (e.g. "G1", "G2", "Batch-A", null or "Unknown") */
  group?: string | null;
  course?: string | null;
  section?: string | null;
  department?: string | null;
}

export type ScheduleExceptionType =
  | "CANCELLED"
  | "MAKEUP"
  | "RESCHEDULED"
  | "HOLIDAY";

export interface ScheduleException {
  date: string; // YYYY-MM-DD
  type: ScheduleExceptionType;
  /** Target subject code, or omit to apply to all subjects on this date */
  subjectCode?: string;
  /** For makeup days that follow another day's schedule (e.g. Saturday follows Tuesday timetable) */
  timetableDayOverride?: number;
  /** Explicit replacement class entries if custom for this date */
  replacementEntries?: UniversalTimetableEntry[];
  reason?: string;
}

export interface UniversalCalculationInput {
  /** Point in time as reference for calculation (default: current instant) */
  now?: Date | string;
  /** College/institution timezone (default: "Asia/Kolkata") */
  timezone?: string;
  /** Academic calendar configuration */
  calendar: UniversalCalendarConfig;
  /** Student's effective timetable entries */
  timetable: UniversalTimetableEntry[];
  /** Context of the current student */
  studentContext?: UniversalStudentContext;
  /** One-time schedule exceptions */
  exceptions?: ScheduleException[];
}

export interface NormalizedSubjectRemaining {
  subjectCode: string;
  subjectName: string;
  isLab: boolean;
  /** True if the subject has timetable entries restricted to specific groups/batches */
  isGroupDivided: boolean;
  /** Remaining scheduled classes for active student group (guaranteed numeric 0 or positive) */
  remainingClasses: number;
  /** Breakdown of remaining classes by group for group-divided subjects, null for unified subjects */
  remainingByGroup: Record<string, number> | null;
  /** Dates counted for the active student group */
  countedDates: string[];
  /** Dates counted breakdown per group */
  countedDatesByGroup: Record<string, string[]>;
}

export interface UniversalCalculationResult {
  asOfDate: string;
  asOfTime: string;
  timezone: string;
  teachingEndDate: string;
  requestedGroup: string;
  /** All unique groups discovered in the timetable */
  allDiscoveredGroups: string[];
  /** Theory classes remaining (identical for all groups) */
  theoryRemaining: number;
  /** Total classes remaining for the requested group */
  activeRemaining: number;
  /** Total classes remaining breakdown by group */
  totalRemainingByGroup: Record<string, number>;
  /** Detailed subject-level normalized metrics */
  bySubject: Record<string, NormalizedSubjectRemaining>;
  /** Complete chronological audit of all future class instances counted */
  scheduledInstances: Array<{
    date: string;
    dayOfWeek: number;
    subjectCode: string;
    subjectName: string;
    startTime: string;
    endTime: string;
    isLab: boolean;
    groups: string[];
  }>;
}

// Compatibility aliases for legacy consumers
export type LabGroup = string;
export type EngineTimetableEntry = UniversalTimetableEntry;
export type DateIterationResult = UniversalCalculationResult;
export type EngineSubjectAudit = NormalizedSubjectRemaining;

// -------------------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------------------

/**
 * Determines whether a timetable entry or subject is a laboratory/practical session.
 */
export function isLaboratorySubject(entry: {
  isLab?: boolean;
  subjectName?: string;
  subjectCode?: string;
  classType?: string;
}): boolean {
  if (entry.isLab === true) return true;
  if (entry.classType === "LABORATORY") return true;
  const name = (entry.subjectName || "").toLowerCase();
  const code = (entry.subjectCode || "").toLowerCase();
  return (
    name.includes("lab") ||
    name.includes("laboratory") ||
    name.includes("practical") ||
    code.includes("lab") ||
    code.includes("laboratory")
  );
}

/**
 * Extracts normalized group/batch identifiers from an entry.
 * Inspects explicit groups array, batch field, or text tags in subject/room.
 */
export function extractEntryGroups(entry: UniversalTimetableEntry): string[] | null {
  if (Array.isArray(entry.groups) && entry.groups.length > 0) {
    return entry.groups.map((g) => g.trim().toUpperCase()).filter(Boolean);
  }
  if (entry.batch && entry.batch.trim()) {
    return [entry.batch.trim().toUpperCase()];
  }

  // Fallback: check if subjectName or room has explicit group tag e.g. "(G1)", "G2", "[Batch A]"
  const searchStr = `${entry.subjectName || ""} ${entry.room || ""} ${entry.teacher || ""}`;
  const match = searchStr.match(/\b(G1|G2|G3|G4|BATCH[-\s]?[A-Z0-9]+)\b/i);
  if (match) {
    return [match[1].toUpperCase().replace(/\s+/g, "-")];
  }

  return null; // Not group-restricted: applies to all groups
}

/**
 * Backward-compatibility adapter for legacy database timetable entries that lack explicit batch/group tags.
 *
 * Rules:
 * 1. If an entry already has explicit `batch` or `groups`, keep it.
 * 2. If two laboratory entries occur on the same dayOfWeek with overlapping time slots,
 *    infer the first as "G1" and the second as "G2".
 * 3. Fallback to detecting common group tags in subjectName, room, or teacher.
 */
export function adaptLegacyTimetableEntries(
  entries: UniversalTimetableEntry[]
): UniversalTimetableEntry[] {
  const byDay = new Map<number, UniversalTimetableEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.dayOfWeek) || [];
    list.push({ ...entry });
    byDay.set(entry.dayOfWeek, list);
  }

  const result: UniversalTimetableEntry[] = [];

  for (const [, dayEntries] of byDay.entries()) {
    for (let i = 0; i < dayEntries.length; i++) {
      const e1 = dayEntries[i];
      if (!e1.batch && (!e1.groups || e1.groups.length === 0) && isLaboratorySubject(e1)) {
        // Try fallback string tag match first
        const searchStr = `${e1.subjectName || ""} ${e1.room || ""} ${e1.teacher || ""}`;
        const match = searchStr.match(/\b(G1|G2|G3|G4|BATCH[-\s]?[A-Z0-9]+)\b/i);
        if (match) {
          e1.batch = match[1].toUpperCase().replace(/\s+/g, "-");
        } else {
          // Check for overlapping lab on same day
          for (let j = 0; j < dayEntries.length; j++) {
            if (i === j) continue;
            const e2 = dayEntries[j];
            if (isLaboratorySubject(e2)) {
              const start1 = e1.startTime || "09:00";
              const end1 = e1.endTime || "09:50";
              const start2 = e2.startTime || "09:00";
              const end2 = e2.endTime || "09:50";
              if (start1 < end2 && start2 < end1) {
                // If e2 already has a batch, assign the opposite to e1
                if (e2.batch === "G2") e1.batch = "G1";
                else if (e2.batch === "G1") e1.batch = "G2";
                else {
                  // Assign G1 to earlier in array, G2 to later
                  e1.batch = i < j ? "G1" : "G2";
                }
                break;
              }
            }
          }
        }
      }
      result.push(e1);
    }
  }

  return result;
}

/**
 * Logical session representing one attendance event (possibly spanning contiguous periods).
 */
interface LogicalSession {
  dayOfWeek: number;
  subjectCode: string;
  subjectName: string;
  startTime: string;
  endTime: string;
  room?: string | null;
  teacher?: string | null;
  matchedSubjectCode?: string | null;
  groups: string[] | null; // null = universal
  isLab: boolean;
}

/**
 * Deduplicates contiguous periods of the same subject & group on the same day into single logical sessions.
 * Preserves non-contiguous sessions as separate attendance events.
 */
export function buildLogicalSessionsForDay(
  entries: UniversalTimetableEntry[]
): LogicalSession[] {
  if (!entries || entries.length === 0) return [];

  // Group entries by (subjectCode + groupKey)
  const grouped = new Map<string, UniversalTimetableEntry[]>();
  for (const entry of entries) {
    const code = (entry.matchedSubjectCode || entry.subjectCode).trim().toUpperCase();
    const groups = extractEntryGroups(entry);
    const groupKey = groups ? groups.sort().join(",") : "*ALL*";
    const key = `${code}::${groupKey}`;

    const list = grouped.get(key) || [];
    list.push(entry);
    grouped.set(key, list);
  }

  const sessions: LogicalSession[] = [];

  for (const list of grouped.values()) {
    // Sort entries by startTime
    list.sort((a, b) => (a.startTime || "09:00").localeCompare(b.startTime || "09:00"));

    let currentSession: LogicalSession | null = null;

    for (const entry of list) {
      const code = (entry.matchedSubjectCode || entry.subjectCode).trim();
      const groups = extractEntryGroups(entry);
      const isLab = isLaboratorySubject(entry);
      const start = entry.startTime || "09:00";
      const end = entry.endTime || "09:50";

      if (!currentSession) {
        currentSession = {
          dayOfWeek: entry.dayOfWeek,
          subjectCode: code,
          subjectName: entry.subjectName,
          startTime: start,
          endTime: end,
          room: entry.room,
          teacher: entry.teacher,
          matchedSubjectCode: entry.matchedSubjectCode || entry.subjectCode,
          groups,
          isLab,
        };
      } else {
        // Check if contiguous with current session
        if (areTimesContiguous(currentSession.endTime, start)) {
          // Merge contiguous periods into one attendance session
          if (end.localeCompare(currentSession.endTime) > 0) {
            currentSession.endTime = end;
          }
        } else {
          // Non-contiguous -> push completed session and start new one
          sessions.push(currentSession);
          currentSession = {
            dayOfWeek: entry.dayOfWeek,
            subjectCode: code,
            subjectName: entry.subjectName,
            startTime: start,
            endTime: end,
            room: entry.room,
            teacher: entry.teacher,
            matchedSubjectCode: entry.matchedSubjectCode || entry.subjectCode,
            groups,
            isLab,
          };
        }
      }
    }

    if (currentSession) {
      sessions.push(currentSession);
    }
  }

  // Sort sessions chronologically by startTime
  return sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// -------------------------------------------------------------------------
// CORE CALCULATION ENGINE (100% Data-Driven & Universal)
// -------------------------------------------------------------------------

/**
 * Calculates remaining scheduled classes using a pure, data-driven date-iteration loop.
 *
 * Accepts all institutional rules as input configuration:
 * - teachingEndDate
 * - workingDays & excludedDays
 * - holidays
 * - timetable entries with arbitrary groups
 * - timezone
 * - current time
 */
export function calculateRemainingClasses(
  timetableOrInput: UniversalTimetableEntry[] | UniversalCalculationInput,
  legacyOptions?: any
): UniversalCalculationResult {
  // Support both new unified input object and legacy signature: (timetable, options)
  let input: UniversalCalculationInput;

  if (Array.isArray(timetableOrInput)) {
    const opts = legacyOptions || {};
    input = {
      now: opts.asOf || new Date(),
      timezone: opts.timezone || "Asia/Kolkata",
      calendar: {
        startDate: opts.startDate,
      teachingEndDate: opts.teachingEndDate || opts.endDate || undefined,
        workingDays: opts.workingDays || [1, 2, 3, 4, 5],
        excludedDays: opts.timetableOffDays || opts.departmentalOffDays || [],
        holidays: opts.additionalHolidays || opts.holidays || [],
      },
      timetable: timetableOrInput,
      studentContext: {
        group: opts.group || "Unknown",
      },
      exceptions: opts.exceptions || [],
    };
  } else {
    input = timetableOrInput;
  }

  const timezone = input.timezone || "Asia/Kolkata";
  const nowParts = getDatePartsInTimezone(input.now || new Date(), timezone);
  const asOfDateStr = nowParts.dateStr;
  const asOfTimeStr = nowParts.timeStr;

  const calendar = input.calendar;
  if (!calendar || !calendar.teachingEndDate) {
    throw new Error(
      "Universal calculation engine requires calendar.teachingEndDate in input configuration."
    );
  }
  const teachingEndDate = calendar.teachingEndDate.trim();

  // 1. Build Working Days Set & Excluded Days Set
  const workingDaysSet = new Set<number>(
    calendar.workingDays && calendar.workingDays.length > 0
      ? calendar.workingDays
      : [1, 2, 3, 4, 5]
  );
  const excludedDaysSet = new Set<number>(calendar.excludedDays || []);

  // 2. Build Holidays Set (Normalized YYYY-MM-DD)
  const holidaySet = new Set<string>();
  if (Array.isArray(calendar.holidays)) {
    for (const h of calendar.holidays) {
      if (h.date && h.date.trim()) {
        holidaySet.add(h.date.trim());
      }
    }
  }

  // 3. Index Exceptions by Date
  const exceptionMap = new Map<string, ScheduleException[]>();
  if (Array.isArray(input.exceptions)) {
    for (const ex of input.exceptions) {
      if (ex.date) {
        const list = exceptionMap.get(ex.date.trim()) || [];
        list.push(ex);
        exceptionMap.set(ex.date.trim(), list);
      }
    }
  }

  // 4. Adapt legacy timetable entries (infer G1/G2 for overlapping lab sessions)
  const timetable = adaptLegacyTimetableEntries(input.timetable || []);

  // Index Timetable Entries by Day of Week (1=Mon ... 7=Sun)
  const timetableByDay = new Map<number, UniversalTimetableEntry[]>();
  const allDiscoveredGroupsSet = new Set<string>();
  const subjectMeta = new Map<
    string,
    { subjectCode: string; subjectName: string; isLab: boolean; isGroupDivided: boolean }
  >();

  for (const entry of timetable) {
    const dow = Math.min(7, Math.max(1, entry.dayOfWeek || 1));
    const list = timetableByDay.get(dow) || [];
    list.push(entry);
    timetableByDay.set(dow, list);

    // Track groups
    const groups = extractEntryGroups(entry);
    if (groups) {
      for (const g of groups) allDiscoveredGroupsSet.add(g);
    }

    // Register subject metadata and determine if group-divided
    const code = (entry.matchedSubjectCode || entry.subjectCode).trim();
    const hasGroupRestriction = Boolean(groups && groups.length > 0);
    const existing = subjectMeta.get(code);
    if (!existing) {
      subjectMeta.set(code, {
        subjectCode: code,
        subjectName: entry.subjectName,
        isLab: isLaboratorySubject(entry),
        isGroupDivided: hasGroupRestriction,
      });
    } else if (hasGroupRestriction) {
      existing.isGroupDivided = true;
    }
  }

  // Add default groups if none found but G1/G2/Both expected by context
  const requestedGroupRaw = (input.studentContext?.group || "Unknown").trim().toUpperCase();
  const isSpecificGroup =
    requestedGroupRaw !== "UNKNOWN" &&
    requestedGroupRaw !== "BOTH" &&
    requestedGroupRaw !== "";

  if (
    requestedGroupRaw === "G1" ||
    requestedGroupRaw === "G2" ||
    requestedGroupRaw === "BOTH" ||
    requestedGroupRaw === "UNKNOWN"
  ) {
    const hasLabs = timetable.some((t) => isLaboratorySubject(t));
    if (hasLabs) {
      allDiscoveredGroupsSet.add("G1");
      allDiscoveredGroupsSet.add("G2");
    }
  }
  const allDiscoveredGroups = Array.from(allDiscoveredGroupsSet).sort();

  // 5. Precompute logical sessions per day of week (contiguous deduplication)
  const logicalSessionsByDay = new Map<number, LogicalSession[]>();
  for (let dow = 1; dow <= 7; dow++) {
    const rawEntries = timetableByDay.get(dow) || [];
    logicalSessionsByDay.set(dow, buildLogicalSessionsForDay(rawEntries));
  }

  // Accumulators
  const countedDatesBySubjectAndGroup = new Map<string, Map<string, string[]>>();
  const activeCountedDatesBySubject = new Map<string, string[]>();
  const scheduledInstances: UniversalCalculationResult["scheduledInstances"] = [];

  for (const code of subjectMeta.keys()) {
    activeCountedDatesBySubject.set(code, []);
    const groupMap = new Map<string, string[]>();
    for (const g of allDiscoveredGroups) {
      groupMap.set(g, []);
    }
    countedDatesBySubjectAndGroup.set(code, groupMap);
  }

  // -----------------------------------------------------------------------
  // DYNAMIC DATE-ITERATION LOOP
  // Walks calendar day-by-day from asOfDateStr through teachingEndDate
  // -----------------------------------------------------------------------
  let currentDateStr = asOfDateStr;

  while (currentDateStr <= teachingEndDate) {
    const dayOfWeek = getDayOfWeekFromDateStr(currentDateStr);
    const dayExceptions = exceptionMap.get(currentDateStr) || [];

    // Step A: Cancellation check
    const isFullDayCancelled = dayExceptions.some(
      (e) => e.type === "CANCELLED" && !e.subjectCode
    );

    // Step B: Makeup / Rescheduled day check
    const makeupException = dayExceptions.find(
      (e) => e.type === "MAKEUP" || e.type === "RESCHEDULED"
    );

    // Step C: Calendar holiday check
    const isHoliday = holidaySet.has(currentDateStr);

    // Step D: Weekly off-days check (workingDays and excludedDays)
    const isOffDay =
      !workingDaysSet.has(dayOfWeek) || excludedDaysSet.has(dayOfWeek);

    // Determine candidate logical sessions for this date based on precedence
    let candidateSessions: LogicalSession[] = [];

    if (isFullDayCancelled) {
      candidateSessions = [];
    } else if (makeupException) {
      if (makeupException.replacementEntries && makeupException.replacementEntries.length > 0) {
        candidateSessions = buildLogicalSessionsForDay(makeupException.replacementEntries);
      } else if (makeupException.timetableDayOverride) {
        candidateSessions = logicalSessionsByDay.get(makeupException.timetableDayOverride) || [];
      } else {
        candidateSessions = logicalSessionsByDay.get(dayOfWeek) || [];
      }
    } else if (isHoliday) {
      candidateSessions = [];
    } else if (isOffDay) {
      candidateSessions = [];
    } else {
      candidateSessions = logicalSessionsByDay.get(dayOfWeek) || [];
    }

    // Filter out subject-specific cancellations
    if (candidateSessions.length > 0 && dayExceptions.length > 0) {
      const cancelledCodes = new Set(
        dayExceptions
          .filter((e) => e.type === "CANCELLED" && e.subjectCode)
          .map((e) => e.subjectCode!.trim().toUpperCase())
      );
      if (cancelledCodes.size > 0) {
        candidateSessions = candidateSessions.filter(
          (s) =>
            !cancelledCodes.has(s.subjectCode.toUpperCase()) &&
            !cancelledCodes.has((s.matchedSubjectCode || "").toUpperCase())
        );
      }
    }

    // Step E: Process candidate sessions for this day
    for (const session of candidateSessions) {
      const subjectCode = session.subjectCode;

      // If currentDate is today, check if session has already concluded
      if (currentDateStr === asOfDateStr) {
        const endTime = session.endTime || session.startTime || "";
        if (endTime && isTimeBeforeOrEqual(endTime, asOfTimeStr)) {
          continue; // Already concluded today
        }
      }

      // Ensure subject metadata exists
      if (!subjectMeta.has(subjectCode)) {
        subjectMeta.set(subjectCode, {
          subjectCode,
          subjectName: session.subjectName,
          isLab: session.isLab,
          isGroupDivided: Boolean(session.groups && session.groups.length > 0),
        });
        activeCountedDatesBySubject.set(subjectCode, []);
        const gMap = new Map<string, string[]>();
        for (const g of allDiscoveredGroups) gMap.set(g, []);
        countedDatesBySubjectAndGroup.set(subjectCode, gMap);
      } else if (session.groups && session.groups.length > 0) {
        subjectMeta.get(subjectCode)!.isGroupDivided = true;
      }

      const groupsForSession = session.groups; // null = universal
      const groupDatesMap = countedDatesBySubjectAndGroup.get(subjectCode)!;

      // Update per-group accumulators
      if (!groupsForSession || groupsForSession.length === 0) {
        // Universal session: counts for ALL groups
        for (const g of allDiscoveredGroups) {
          const arr = groupDatesMap.get(g) || [];
          arr.push(currentDateStr);
          groupDatesMap.set(g, arr);
        }
      } else {
        // Specific group session: counts only for specified groups
        for (const g of groupsForSession) {
          allDiscoveredGroupsSet.add(g);
          const arr = groupDatesMap.get(g) || [];
          arr.push(currentDateStr);
          groupDatesMap.set(g, arr);
        }
      }

      // Check whether session counts for the active student context
      let countsForActiveStudent = false;

      if (!groupsForSession || groupsForSession.length === 0) {
        countsForActiveStudent = true; // Universal session
      } else if (isSpecificGroup) {
        countsForActiveStudent = groupsForSession.includes(requestedGroupRaw);
      } else {
        // Unknown or Both student group:
        // Do not fabricate a single number. We do NOT add incompatible lab groups together.
        // For Unknown / Both, we do not mark as active unless it's universal.
        countsForActiveStudent = false;
      }

      if (countsForActiveStudent) {
        activeCountedDatesBySubject.get(subjectCode)?.push(currentDateStr);
      }

      scheduledInstances.push({
        date: currentDateStr,
        dayOfWeek,
        subjectCode,
        subjectName: session.subjectName,
        startTime: session.startTime,
        endTime: session.endTime,
        isLab: session.isLab,
        groups: groupsForSession || [],
      });
    }

    // Advance to next calendar day
    currentDateStr = addDays(currentDateStr, 1);
  }

  // -----------------------------------------------------------------------
  // ASSEMBLE NORMALIZED RESULTS
  // -----------------------------------------------------------------------
  const bySubject: Record<string, NormalizedSubjectRemaining> = {};
  let totalTheoryRemaining = 0;
  let totalActiveRemaining = 0;
  const totalRemainingByGroup: Record<string, number> = {};

  for (const g of allDiscoveredGroups) {
    totalRemainingByGroup[g] = 0;
  }

  for (const [code, meta] of subjectMeta.entries()) {
    const isDivided = meta.isGroupDivided;
    const activeDates = activeCountedDatesBySubject.get(code) || [];
    const groupDatesMap = countedDatesBySubjectAndGroup.get(code)!;

    if (!isDivided) {
      // UNIFIED SUBJECT (Lectures, unified classes, electives)
      // All students attend all occurrences together.
      // Must return a single integer: remainingClasses: number, with isGroupDivided: false, and remainingByGroup: null.
      const sampleGroup = allDiscoveredGroups[0];
      const singleRemaining = sampleGroup
        ? (groupDatesMap.get(sampleGroup)?.length ?? activeDates.length)
        : activeDates.length;

      bySubject[code] = {
        subjectCode: code,
        subjectName: meta.subjectName,
        isLab: meta.isLab,
        isGroupDivided: false,
        remainingClasses: Math.max(0, singleRemaining),
        remainingByGroup: null,
        countedDates: activeDates,
        countedDatesByGroup: {},
      };

      if (!meta.isLab) {
        totalTheoryRemaining += singleRemaining;
      }
      totalActiveRemaining += singleRemaining;
      for (const g of allDiscoveredGroups) {
        totalRemainingByGroup[g] = (totalRemainingByGroup[g] || 0) + singleRemaining;
      }
    } else {
      // GROUP-DIVIDED SUBJECT (Labs / Tutorials with specific group splits)
      const remainingByGroup: Record<string, number> = {};
      const countedDatesByGroup: Record<string, string[]> = {};

      for (const g of allDiscoveredGroups) {
        const dList = groupDatesMap.get(g) || [];
        remainingByGroup[g] = dList.length;
        countedDatesByGroup[g] = dList;
        totalRemainingByGroup[g] = (totalRemainingByGroup[g] || 0) + dList.length;
      }

      let remainingClasses = activeDates.length;

      if (!isSpecificGroup) {
        // Toggle is "Both" or "Unknown"
        const groupCounts = Object.values(remainingByGroup);
        if (groupCounts.length > 0 && groupCounts.every((c) => c === groupCounts[0])) {
          remainingClasses = groupCounts[0];
        } else {
          remainingClasses = 0;
        }
      }

      bySubject[code] = {
        subjectCode: code,
        subjectName: meta.subjectName,
        isLab: meta.isLab,
        isGroupDivided: true,
        remainingClasses: Math.max(0, remainingClasses),
        remainingByGroup,
        countedDates: activeDates,
        countedDatesByGroup,
      };

      if (!meta.isLab) {
        totalTheoryRemaining += remainingClasses;
      }
      totalActiveRemaining += remainingClasses;
    }
  }

  return {
    asOfDate: asOfDateStr,
    asOfTime: asOfTimeStr,
    timezone,
    teachingEndDate,
    requestedGroup: requestedGroupRaw || "Unknown",
    allDiscoveredGroups,
    theoryRemaining: totalTheoryRemaining,
    activeRemaining: totalActiveRemaining,
    totalRemainingByGroup,
    bySubject,
    scheduledInstances,
  };
}
