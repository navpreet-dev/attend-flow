import "server-only";
import { db } from "@/lib/db";
import { syncStudent } from "@/lib/sync-service";
import { isPortalCoolingDown } from "@/lib/portal";
import { sendPushToStudent } from "@/lib/push-server";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
const GAP_BETWEEN_STUDENTS_MS = 3_000; // 3-second gentle gap between distinct students

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Concurrency lock to prevent overlapping runs across serverless / instrumentation instances
let isRunning = false;

export interface SchedulerTickResult {
  totalEligible: number;
  synced: number;
  skippedCoolingDown: number;
  skippedFresh: number;
  errors: number;
  durationMs: number;
}

/**
 * Executes a single scheduled synchronization and alert pass across all
 * eligible students who have an active, non-expired AttendFlow session.
 */
export async function runSchedulerTick(options: { maxStudents?: number } = {}): Promise<SchedulerTickResult> {
  const startTime = Date.now();
  const maxStudents = options.maxStudents ?? 25;

  if (isRunning) {
    return {
      totalEligible: 0,
      synced: 0,
      skippedCoolingDown: 0,
      skippedFresh: 0,
      errors: 0,
      durationMs: Date.now() - startTime,
    };
  }

  isRunning = true;
  let synced = 0;
  let skippedCoolingDown = 0;
  let skippedFresh = 0;
  let errors = 0;

  try {
    const now = new Date();

    // Query only students with active sessions (session not expired) & valid autoSync consent
    const students = await db.student.findMany({
      where: {
        rememberMe: true,
        autoSync: true,
        NOT: { passwordEnc: null },
        sessions: {
          some: {
            expiresAt: { gt: now },
          },
        },
      },
      select: {
        id: true,
        notifyLow: true,
        threshold: true,
        lastSyncAt: true,
      },
      take: maxStudents,
    });

    const lastStateKey = globalThis as typeof globalThis & { __lastNotifiedStates?: Map<string, string> };
    if (!lastStateKey.__lastNotifiedStates) {
      lastStateKey.__lastNotifiedStates = new Map<string, string>();
    }
    const notifiedMap = lastStateKey.__lastNotifiedStates;

    for (const s of students) {
      // Only touch portal if our cached snapshot is older than STALE_AFTER_MS
      if (s.lastSyncAt && Date.now() - s.lastSyncAt.getTime() < STALE_AFTER_MS) {
        skippedFresh += 1;
        continue;
      }

      // Check portal circuit breaker
      if (isPortalCoolingDown()) {
        skippedCoolingDown += 1;
        continue;
      }

      // Database-backed atomic claim: update lastSyncAt conditionally so concurrent
      // serverless instances or background tasks cannot double-sync the same student.
      const claimed = await db.student.updateMany({
        where: {
          id: s.id,
          OR: [
            { lastSyncAt: s.lastSyncAt },
            { lastSyncAt: null },
          ],
        },
        data: {
          lastSyncAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        // Another instance claimed this student simultaneously
        skippedFresh += 1;
        continue;
      }

      try {
        const payload = await syncStudent(s.id, { force: false, purpose: "background" });
        synced += 1;

        if (s.notifyLow && payload.subjects.length > 0) {
          const low = payload.subjects.filter(
            (x) => x.total > 0 && x.percentage < payload.settings.threshold
          );
          const currentStateSignature = payload.subjects
            .map((x) => `${x.subjectCode}:${x.attended}/${x.total}`)
            .join("|");

          const previousSignature = notifiedMap.get(s.id);

          // Only send notification if numbers actually changed
          if (currentStateSignature !== previousSignature) {
            notifiedMap.set(s.id, currentStateSignature);

            try {
              if (low.length > 0) {
                const worst = low[0];
                await sendPushToStudent(s.id, {
                  title: "Attendance Warning",
                  body:
                    low.length === 1
                      ? `${worst.subjectName} is at ${worst.percentage.toFixed(1)}% (below ${payload.settings.threshold}%). Attend upcoming classes to stay eligible.`
                      : `${low.length} subjects are below ${payload.settings.threshold}%. Lowest: ${worst.subjectName} at ${worst.percentage.toFixed(1)}%.`,
                  tag: "attendflow-low-attendance",
                  url: "/",
                });
              } else if (previousSignature) {
                const allGood = payload.subjects.every((x) => x.percentage >= payload.settings.threshold);
                if (allGood) {
                  await sendPushToStudent(s.id, {
                    title: "Attendance Status: On Track",
                    body: `Great news! All your subjects are currently above the ${payload.settings.threshold}% attendance requirement.`,
                    tag: "attendflow-safe-status",
                    url: "/",
                  });
                }
              }
            } catch (pushErr) {
              /* Push failure must never break attendance sync */
              console.error("[scheduler] Push send error:", pushErr);
            }
          }
        }
      } catch (err) {
        errors += 1;
        console.error(`[scheduler] Student ${s.id} sync failed:`, err);
      }

      await sleep(GAP_BETWEEN_STUDENTS_MS);
    }

    return {
      totalEligible: students.length,
      synced,
      skippedCoolingDown,
      skippedFresh,
      errors,
      durationMs: Date.now() - startTime,
    };
  } finally {
    isRunning = false;
  }
}
