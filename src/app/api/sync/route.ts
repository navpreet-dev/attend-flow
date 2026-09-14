import { NextResponse } from "next/server";
import { getSessionStudent } from "@/lib/session";
import { syncStudent, getDashboardData, RateLimitError } from "@/lib/sync-service";
import { PortalError } from "@/lib/portal";

/**
 * Re-scrapes the college portal using the stored (encrypted) credentials.
 * If sync fails but we have cached data, we return it with an `error` note
 * so the UI keeps working — never a dead dashboard.
 */
export async function POST() {
  const student = await getSessionStudent();
  if (!student) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const payload = await syncStudent(student.id, { force: false });
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof RateLimitError) {
      const payload = await getDashboardData(student.id).catch(() => null);
      return NextResponse.json(
        {
          ...(payload ?? { authenticated: true }),
          error: `${e.message} Showing your latest saved data.`,
        },
        { status: 200 }
      );
    }
    if (e instanceof PortalError) {
      // Invalid stored credentials => force re-login; other failures => serve cache.
      const cached = await getDashboardData(student.id).catch(() => null);
      if (cached && e.code !== "INVALID_CREDENTIALS") {
        return NextResponse.json(
          { ...cached, error: `Sync failed: ${e.message} Showing your latest saved data.` },
          { status: 200 }
        );
      }
      return NextResponse.json({ error: e.message }, { status: e.code === "INVALID_CREDENTIALS" ? 401 : 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error while syncing with the college portal." },
      { status: 500 }
    );
  }
}
