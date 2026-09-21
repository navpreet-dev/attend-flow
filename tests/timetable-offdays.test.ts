/**
 * Unit tests for timetable-specific off-days in generateScheduledClasses().
 *
 * Test week: 28 Sep 2026 (Mon) – 2 Oct 2026 (Fri).
 * Verified: 2026-09-28 = Monday, 2026-09-29 = Tuesday, 2026-09-30 = Wednesday,
 *           2026-10-01 = Thursday, 2026-10-02 = Friday.
 *
 * Tests cover:
 *  1. No timetableOffDays → backward-compatible (5 weekday classes)
 *  2. Monday off → 4 classes (Tue–Fri)
 *  3. Tuesday off → 4 classes (Mon, Wed–Fri)
 *  4. Combined: timetable Monday off + academic calendar Wednesday holiday → 3 classes
 *  5. Per-student isolation: Student A (Mon off) vs Student B (Tue off)
 *  6. Wednesday off → 4 classes
 *  7. Empty timetableOffDays [] → backward-compatible (5 weekday classes)
 */

import { generateScheduledClasses } from "../src/lib/academic-planner";
import type { AcademicCalendarConfig, TimetableEntryItem } from "../src/lib/academic-planner";

// Verified Mon–Fri week
const MON = "2026-09-28";
const TUE = "2026-09-29";
const WED = "2026-09-30";
// THU = "2026-10-01"
// FRI = "2026-10-02"

const CALENDAR_BASE: AcademicCalendarConfig = {
  startDate: MON,
  endDate: "2026-10-02",
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
};

