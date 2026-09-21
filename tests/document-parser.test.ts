/**
 * Document Extractor & Parser Tests
 *
 * Tests:
 * 1. File format & size validation (PDF, DOCX, DOC, JPG, JPEG, PNG)
 * 2. Timetable text parsing (days, time ranges, multiple classes/day, rooms, teachers)
 * 3. Break / lunch period exclusion
 * 4. Safe AGC subject matching (exact, fuzzy, and unmatched review flag)
 * 5. Academic calendar parsing (semester boundaries, 5-day vs 6-day working weeks)
 * 6. Holiday detection & extraction
 * 7. End-to-end pipeline: Parsed document -> Schedule generation -> Recovery & Bunk calculation
 */

import { validateUploadedFile } from "../src/lib/academic-document-extractor";
import {
  parseTimetableDocument,
  parseAcademicCalendarDocument,
} from "../src/lib/academic-document-parser";
import {
  generateScheduledClasses,
  calculateSubjectScheduleMetrics,
  calculatePlannerRecovery,
  calculatePlannerBunkSimulation,
} from "../src/lib/academic-planner";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${message}`);
}

async function runTests() {
  console.log("--- RUNNING DOCUMENT PARSER & EXTRACTION TESTS ---\n");

  // TEST 1: File Validation
  const validPdf = validateUploadedFile("my_schedule.pdf", 1024 * 100);
  assert(validPdf.valid && validPdf.fileType === "pdf", "Valid PDF accepted");

  const validDocx = validateUploadedFile("timetable.docx", 1024 * 200);
  assert(validDocx.valid && validDocx.fileType === "docx", "Valid DOCX accepted");

  const validDoc = validateUploadedFile("calendar.doc", 1024 * 150);
  assert(validDoc.valid && validDoc.fileType === "doc", "Valid DOC accepted");

  const validJpg = validateUploadedFile("photo.jpg", 1024 * 500);
  assert(validJpg.valid && validJpg.fileType === "image", "Valid JPG accepted");

  const validPng = validateUploadedFile("screenshot.png", 1024 * 500);
  assert(validPng.valid && validPng.fileType === "image", "Valid PNG accepted");

  const tooLarge = validateUploadedFile("huge.pdf", 15 * 1024 * 1024);
  assert(!tooLarge.valid && Boolean(tooLarge.error), "Files over 10MB correctly rejected");

  const invalidExt = validateUploadedFile("script.sh", 1024);
  assert(!invalidExt.valid, "Unsupported extension correctly rejected");

  // TEST 2: Timetable Document Text Parsing
  const sampleTimetableText = `
    DEPARTMENT OF COMPUTER SCIENCE
    WEEKLY CLASS TIMETABLE - FALL 2026

    MONDAY
    10:00 AM - 11:00 AM Computer Networks Lab 3 Dr. Sharma
    11:00 AM - 12:00 PM Data Structures Room 204 Prof. Verma
    12:00 PM - 01:00 PM Lunch Break
    02:00 PM - 03:00 PM Web Designing LT-1

    WEDNESDAY
    09:30 AM - 10:30 AM Computer Networks Lab 3
    10:30 AM - 11:30 AM Introduction to Artificial Intelligence Room 102

    FRIDAY
    02:00 PM - 04:00 PM Computer Networks Laboratory Lab 2
  `;

  const agcSubjects = [
    { subjectCode: "AGC-18090", subjectName: "Computer Networks" },
    { subjectCode: "AGC-18091", subjectName: "Data Structures" },
    { subjectCode: "AGC-18092", subjectName: "Web Designing" },
    { subjectCode: "AGC-18097", subjectName: "Introduction to Artificial Intelligence" },
    { subjectCode: "AGC-18099", subjectName: "Computer Networks Laboratory" },
  ];

  const parsedTimetable = parseTimetableDocument(
    sampleTimetableText,
    "timetable.pdf",
    agcSubjects
  );

  assert(
    parsedTimetable.entries.length === 6,
    `Expected 6 classes parsed (excluding lunch break), got ${parsedTimetable.entries.length}`
  );

  // Check Lunch Break was excluded
  const lunchEntry = parsedTimetable.entries.find((e) =>
    e.subjectName.toLowerCase().includes("lunch")
  );
  assert(!lunchEntry, "Lunch break was successfully filtered out");

  // Check Monday entries
  const mondayEntries = parsedTimetable.entries.filter((e) => e.dayOfWeek === 1);
  assert(mondayEntries.length === 3, `Expected 3 Monday classes, got ${mondayEntries.length}`);
  assert(mondayEntries[0].startTime === "10:00" && mondayEntries[0].endTime === "11:00", "Start and end times formatted in 24h");
  assert(mondayEntries[0].matchedSubjectCode === "AGC-18090", "Matched with AGC-18090 Computer Networks");
  assert(mondayEntries[0].matchConfidence === "high", "High confidence match for exact subject");
  assert(mondayEntries[0].room === "Lab 3", `Room parsed as Lab 3, got ${mondayEntries[0].room}`);
  assert(mondayEntries[0].teacher?.includes("Sharma") || false, "Teacher parsed as Dr. Sharma");

  // Check Wednesday entries
  const wednesdayEntries = parsedTimetable.entries.filter((e) => e.dayOfWeek === 3);
  assert(wednesdayEntries.length === 2, `Expected 2 Wednesday classes, got ${wednesdayEntries.length}`);
  assert(wednesdayEntries[1].matchedSubjectCode === "AGC-18097", "Matched Artificial Intelligence");

  // TEST 3: Subject Matching Unmatched Fallback
  const unmatchedText = `
    MONDAY
    10:00 AM - 11:00 AM Quantum Astrophysics Room 99
  `;
  const parsedUnmatched = parseTimetableDocument(unmatchedText, "unmatched.pdf", agcSubjects);
  assert(parsedUnmatched.entries.length === 1, "Parsed unknown subject line");
  assert(parsedUnmatched.entries[0].matchConfidence === "none", "Unknown subject marked with confidence 'none'");
  assert(parsedUnmatched.entries[0].needsReview === true, "Unknown subject flagged for user review");

  // TEST 4: Academic Calendar Parsing
  const sampleCalendarText = `
    ACADEMIC CALENDAR 2026-2027
    ODD SEMESTER

    Semester commences: August 10, 2026
    Last working day of semester: December 20, 2026
    Working days: Monday to Friday

    LIST OF HOLIDAYS:
    15-08-2026 : Independence Day
    02-10-2026 : Mahatma Gandhi Jayanti
    01-11-2026 : Diwali Break
    25-12-2026 : Christmas Holiday
  `;

  const parsedCalendar = parseAcademicCalendarDocument(
    sampleCalendarText,
    "calendar.docx"
  );

  assert(parsedCalendar.startDate === "2026-08-10", `Start date parsed as 2026-08-10, got ${parsedCalendar.startDate}`);
  assert(parsedCalendar.endDate === "2026-12-20", `End date parsed as 2026-12-20, got ${parsedCalendar.endDate}`);
  assert(parsedCalendar.workingDays.length === 5, "Configured 5-day academic week");
  assert(parsedCalendar.holidays.length >= 3, `Expected at least 3 holidays, got ${parsedCalendar.holidays.length}`);

  const indepHoliday = parsedCalendar.holidays.find((h) => h.date === "2026-08-15");
  assert(Boolean(indepHoliday), "Independence Day detected on 2026-08-15");

  const gandhiHoliday = parsedCalendar.holidays.find((h) => h.date === "2026-10-02");
  assert(Boolean(gandhiHoliday), "Gandhi Jayanti detected on 2026-10-02");

  // TEST 5: Pipeline from Parsed Document to Schedule Generation & Bunk Simulation
  const calendarConfig = {
    startDate: parsedCalendar.startDate,
    endDate: parsedCalendar.endDate,
    workingDays: parsedCalendar.workingDays,
    holidays: parsedCalendar.holidays,
  };

  const timetableItems = parsedTimetable.entries.map((e) => ({
    dayOfWeek: e.dayOfWeek,
    subjectCode: e.matchedSubjectCode || e.subjectCode,
    subjectName: e.subjectName,
    startTime: e.startTime,
    endTime: e.endTime,
    matchedSubjectCode: e.matchedSubjectCode,
  }));

  // Generate scheduled classes for entire timetable
  const allClasses = generateScheduledClasses(
    calendarConfig,
    timetableItems,
    new Date("2026-09-01T00:00:00")
  );
  assert(allClasses.length > 0, `Generated ${allClasses.length} future scheduled classes across timetable`);

  // Calculate recovery for Computer Networks
  const netMetrics = calculateSubjectScheduleMetrics(
    "AGC-18090",
    calendarConfig,
    timetableItems,
    new Date("2026-09-01T00:00:00")
  );
  assert(netMetrics.scheduledRemaining > 0, `Recorded ${netMetrics.scheduledRemaining} remaining classes from Sep 1`);

  const recovery = calculatePlannerRecovery({
    attended: 20,
    total: 32,
    targetPercentage: 75,
    scheduledRemaining: netMetrics.scheduledRemaining,
  });
  assert(recovery.classesNeeded === 16, "16 attended classes needed to reach 75%");
  assert(
    recovery.status === "RECOVERABLE" || recovery.status === "IMPOSSIBLE",
    `Recovery evaluated status: ${recovery.status}`
  );

  // Test Bunk Simulation with parsed schedule
  const bunkResult = calculatePlannerBunkSimulation({
    currentAttended: 20,
    currentTotal: 32,
    hypotheticalAttended: 0,
    hypotheticalBunked: 2, // bunk next 2 classes
    scheduledRemaining: netMetrics.scheduledRemaining,
    targetPercentage: 75,
  });
  assert(bunkResult.projectedTotal === 34, "Projected total classes incremented by 2");
  // TEST 8: Document Validation & Rejection of non-calendar / non-timetable files
  const invalidText = "Receipt #1049: Milk $4.00, Bread $2.50, Eggs $3.00. Total $9.50. Thank you for shopping!";
  
  let timetableRejected = false;
  try {
    parseTimetableDocument(invalidText, "receipt.pdf", agcSubjects);
  } catch (err) {
    timetableRejected = true;
  }
  assert(timetableRejected, "Non-timetable document correctly rejected with clear error");

  let calendarRejected = false;
  try {
    parseAcademicCalendarDocument(invalidText, "receipt.pdf");
  } catch (err) {
    calendarRejected = true;
  }
  assert(calendarRejected, "Non-calendar document correctly rejected with clear error");

  // TEST 9: Calendar-Aware Recovery Date Prediction
  const { calculateRecoveryDate, simulateSemesterProjection } = require("../src/lib/attendance-calculator");
  
  const upcomingInstances = allClasses.filter((c: any) => c.matchedSubjectCode === "AGC-18090");
  const recDateRes = calculateRecoveryDate(4, upcomingInstances);
  assert(recDateRes.reachable === true, "Recovery date is reachable for 4 classes");
  assert(Boolean(recDateRes.formattedDate), `Predicted recovery date formatted: ${recDateRes.formattedDate}`);
  assert(Boolean(recDateRes.recoveryDate), `Predicted recovery date: ${recDateRes.recoveryDate}`);

  // Test when needed > remaining
  const impossibleRecDate = calculateRecoveryDate(999, upcomingInstances);
  assert(impossibleRecDate.reachable === false, "Excessive recovery classes correctly marked unreachable");

  // TEST 10: Semester-End Projection & Safe Bunks Allowance
  const semProj = simulateSemesterProjection(20, 25, 20, 2, 75);
  assert(semProj.semesterTotalClasses === 45, "Semester total classes: 25 + 20 = 45");
  assert(semProj.bunksPlanned === 2, "Planned 2 bunks");
  assert(semProj.safeBunksTotal >= 0, `Computed safe semester bunks allowance: ${semProj.safeBunksTotal}`);
  assert(semProj.projectedPercentage > 0, `Projected final percentage: ${semProj.projectedPercentage}%`);

  console.log("\n🎉 ALL DOCUMENT PARSER, EXTRACTION & PREDICTION TESTS PASSED!\n");
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});

