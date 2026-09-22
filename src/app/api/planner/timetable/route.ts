import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";
import { adaptLegacyTimetableEntries } from "@/lib/date-iteration-engine";

const DAY_NAME_TO_NUM: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    entries?: Array<{
      dayOfWeek: number;
      subjectCode: string;
      subjectName: string;
      startTime: string;
      endTime: string;
      room?: string | null;
      teacher?: string | null;
      matchedSubjectCode?: string | null;
      batch?: string | null;
      labGroup?: string | null;
    }>;
    sourceFileName?: string;
    /**
     * Explicit timetable off-days detected by Gemini AI (e.g. ["MONDAY"]).
     * Stored as comma-separated day numbers on the AcademicCalendar record
     * so the calculation engine can exclude them from "classes remaining."
     */
    offDays?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];
  const sourceFileName = body.sourceFileName?.trim() || null;

  // Convert string off-day names (e.g. "MONDAY") to day numbers (e.g. 1).
  // Validate, deduplicate, and clamp to 1–7.
  const rawOffDays = Array.isArray(body.offDays) ? body.offDays : [];
  const offDayNums = Array.from(
    new Set(
      rawOffDays
        .map((d) => {
          const upper = (d || "").toUpperCase().trim();
          // Accept either day name ("MONDAY") or numeric string ("1")
          if (DAY_NAME_TO_NUM[upper] !== undefined) return DAY_NAME_TO_NUM[upper];
          const n = parseInt(upper, 10);
          return !isNaN(n) && n >= 1 && n <= 7 ? n : null;
        })
        .filter((n): n is number => n !== null)
    )
  ).sort();

  const timetableOffDaysStr = offDayNums.join(",");

  try {
    await db.$transaction(async (tx) => {
      // 1. Replace timetable entries atomically
      await tx.timetableEntry.deleteMany({
        where: { studentId: student.id },
      });

      if (entries.length > 0) {
        const adapted = adaptLegacyTimetableEntries(entries as any);
        await tx.timetableEntry.createMany({
          data: adapted.map((e) => ({
            studentId: student.id,
            dayOfWeek: Math.min(7, Math.max(1, Math.floor(e.dayOfWeek || 1))),
            subjectCode: (e.subjectCode || "SUBJ").trim(),
            subjectName: (e.subjectName || "Subject").trim(),
            startTime: (e.startTime || "09:00").trim(),
            endTime: (e.endTime || "10:00").trim(),
            room: e.room?.trim() || null,
            teacher: e.teacher?.trim() || null,
            matchedSubjectCode: e.matchedSubjectCode?.trim() || null,
            batch: (e as any).batch?.trim() || null,
            sourceFileName,
          })),
        });
      }

      // 2. Persist timetable off-days to the student's AcademicCalendar record
      //    so the calculation engine can apply them in generateScheduledClasses().
      //    Only update if the student already has a calendar — if not, the off-days
      //    will be set when the calendar is uploaded later.
      const existingCalendar = await tx.academicCalendar.findUnique({
        where: { studentId: student.id },
        select: { id: true },
      });

      if (existingCalendar) {
        await tx.academicCalendar.update({
          where: { studentId: student.id },
          data: { timetableOffDays: timetableOffDaysStr },
        });
      } else {
        // No calendar yet — store off-days in a temporary marker on the student
        // record is not available, so we stash it as a side-effect-free no-op here.
        // The off-days will be applied when the calendar is saved via the
        // offDays patch in apiSaveCalendar (handled in planner route.ts POST).
        // We expose the offDays in the timetable save response so the client can
        // re-apply them once a calendar is saved.
      }
    });

    const updated = await db.timetableEntry.findMany({
      where: { studentId: student.id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    return NextResponse.json({ ok: true, timetable: updated, offDays: offDayNums });
  } catch (err) {
    console.error("[api/planner/timetable] Error saving timetable:", err);
    return NextResponse.json(
      { error: "Failed to save timetable entries." },
      { status: 500 }
    );
  }
}
