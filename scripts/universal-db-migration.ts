import { db } from "../src/lib/db";
import { adaptLegacyTimetableEntries, isLaboratorySubject } from "../src/lib/date-iteration-engine";

/**
 * Universal Database Migration Script
 *
 * Scans timetable records for ALL existing students in the database.
 * Detects laboratory and group-split sessions across ANY department, course, or section
 * (e.g. BCA, B.Tech, BBA, GNM, Pharmacy) and persists the resolved batch/group tags (G1, G2, etc.)
 * directly into the database.
 */
async function runUniversalMigration() {
  console.log("========================================================================");
  console.log("  STARTING UNIVERSAL DATABASE NORMALIZATION MIGRATION");
  console.log("========================================================================\n");

  const students = await db.student.findMany({
    include: {
      timetableEntries: {
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      },
    },
  });

  console.log(`Found ${students.length} students in the database.\n`);

  let totalUpdated = 0;

  for (const student of students) {
    const entries = student.timetableEntries;
    if (entries.length === 0) {
      console.log(`- Student: ${student.name} (${student.rollNo}) [${student.course || "N/A"} - ${student.section || "N/A"}]: 0 timetable entries. Skipping.`);
      continue;
    }

    console.log(`- Processing: ${student.name} (${student.rollNo}) [${student.course || "N/A"} - ${student.section || "N/A"}]: ${entries.length} entries`);

    // Map entries to UniversalTimetableEntry format
    const universalEntries = entries.map((e) => ({
      id: e.id,
      dayOfWeek: e.dayOfWeek,
      subjectCode: e.subjectCode,
      subjectName: e.subjectName,
      startTime: e.startTime,
      endTime: e.endTime,
      room: e.room,
      teacher: e.teacher,
      matchedSubjectCode: e.matchedSubjectCode,
      batch: e.batch,
      isLab: isLaboratorySubject(e),
    }));

    // Run through universal legacy adaptation
    const adapted = adaptLegacyTimetableEntries(universalEntries);

    let studentUpdated = 0;

    for (const item of adapted) {
      if (item.id && item.batch) {
        const original = entries.find((e) => e.id === item.id);
        if (original && original.batch !== item.batch) {
          await db.timetableEntry.update({
            where: { id: item.id },
            data: { batch: item.batch },
          });
          studentUpdated++;
          totalUpdated++;
          console.log(
            `    ✓ Updated ${item.subjectName} (Day ${item.dayOfWeek} ${item.startTime}): batch -> "${item.batch}"`
          );
        }
      }
    }

    console.log(`    -> ${studentUpdated} entries updated for ${student.name}.\n`);
  }

  console.log("========================================================================");
  console.log(`  MIGRATION COMPLETE: ${totalUpdated} total timetable entries updated across all students.`);
  console.log("========================================================================\n");
}

runUniversalMigration()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
