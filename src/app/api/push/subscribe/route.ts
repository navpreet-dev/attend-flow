import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionStudent } from "@/lib/session";

/** Saves (or refreshes) a Web Push subscription for the signed-in student. */
export async function POST(req: NextRequest) {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Incomplete subscription." }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent")?.slice(0, 250) ?? null;

  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { studentId: student.id, endpoint, p256dh, auth, userAgent },
    update: { studentId: student.id, p256dh, auth, userAgent },
  });

  return NextResponse.json({ ok: true });
}
