/**
 * Next.js instrumentation — starts the AttendFlow background sync scheduler
 * once per server process. It REUSES the existing sync pipeline unchanged
 * (syncStudent from @/lib/sync-service) and only adds a periodic driver plus
 * Web Push delivery for low-attendance alerts.
 *
 * Cadence: initial pass ~90s after boot, then every 6 hours, one student at
 * a time with a 3s gap — gentle on the college portal even with many users.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __attendflowScheduler?: boolean };
  if (g.__attendflowScheduler) return;
  g.__attendflowScheduler = true;

  const INITIAL_DELAY_MS = 90_000;
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
  const GAP_BETWEEN_STUDENTS_MS = 60_000; // generous gap — the portal firewall runs a volume limiter

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function tick() {
    try {
      const { db } = await import("@/lib/db");
      const { syncStudent } = await import("@/lib/sync-service");
      const { isPortalCoolingDown } = await import("@/lib/portal");
      const { sendPushToStudent } = await import("@/lib/push-server");

      const students = await db.student.findMany({
        where: { rememberMe: true, autoSync: true, NOT: { passwordEnc: null } },
        select: { id: true, notifyLow: true, threshold: true, lastSyncAt: true },
      });

      for (const s of students) {
        // Only touch the portal when our snapshot is stale.
        if (s.lastSyncAt && Date.now() - s.lastSyncAt.getTime() < STALE_AFTER_MS) continue;
        // Circuit breaker open? Skip this student entirely — waiting here and poking
        // the portal would only keep the firewall's limiter alive. The next tick
        // (or a later student slot) picks them up.
        if (isPortalCoolingDown()) {
          console.log("[attendflow-scheduler] portal cooling down — skipping student", s.id);
          continue;
        }
        try {
          const payload = await syncStudent(s.id, { force: false, purpose: "background" });
          console.log(
            "[attendflow-scheduler] synced student",
            s.id,
            "-",
            payload.subjects.length,
            "subjects"
          );
          if (s.notifyLow) {
            const low = payload.subjects.filter(
              (x) => x.total > 0 && x.percentage < payload.settings.threshold
            );
            if (low.length > 0) {
              const worst = low[0];
              await sendPushToStudent(s.id, {
                title: "Low attendance warning",
                body:
                  low.length === 1
                    ? `${worst.subjectName} is at ${worst.percentage.toFixed(1)}% (below ${payload.settings.threshold}%). Attend next classes to recover.`
                    : `${low.length} subjects are below ${payload.settings.threshold}%. Lowest: ${worst.subjectName} at ${worst.percentage.toFixed(1)}%.`,
                tag: "attendflow-low-attendance",
                url: "/",
              });
            }
          }
        } catch (e) {
          // Single student failing (portal down, password changed, rate limit)
          // must never stop the rest of the queue.
          console.log(
            "[attendflow-scheduler] sync failed for student",
            s.id,
            "-",
            e instanceof Error ? e.message : e
          );
        }
        await sleep(GAP_BETWEEN_STUDENTS_MS);
      }
    } catch (e) {
      console.error("[attendflow-scheduler] tick failed:", e);
    }
  }

  async function loop() {
    await tick();
    setTimeout(loop, INTERVAL_MS);
  }

  setTimeout(() => void loop(), INITIAL_DELAY_MS);
}
