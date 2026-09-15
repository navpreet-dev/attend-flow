"use client";

/**
 * Full-screen sync progress overlay for the login → attendance-sync flow.
 *
 * The login API is a single atomic request (by design — untouched), so the
 * overlay is driven by the REAL events the client can actually observe:
 *
 *   E0  submit          → request dispatched                (real)
 *   E1  response        → payload received / error          (real)
 *   E2  dashboard ready → parent swaps the view             (real)
 *
 * Stage labels mirror the actual backend pipeline in order (connect →
 * authenticate → fetch attendance → process → prepare dashboard). Early
 * boundaries are anchored to the portal's real, measured timings (pacing makes
 * authentication land in the first ~4–9s; the 9 paced subject-report fetches
 * are the long tail). The percentage is event-capped: it eases toward each
 * stage's ceiling and NEVER reaches 100% on its own — only a real server
 * response can complete it. If the portal stalls, the bar simply holds with
 * the spinner working; nothing fake is shown.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

export type SyncPhase =
  | "idle"
  | "connecting"
  | "authenticating"
  | "fetching"
  | "processing"
  | "preparing"
  | "done"
  | "fading";

const STAGES: { key: SyncPhase; label: string }[] = [
  { key: "connecting", label: "Connecting" },
  { key: "authenticating", label: "Authenticating" },
  { key: "fetching", label: "Fetching attendance" },
  { key: "processing", label: "Processing" },
  { key: "preparing", label: "Preparing dashboard" },
];

const PHASE_INDEX: Partial<Record<SyncPhase, number>> = {
  connecting: 0,
  authenticating: 1,
  fetching: 2,
  processing: 3,
  preparing: 4,
  done: STAGES.length,
};

/** Stage ceilings (%) — the bar holds at the cap until a real event advances it. */
const CAP: Partial<Record<SyncPhase, number>> = { connecting: 10, authenticating: 32, fetching: 84 };
/** Creep speed toward the ceiling (1/s, exponential ease — never overshoots). */
const RATE: Partial<Record<SyncPhase, number>> = { connecting: 5, authenticating: 1.6, fetching: 0.3 };
/** Real-flow anchors: auth request round-trip lands ~1.4–8s (paced); report
 *  fetching (9 paced requests) is everything after that. */
const AUTH_DONE_AT_MS = 1400;
const FETCH_STARTS_AT_MS = 8000;

