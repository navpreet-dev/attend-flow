import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";

export async function PATCH(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { threshold?: number; autoSync?: boolean; notifyLow?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    threshold?: number;
    autoSync?: boolean;
    notifyLow?: boolean;
  } = {};

  if (typeof body.threshold === "number" && body.threshold >= 30 && body.threshold <= 100) {
    data.threshold = body.threshold;
  }
  if (typeof body.autoSync === "boolean") data.autoSync = body.autoSync;
  if (typeof body.notifyLow === "boolean") data.notifyLow = body.notifyLow;

  const updated = await db.student.update({ where: { id: student.id }, data });

  return NextResponse.json({
    threshold: updated.threshold,
    autoSync: updated.autoSync,
    notifyLow: updated.notifyLow,
    rememberMe: updated.rememberMe,
  });
}
