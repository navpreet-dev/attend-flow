import { db } from "../src/lib/db";
import { calculateRemainingClasses, isLaboratorySubject } from "../src/lib/date-iteration-engine";

async function runRealAudit() {
  const student = await db.student.findUnique({
    where: { rollNo: "2551508" },
    include: {
      subjects: true,
      academicCalendar: { include: { holidays: true } },
      timetableEntries: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
    },
  });

  if (!student) {
    console.error("Student 2551508 not found");
    return;
  }

  console.log(`\n========================================================================`);
  console.log(`  REAL-DATA PRODUCTION AUDIT: ${student.name} (${student.rollNo})`);
  console.log(`  Course: ${student.course} | Section: ${student.section}`);
  console.log(`========================================================================\n`);

  const timetable = student.timetableEntries.map((t) => ({
    ...t,
    matchedSubjectCode: t.matchedSubjectCode || t.subjectCode,
    isLab: isLaboratorySubject(t),
  }));

  const holidays = student.academicCalendar?.holidays || [];

  // Current real date/time in Asia/Kolkata
  const now = new Date();
  const res = calculateRemainingClasses(timetable, {
    asOf: now,
    additionalHolidays: holidays,
    group: "Unknown",
  });

  console.log(`As-of Date/Time (Asia/Kolkata): ${res.asOfDate} ${res.asOfTime}`);
  console.log(`Teaching End Date: ${res.teachingEndDate}`);
  console.log(`\n--- SUMMARY COUNTS ---`);
  console.log(`Theory Classes Remaining: ${res.theoryRemaining}`);
  console.log(`Total Classes Remaining by Group:`, res.totalRemainingByGroup);

  console.log(`\n--- SUBJECT AUDIT TABLE ---`);
  for (const s of student.subjects) {
    const audit = res.bySubject[s.subjectCode];
    const isLab = audit?.isLab || s.subjectType === "Practical" || s.subjectType === "Lab";
    console.log(`\nSubject: ${s.subjectName} (${s.subjectCode})`);
    console.log(`Type: ${s.subjectType} ${isLab ? "[LAB]" : "[THEORY]"}`);
    console.log(`Current Attendance: ${s.attended} / ${s.total} (${s.percentage.toFixed(1)}%)`);

    if (!audit) {
      console.log(`Remaining Classes: 0 (Not in timetable)`);
      console.log(`Counted Dates: []`);
      continue;
    }

    if (isLab) {
      console.log(`Remaining by Group:`, audit.remainingByGroup);
      console.log(`Counted Dates by Group:`, audit.countedDatesByGroup);
    } else {
      console.log(`Future Remaining Classes: ${audit.remainingClasses}`);
      console.log(`Counted Dates (${audit.countedDates.length}): [${audit.countedDates.join(", ")}]`);
    }
  }
}

runRealAudit().catch(console.error);