export function useSyncProgress() {
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [view, setView] = useState<SyncPhase>("idle");
  const [percent, setPercent] = useState(0);

  const mounted = useRef(true);
  const phaseRef = useRef<SyncPhase>("idle");
  const pctRef = useRef(0);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0); // bumped on finish/fade to retire the creep loop

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  const setPhaseSafe = useCallback((p: SyncPhase) => {
    phaseRef.current = p;
    if (mounted.current) {
      setPhase(p);
      // `view` freezes on the last real stage while the overlay is fading out,
      // so stage rows don't flicker during the exit transition.
      if (p !== "fading" && p !== "idle") setView(p);
    }
  }, []);

  const setPctSafe = useCallback((v: number) => {
    pctRef.current = Math.min(100, Math.max(0, v));
    if (mounted.current) setPercent(pctRef.current);
  }, []);

  /**
   * Creep loop: advances the early phases on real elapsed time and eases the
   * bar toward the current stage's ceiling. It can never cross the fetching
   * cap (84%) or reach 100% on its own — only a real response completes it.
   */
  const creep = useCallback(() => {
    const myGen = gen.current;
    let last = performance.now();
    const step = (now: number) => {
      if (!mounted.current || gen.current !== myGen) return;
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      const elapsed = now - startedAt.current;
      if (phaseRef.current === "connecting" && elapsed >= AUTH_DONE_AT_MS) {
        setPhaseSafe("authenticating");
      } else if (phaseRef.current === "authenticating" && elapsed >= FETCH_STARTS_AT_MS) {
        setPhaseSafe("fetching");
      }
      const cap = CAP[phaseRef.current];
      const rate = RATE[phaseRef.current];
      if (cap !== undefined && rate !== undefined) {
        setPctSafe(pctRef.current + (cap - pctRef.current) * (1 - Math.exp(-rate * dt)));
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [setPhaseSafe, setPctSafe]);

  const begin = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    gen.current += 1;
    startedAt.current = performance.now();
    setPctSafe(0);
    setPhaseSafe("connecting");
    creep();
  }, [creep, setPhaseSafe, setPctSafe]);

  /** Tweens the bar to a target (ease-out cubic). Resolves early if unmounted. */
  const tweenTo = useCallback(
    (target: number, ms: number) =>
      new Promise<void>((resolve) => {
        const from = pctRef.current;
        const start = performance.now();
        const myGen = gen.current;
        const step = (now: number) => {
          if (!mounted.current || gen.current !== myGen) {
            resolve();
            return;
          }
          const p = Math.min(1, (now - start) / ms);
          const eased = 1 - Math.pow(1 - p, 3);
          setPctSafe(from + (target - from) * eased);
          if (p < 1) {
            raf.current = requestAnimationFrame(step);
          } else {
            resolve();
          }
        };
        raf.current = requestAnimationFrame(step);
      }),
    [setPctSafe]
  );

  /**
   * Called when the server has actually responded with the real payload:
   * Processing → Preparing dashboard → 100%. Resolves once the bar is full,
   * after which the caller reveals the dashboard beneath the overlay.
   */
  const finish = useCallback(async () => {
    if (phaseRef.current === "idle") return;
    gen.current += 1;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setPhaseSafe("processing");
    await tweenTo(92, 300);
    if (!mounted.current) return;
    setPhaseSafe("preparing");
    await tweenTo(100, 420);
    setPhaseSafe("done");
  }, [setPhaseSafe, tweenTo]);

  /** Fades the overlay away — used for both sync failure and the final reveal. */
  const fade = useCallback(() => {
    if (phaseRef.current === "idle") return;
    gen.current += 1;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    setPhaseSafe("fading");
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setPctSafe(0);
      setPhaseSafe("idle");
    }, 300);
  }, [setPhaseSafe, setPctSafe]);

  return { phase, view, percent, begin, finish, fade };
}

export function SyncProgressOverlay({
  phase,
  view,
  percent,
}: {
  phase: SyncPhase;
  view: SyncPhase;
  percent: number;
}) {
  if (phase === "idle") return null;

  const currentIdx = PHASE_INDEX[view] ?? STAGES.length;
  const shown = view === "done" ? 100 : Math.min(100, Math.floor(percent));
  const barWidth = view === "done" ? 100 : Math.min(100, percent);

  return (
    <div
      aria-busy={phase !== "fading"}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/75 px-4 backdrop-blur-md transition-opacity duration-300 ${
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <span role="status" aria-live="polite" className="sr-only">
        Syncing attendance: {view === "done" ? "finished" : `${STAGES[currentIdx]?.label ?? "working"} — ${shown} percent`}
      </span>

      <div className="card-premium w-full max-w-sm rounded-2xl border border-border/60 bg-card/95 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-600/25 ring-1 ring-emerald-700/20">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="font-display text-[15px] font-semibold tracking-tight">Syncing your attendance</p>
            <p className="text-xs text-muted-foreground">Live data from the AGC portal</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={shown}
              aria-label="Attendance sync progress"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className="w-10 text-right font-display text-[13px] font-semibold tabular-nums text-foreground">
              {shown}%
            </span>
          </div>

          <ul className="space-y-2.5 pt-1">
            {STAGES.map((s, i) => {
              const isDone = i < currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <li key={s.key} className="flex items-center gap-2.5">
                  {isDone ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600/10">
                      <Check
                        className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-500"
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    </span>
                  ) : isCurrent ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className="absolute inline-flex h-3.5 w-3.5 animate-ping rounded-full bg-emerald-500/25 motion-reduce:hidden" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-500" />
                    </span>
                  ) : (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className="h-1.5 w-1.5 rounded-full border border-foreground/25" />
                    </span>
                  )}
                  <span
                    className={`text-[13px] leading-none ${
                      isDone
                        ? "text-muted-foreground"
                        : isCurrent
                          ? "font-medium text-foreground"
                          : "text-muted-foreground/60"
                    }`}
                  >
                    {s.label}
                    {isCurrent ? "…" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
