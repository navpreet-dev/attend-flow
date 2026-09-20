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
  if (process.env.NEXT_PHASE === "phase-production-build") return;

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
      const { runSchedulerTick } = await import("@/lib/scheduler-sync");
      const result = await runSchedulerTick();
      console.log(
        `[attendflow-scheduler] Tick complete: ${result.synced} synced, ${result.skippedFresh} fresh, ${result.skippedCoolingDown} cooling down, ${result.errors} errors (${result.durationMs}ms)`
      );
    } catch (e) {
      console.error("[attendflow-scheduler] tick failed:", e);
    }
  }

  async function loop() {
    await tick();
    const t = setTimeout(loop, INTERVAL_MS);
    t.unref?.();
  }

  const initialTimer = setTimeout(() => void loop(), INITIAL_DELAY_MS);
  initialTimer.unref?.();
}
