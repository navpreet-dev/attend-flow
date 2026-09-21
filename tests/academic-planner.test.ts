import {
  generateScheduledClasses,
  calculateSubjectScheduleMetrics,
  calculatePlannerRecovery,
  calculatePlannerBunkSimulation,
  matchTimetableSubject,
  type AcademicCalendarConfig,
  type TimetableEntryItem,
} from "../src/lib/academic-planner";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✓ PASS: ${msg}`);
  }
}

console.log("--- RUNNING ACADEMIC PLANNER & TIMETABLE TESTS ---\n");

// Scenario 1: No timetable configured
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-08-01",
    endDate: "2026-12-15",
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  const emptyTimetable: TimetableEntryItem[] = [];
  const classes = generateScheduledClasses(calendar, emptyTimetable);
  assert(classes.length === 0, "Scenario 1: No timetable yields 0 scheduled classes");

  const metrics = calculateSubjectScheduleMetrics("CN101", null, []);
  assert(metrics.totalScheduled === 0, "Scenario 1: Metrics with null calendar yields 0 total");
  assert(metrics.scheduledRemaining === 0, "Scenario 1: Metrics with null calendar yields 0 remaining");
  assert(metrics.nextClass === null, "Scenario 1: Metrics with null calendar has no next class");
}

// Scenario 2: Timetable configured (Standard Mon-Fri 4 weeks = 20 weekdays)
{
  // 2026-09-01 is Tuesday, 2026-09-28 is Monday -> exactly 28 days = 4 weeks (20 weekdays)
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-01",
    endDate: "2026-09-28",
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  // Class every Monday (dayOfWeek = 1) at 10:00
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1, // Monday
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
  ];

  // In Sep 1 to Sep 28: Mondays are Sep 7, Sep 14, Sep 21, Sep 28 (4 Mondays)
  const classes = generateScheduledClasses(calendar, timetable, new Date("2026-08-31T00:00:00"));
  assert(classes.length === 4, `Scenario 2: Expected 4 Monday classes, got ${classes.length}`);
  assert(classes[0].date === "2026-09-07", `Scenario 2: First class on 2026-09-07, got ${classes[0].date}`);
  assert(classes[3].date === "2026-09-28", `Scenario 2: Last class on 2026-09-28, got ${classes[3].date}`);
}

// Scenario 3: Holiday removes a scheduled class
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-01",
    endDate: "2026-09-28",
    workingDays: [1, 2, 3, 4, 5],
    // Add holiday on Monday Sep 14
    holidays: [{ date: "2026-09-14", name: "Festival Holiday" }],
  };
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1, // Monday
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
  ];
  const classes = generateScheduledClasses(calendar, timetable, new Date("2026-08-31T00:00:00"));
  assert(classes.length === 3, `Scenario 3: Holiday on Sep 14 reduced classes from 4 to 3, got ${classes.length}`);
  const hasHolidayClass = classes.some((c) => c.date === "2026-09-14");
  assert(!hasHolidayClass, "Scenario 3: Class on 2026-09-14 was correctly excluded due to holiday");
}

// Scenario 4: Multiple weekly classes for the same subject
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-07", // Mon
    endDate: "2026-09-13", // Sun (1 week)
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1, // Monday 10:00
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
    {
      dayOfWeek: 3, // Wednesday 11:30
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "11:30",
      endTime: "12:30",
    },
    {
      dayOfWeek: 5, // Friday 14:00
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "14:00",
      endTime: "15:00",
    },
  ];
  const classes = generateScheduledClasses(calendar, timetable, new Date("2026-09-01T00:00:00"));
  assert(classes.length === 3, `Scenario 4: Expected 3 classes in 1 week, got ${classes.length}`);
  assert(classes[0].date === "2026-09-07", "Scenario 4: Monday class generated");
  assert(classes[1].date === "2026-09-09", "Scenario 4: Wednesday class generated");
  assert(classes[2].date === "2026-09-11", "Scenario 4: Friday class generated");
}

// Scenario 5: Subject mapping and unmapped subject handling
{
  const availablePortalSubjects = [
    { subjectCode: "BCS-501", subjectName: "Computer Networks" },
    { subjectCode: "BCS-502", subjectName: "Data Structures & Algorithms" },
    { subjectCode: "BCS-503", subjectName: "Operating Systems" },
  ];

  // Exact code match
  const match1 = matchTimetableSubject("BCS-501", availablePortalSubjects);
  assert(match1.matchedCode === "BCS-501" && match1.confidence === "exact", "Scenario 5: Exact code match");

  // Normalized name match ("computer networks" -> "BCS-501")
  const match2 = matchTimetableSubject("computer networks", availablePortalSubjects);
  assert(match2.matchedCode === "BCS-501" && match2.confidence === "exact", "Scenario 5: Case-insensitive name match");

  // Fuzzy normalized match ("Data Structures" -> "BCS-502")
  const match3 = matchTimetableSubject("Data Structures", availablePortalSubjects);
  assert(match3.matchedCode === "BCS-502" && match3.confidence === "normalized", "Scenario 5: Normalized substring match");

  // Completely unknown subject -> confidence "none", matchedCode null (Needs subject mapping)
  const matchUnknown = matchTimetableSubject("Quantum Robotics", availablePortalSubjects);
  assert(matchUnknown.matchedCode === null && matchUnknown.confidence === "none", "Scenario 5: Unmatched subject flagged as 'none'");
}

// Scenario 6: Required future attended classes vs remaining classes
{
  // Current: 20 attended out of 32 total = 62.5%
  // Target: 75%
  // Equation: (20 + R) / (32 + R) >= 0.75 -> 20 + R >= 24 + 0.75R -> 0.25R >= 4 -> R >= 16 needed
  // Scheduled remaining: 18 classes
  const recovery = calculatePlannerRecovery({
    attended: 20,
    total: 32,
    targetPercentage: 75,
    scheduledRemaining: 18,
  });

  assert(recovery.classesNeeded === 16, `Scenario 6: Expected 16 classes needed, got ${recovery.classesNeeded}`);
  assert(recovery.isReachable === true, "Scenario 6: 16 needed out of 18 remaining is reachable");
  assert(recovery.status === "RECOVERABLE", "Scenario 6: Status is RECOVERABLE");
  assert(recovery.scheduledRemaining === 18, "Scenario 6: Scheduled remaining recorded as 18");
}

// Scenario 7: Impossible recovery target (required > remaining)
{
  // Current: 20 / 32 = 62.5%, Target 75% -> needs 16 classes
  // But scheduled remaining is only 12 classes!
  const recovery = calculatePlannerRecovery({
    attended: 20,
    total: 32,
    targetPercentage: 75,
    scheduledRemaining: 12,
  });

  assert(recovery.classesNeeded === 16, "Scenario 7: Still correctly calculates 16 classes needed");
  assert(recovery.isReachable === false, "Scenario 7: 16 needed out of 12 remaining is NOT reachable");
  assert(recovery.status === "IMPOSSIBLE", "Scenario 7: Status is IMPOSSIBLE");
  // Max possible: (20 + 12) / (32 + 12) = 32 / 44 = 72.73%
  assert(recovery.maxPossiblePercentage === 72.73, `Scenario 7: Max possible is 72.73%, got ${recovery.maxPossiblePercentage}`);
}

// Scenario 8: Exact target reached (classes needed == remaining)
{
  // Current: 20 / 32, target 75% -> needs 16
  // Scheduled remaining: exactly 16
  const recovery = calculatePlannerRecovery({
    attended: 20,
    total: 32,
    targetPercentage: 75,
    scheduledRemaining: 16,
  });
  assert(recovery.isReachable === true, "Scenario 8: Exact 16 needed out of 16 is reachable");
  assert(recovery.maxPossiblePercentage === 75, "Scenario 8: Max possible is exactly 75%");
}

// Scenario 9: One hypothetical bunk simulation
{
  // Current: 23 attended / 28 total (82.14%), 10 classes remaining
  // Simulate 1 bunk (+0 attended, +1 total)
  const sim = calculatePlannerBunkSimulation({
    currentAttended: 23,
    currentTotal: 28,
    hypotheticalAttended: 0,
    hypotheticalBunked: 1,
    scheduledRemaining: 10,
    targetPercentage: 75,
  });

  // Projected: 23 / 29 = 79.31%
  assert(sim.projectedAttended === 23, "Scenario 9: Projected attended stays 23");
  assert(sim.projectedTotal === 29, "Scenario 9: Projected total becomes 29");
  assert(sim.projectedPercentage === 79.31, `Scenario 9: Projected % is 79.31%, got ${sim.projectedPercentage}`);
  assert(sim.classesRemainingAfterSim === 9, `Scenario 9: Classes remaining after 1 bunk is 9, got ${sim.classesRemainingAfterSim}`);
  assert(sim.isAboveTarget === true, "Scenario 9: 79.31% remains above 75%");
}

// Scenario 10: Multiple hypothetical bunks simulation
{
  // Current: 23 / 28 (82.14%), 10 classes remaining
  // Simulate 3 bunks (+0 attended, +3 total)
  const sim = calculatePlannerBunkSimulation({
    currentAttended: 23,
    currentTotal: 28,
    hypotheticalAttended: 0,
    hypotheticalBunked: 3,
    scheduledRemaining: 10,
    targetPercentage: 75,
  });

  // Projected: 23 / 31 = 74.19% (drops below 75%)
  assert(sim.projectedAttended === 23, "Scenario 10: Projected attended is 23");
  assert(sim.projectedTotal === 31, "Scenario 10: Projected total is 31");
  assert(sim.projectedPercentage === 74.19, `Scenario 10: Projected % is 74.19%, got ${sim.projectedPercentage}`);
  assert(sim.classesRemainingAfterSim === 7, `Scenario 10: Classes remaining after 3 bunks is 7, got ${sim.classesRemainingAfterSim}`);
  assert(sim.isAboveTarget === false, "Scenario 10: 74.19% drops below 75%");
}

// Scenario 11: Classes outside semester bounds (never counted)
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-01",
    endDate: "2026-09-10", // Only 10 days
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1, // Mondays
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
  ];
  // Mondays in Sep 2026: Sep 7, Sep 14, Sep 21, Sep 28
  // Between Sep 1 and Sep 10, only Sep 7 falls in range! Sep 14, 21, 28 are outside.
  const classes = generateScheduledClasses(calendar, timetable, new Date("2026-09-01T00:00:00"));
  assert(classes.length === 1, `Scenario 11: Only 1 class within semester range, got ${classes.length}`);
  assert(classes[0].date === "2026-09-07", "Scenario 11: Only Sep 7 was included");
}

// Scenario 12: Past vs future classes based on current date/time
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1, // Mondays: Sep 7, Sep 14, Sep 21, Sep 28
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
  ];
  // asOf is Sep 16, 2026 (between Sep 14 and Sep 21)
  const asOf = new Date("2026-09-16T12:00:00");
  const metrics = calculateSubjectScheduleMetrics("CN101", calendar, timetable, asOf);

  assert(metrics.totalScheduled === 4, `Scenario 12: Total scheduled is 4, got ${metrics.totalScheduled}`);
  assert(metrics.scheduledPassed === 2, `Scenario 12: Passed scheduled is 2 (Sep 7, 14), got ${metrics.scheduledPassed}`);
  assert(metrics.scheduledRemaining === 2, `Scenario 12: Remaining scheduled is 2 (Sep 21, 28), got ${metrics.scheduledRemaining}`);
  assert(metrics.nextClass?.date === "2026-09-21", `Scenario 12: Next class is Sep 21, got ${metrics.nextClass?.date}`);
}

// Scenario 13: Zero future classes remaining (semester completed)
{
  const calendar: AcademicCalendarConfig = {
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
  };
  const timetable: TimetableEntryItem[] = [
    {
      dayOfWeek: 1,
      subjectCode: "CN101",
      subjectName: "Computer Networks",
      startTime: "10:00",
      endTime: "11:00",
    },
  ];
  // asOf is after semester end (e.g. Sep 20)
  const asOf = new Date("2026-09-20T00:00:00");
  const metrics = calculateSubjectScheduleMetrics("CN101", calendar, timetable, asOf);

  assert(metrics.scheduledRemaining === 0, `Scenario 13: 0 classes remaining when past semester, got ${metrics.scheduledRemaining}`);
  assert(metrics.nextClass === null, "Scenario 13: Next class is null when 0 remaining");

  const recovery = calculatePlannerRecovery({
    attended: 25,
    total: 30,
    targetPercentage: 75,
    scheduledRemaining: 0,
  });
  assert(recovery.scheduledRemaining === 0, "Scenario 13: Recovery recognizes 0 remaining classes");
}

console.log("\n ALL 13 ACADEMIC PLANNER & TIMETABLE TESTS PASSED!\n");
