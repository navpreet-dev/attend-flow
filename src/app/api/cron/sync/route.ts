import { NextRequest, NextResponse } from "next/server";
import { runSchedulerTick } from "@/lib/scheduler-sync";

/**
 * Scheduled monitoring handler for Vercel Cron or external schedulers.
 * Protected by CRON_SECRET authorization header in production.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runSchedulerTick({ maxStudents: 50 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron-sync] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scheduler tick error" },
      { status: 500 }
    );
  }
}