// One class per weekday (Mon–Fri)
const TIMETABLE_ALL_DAYS: TimetableEntryItem[] = [
  { id: "1", dayOfWeek: 1, subjectCode: "CS101", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
  { id: "2", dayOfWeek: 2, subjectCode: "CS101", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
  { id: "3", dayOfWeek: 3, subjectCode: "CS101", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
  { id: "4", dayOfWeek: 4, subjectCode: "CS101", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
  { id: "5", dayOfWeek: 5, subjectCode: "CS101", subjectName: "Data Structures", startTime: "09:00", endTime: "09:50" },
];

const BEFORE_WEEK = new Date("2026-09-27T00:00:00"); // Sunday before the test week

function pass(label: string) { console.log(`  \u2705 PASS: ${label}`); }
function fail(label: string, detail: string) {
  console.error(`  \u274c FAIL: ${label}`);
  console.error(`         ${detail}`);
  process.exitCode = 1;
}
function assert(cond: boolean, label: string, detail = "") {
  if (cond) pass(label); else fail(label, detail || "Assertion failed");
}

console.log("\n=== timetable-offdays.test.ts ===\n");

// -------------------------------------------------------
// TEST 1: No timetableOffDays — backward-compatible baseline
// -------------------------------------------------------
console.log("TEST 1: No timetableOffDays (backward-compatible baseline)");
{
  const classes = generateScheduledClasses(CALENDAR_BASE, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  assert(classes.length === 5, "Should produce 5 classes (Mon-Fri)", `Got ${classes.length}`);
  const days = new Set(classes.map((c) => c.dayOfWeek));
  assert(days.has(1) && days.has(2) && days.has(3) && days.has(4) && days.has(5), "All 5 weekday slots present");
  assert(classes.some((c) => c.date === MON), `Monday date ${MON} present`);
  assert(classes.some((c) => c.date === TUE), `Tuesday date ${TUE} present`);
}

// -------------------------------------------------------
// TEST 2: Monday off (timetableOffDays = [1])
// -------------------------------------------------------
console.log("\nTEST 2: Monday off (timetableOffDays = [1])");
{
  const cal: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [1] };
  const classes = generateScheduledClasses(cal, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  assert(classes.length === 4, "Should produce 4 classes (Tue-Fri)", `Got ${classes.length}`);
  const days = new Set(classes.map((c) => c.dayOfWeek));
  assert(!days.has(1), "Monday (dayOfWeek=1) must NOT appear");
  assert(days.has(2) && days.has(3) && days.has(4) && days.has(5), "Tue-Fri must be present");
  assert(!classes.some((c) => c.date === MON), `Monday date ${MON} must be absent`);
  assert(classes.some((c) => c.date === TUE), `Tuesday date ${TUE} must be present`);
}

// -------------------------------------------------------
// TEST 3: Tuesday off (timetableOffDays = [2])
// -------------------------------------------------------
console.log("\nTEST 3: Tuesday off (timetableOffDays = [2])");
{
  const cal: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [2] };
  const classes = generateScheduledClasses(cal, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  assert(classes.length === 4, "Should produce 4 classes (Mon, Wed-Fri)", `Got ${classes.length}`);
  const days = new Set(classes.map((c) => c.dayOfWeek));
  assert(!days.has(2), "Tuesday (dayOfWeek=2) must NOT appear");
  assert(days.has(1) && days.has(3) && days.has(4) && days.has(5), "Mon, Wed, Thu, Fri must be present");
  assert(classes.some((c) => c.date === MON), `Monday date ${MON} must be present`);
  assert(!classes.some((c) => c.date === TUE), `Tuesday date ${TUE} must be absent`);
}

// -------------------------------------------------------
// TEST 4: Combined — Monday off (timetable) + Wednesday holiday (calendar)
// -------------------------------------------------------
console.log("\nTEST 4: Combined — Monday off (timetable) + Wednesday holiday (calendar)");
{
  const cal: AcademicCalendarConfig = {
    ...CALENDAR_BASE,
    timetableOffDays: [1],           // Monday off — timetable/section specific
    holidays: [{ date: WED, name: "College Holiday" }], // Wednesday holiday — from academic calendar
  };
  const classes = generateScheduledClasses(cal, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  // Should have: Tue, Thu, Fri = 3 classes
  assert(classes.length === 3, "Should produce 3 classes (Tue, Thu, Fri)", `Got ${classes.length}`);
  assert(!classes.some((c) => c.date === MON), `Monday ${MON} excluded by timetableOffDays`);
  assert(!classes.some((c) => c.date === WED), `Wednesday ${WED} excluded by calendar holiday`);
  const days = new Set(classes.map((c) => c.dayOfWeek));
  assert(days.has(2), "Tuesday present");
  assert(days.has(4), "Thursday present");
  assert(days.has(5), "Friday present");
}

// -------------------------------------------------------
// TEST 5: Per-student isolation (Student A = Mon off, Student B = Tue off)
// -------------------------------------------------------
console.log("\nTEST 5: Per-student isolation");
{
  const calStudentA: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [1] }; // Mon off
  const calStudentB: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [2] }; // Tue off

  const classesA = generateScheduledClasses(calStudentA, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  const classesB = generateScheduledClasses(calStudentB, TIMETABLE_ALL_DAYS, BEFORE_WEEK);

  const daysA = new Set(classesA.map((c) => c.dayOfWeek));
  const daysB = new Set(classesB.map((c) => c.dayOfWeek));

  assert(!daysA.has(1) && daysA.has(2), "Student A: Mon absent, Tue present");
  assert(daysB.has(1) && !daysB.has(2), "Student B: Mon present, Tue absent");
  assert(classesA.length === 4, "Student A: 4 classes", `Got ${classesA.length}`);
  assert(classesB.length === 4, "Student B: 4 classes", `Got ${classesB.length}`);
  // Confirm Monday date is in B but not A
  assert(!classesA.some((c) => c.date === MON), `Student A: Monday date ${MON} absent`);
  assert(classesB.some((c) => c.date === MON), `Student B: Monday date ${MON} present`);
  assert(classesA.some((c) => c.date === TUE), `Student A: Tuesday date ${TUE} present`);
  assert(!classesB.some((c) => c.date === TUE), `Student B: Tuesday date ${TUE} absent`);
}

// -------------------------------------------------------
// TEST 6: Wednesday off (timetableOffDays = [3])
// -------------------------------------------------------
console.log("\nTEST 6: Wednesday off (timetableOffDays = [3])");
{
  const cal: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [3] };
  const classes = generateScheduledClasses(cal, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  assert(classes.length === 4, "Should produce 4 classes", `Got ${classes.length}`);
  assert(!classes.some((c) => c.dayOfWeek === 3), "Wednesday (dayOfWeek=3) must be absent");
  assert(!classes.some((c) => c.date === WED), `Wednesday date ${WED} absent`);
}

// -------------------------------------------------------
// TEST 7: Empty timetableOffDays array — backward-compatible
// -------------------------------------------------------
console.log("\nTEST 7: Empty timetableOffDays = [] (backward-compatible)");
{
  const cal: AcademicCalendarConfig = { ...CALENDAR_BASE, timetableOffDays: [] };
  const classes = generateScheduledClasses(cal, TIMETABLE_ALL_DAYS, BEFORE_WEEK);
  assert(classes.length === 5, "Empty offDays: all 5 weekday classes", `Got ${classes.length}`);
}

console.log("\n=== Tests complete ===\n");
if (process.exitCode === 1) {
  console.error("One or more tests FAILED.\n");
} else {
  console.log("All 7 tests PASSED\n");
}
