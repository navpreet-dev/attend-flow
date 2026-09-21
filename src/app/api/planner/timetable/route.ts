import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";

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
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];

  try {
    // Replace student's timetable entries atomically
    await db.$transaction(async (tx) => {
      await tx.timetableEntry.deleteMany({
        where: { studentId: student.id },
      });

      if (entries.length > 0) {
        await tx.timetableEntry.createMany({
          data: entries.map((e) => ({
            studentId: student.id,
            dayOfWeek: Math.min(7, Math.max(1, Math.floor(e.dayOfWeek || 1))),
            subjectCode: (e.subjectCode || "SUBJ").trim(),
            subjectName: (e.subjectName || "Subject").trim(),
            startTime: (e.startTime || "09:00").trim(),
            endTime: (e.endTime || "10:00").trim(),
            room: e.room?.trim() || null,
            teacher: e.teacher?.trim() || null,
            matchedSubjectCode: e.matchedSubjectCode?.trim() || null,
          })),
        });
      }
    });

    const updated = await db.timetableEntry.findMany({
      where: { studentId: student.id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    return NextResponse.json({ ok: true, timetable: updated });
  } catch (err) {
    console.error("[api/planner/timetable] Error saving timetable:", err);
    return NextResponse.json(
      { error: "Failed to save timetable entries." },
      { status: 500 }
    );
  }
}
