import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";

/** Removes a Web Push subscription (called when alerts are turned off). */
export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (body.endpoint) {
    await db.pushSubscription
      .deleteMany({ where: { endpoint: body.endpoint, studentId: student.id } })
      .catch(() => {});
  } else {
    await db.pushSubscription
      .deleteMany({ where: { studentId: student.id } })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
