import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";
import {
  calculateSubjectScheduleMetrics,
  type AcademicCalendarConfig,
  type TimetableEntryItem,
} from "@/lib/academic-planner";

export async function GET() {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const calendar = await db.academicCalendar.findUnique({
      where: { studentId: student.id },
      include: { holidays: true },
    });

    const timetable = await db.timetableEntry.findMany({
      where: { studentId: student.id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    if (!calendar) {
      return NextResponse.json({
        configured: false,
        calendar: null,
        timetable: [],
      });
    }

    const workingDays = calendar.workingDays
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const calendarConfig: AcademicCalendarConfig = {
      startDate: calendar.startDate,
      endDate: calendar.endDate,
      workingDays,
      holidays: calendar.holidays.map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
      })),
    };

    const timetableItems: TimetableEntryItem[] = timetable.map((t) => ({
      id: t.id,
      dayOfWeek: t.dayOfWeek,
      subjectCode: t.subjectCode,
      subjectName: t.subjectName,
      startTime: t.startTime,
      endTime: t.endTime,
      room: t.room,
      teacher: t.teacher,
      matchedSubjectCode: t.matchedSubjectCode,
    }));

    return NextResponse.json({
      configured: true,
      calendar: calendarConfig,
      calendarSourceFileName: calendar.sourceFileName,
      timetable: timetableItems,
      timetableSourceFileName: timetable[0]?.sourceFileName || null,
    });
  } catch (err) {
    console.error("[api/planner] Error fetching planner data:", err);
    return NextResponse.json(
      { error: "Failed to fetch academic planner data" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    startDate?: string;
    endDate?: string;
    workingDays?: number[];
    holidays?: { date: string; name?: string }[];
    sourceFileName?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const startDate = (body.startDate || "").trim();
  const endDate = (body.endDate || "").trim();
  const workingDays =
    Array.isArray(body.workingDays) && body.workingDays.length > 0
      ? body.workingDays
      : [1, 2, 3, 4, 5];
  const holidays = Array.isArray(body.holidays) ? body.holidays : [];
  const sourceFileName = body.sourceFileName?.trim() || null;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "Semester start date and end date are required." },
      { status: 400 }
    );
  }

  if (startDate > endDate) {
    return NextResponse.json(
      { error: "Start date must be before or equal to end date." },
      { status: 400 }
    );
  }

  try {
    const workingDaysStr = workingDays.join(",");

    // Upsert the student's academic calendar
    const calendar = await db.academicCalendar.upsert({
      where: { studentId: student.id },
      create: {
        studentId: student.id,
        startDate,
        endDate,
        workingDays: workingDaysStr,
        sourceFileName,
      },
      update: {
        startDate,
        endDate,
        workingDays: workingDaysStr,
        sourceFileName,
      },
    });

    // Sync holidays: delete existing and re-create
    await db.academicHoliday.deleteMany({
      where: { calendarId: calendar.id },
    });

    if (holidays.length > 0) {
      // De-duplicate holidays by date
      const uniqueHolidays = Array.from(
        new Map(holidays.map((h) => [h.date.trim(), h])).values()
      ).filter((h) => Boolean(h.date.trim()));

      if (uniqueHolidays.length > 0) {
        await db.academicHoliday.createMany({
          data: uniqueHolidays.map((h) => ({
            calendarId: calendar.id,
            date: h.date.trim(),
            name: h.name?.trim() || null,
          })),
        });
      }
    }

    const updated = await db.academicCalendar.findUnique({
      where: { id: calendar.id },
      include: { holidays: true },
    });

    return NextResponse.json({ ok: true, calendar: updated });
  } catch (err) {
    console.error("[api/planner] Error saving calendar:", err);
    return NextResponse.json(
      { error: "Failed to save academic calendar." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Delete academic calendar (cascades to holidays)
    await db.academicCalendar.deleteMany({
      where: { studentId: student.id },
    });
    // Delete timetable entries
    await db.timetableEntry.deleteMany({
      where: { studentId: student.id },
    });

    return NextResponse.json({ ok: true, message: "Academic planner cleared." });
  } catch (err) {
    console.error("[api/planner] Error deleting planner:", err);
    return NextResponse.json(
      { error: "Failed to clear academic planner." },
      { status: 500 }
    );
  }
}
