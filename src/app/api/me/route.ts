import { NextResponse } from "next/server";
import { getSessionStudent } from "@/lib/session";
import { getDashboardData } from "@/lib/sync-service";

export async function GET() {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  try {
    const payload = await getDashboardData(student.id);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
}
