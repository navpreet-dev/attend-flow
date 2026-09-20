"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, GraduationCap, HeartHandshake, Mail, ShieldCheck, User } from "lucide-react";

interface AboutDialogProps {
  children: React.ReactNode; // trigger
}

/**
 * Custom about / support sheet — deliberately built without Radix so it
 * never server-renders generated IDs (hydration-safe in the footer).
 * Sheet-style on mobile, centered dialog on desktop.
 */
export function AboutDialog({ children }: AboutDialogProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  return (
    <>
      <span onClick={() => setOpen(true)}>{children}</span>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="About AttendFlow">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={close}
              className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
            />

            {/* Panel — bottom sheet on mobile, centered on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 48, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.985 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl border border-border/60 bg-card p-6 shadow-2xl scrollbar-slim sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(30rem,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
            >
              <button
                type="button"
                onClick={close}
                aria-label="Close about dialog"
                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                autoFocus
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="space-y-5 pt-2">
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-600/25 ring-1 ring-emerald-700/20">
                    <GraduationCap className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <h2 className="font-display text-xl font-semibold tracking-tight">About AttendFlow</h2>
                  <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Autonomous attendance tracking for AGC ERP students. Live data
                    from the college portal — no manual entry, ever. Free for
                    every department, every course, every section.
                  </p>
                </div>

                <div className="h-px bg-border/70" />

                {/* Maker */}
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-500">
                    <User className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold tracking-tight">Built by Navpreet Singh</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Department of Computer Applications · BCA
                      <br />
                      Amritsar Group of Colleges
                    </p>
                  </div>
                </div>

                {/* Support / fund */}
                <div className="space-y-2.5 rounded-2xl border border-emerald-600/20 bg-emerald-600/[0.05] p-4">
                  <div className="flex items-center gap-2">
                    <HeartHandshake className="h-4 w-4 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
                    <p className="text-sm font-semibold tracking-tight">Support the project</p>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    AttendFlow is completely free for every AGC student. If it helps
                    you stay exam-eligible and saves you the daily portal login,
                    consider supporting the development — every contribution keeps
                    the servers running and the syncs fast.
                  </p>
                  <a
                    href="mailto:navpreet70095@gmail.com?subject=AttendFlow%20—%20Support%20the%20project"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-colors hover:bg-emerald-700"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    Contribute / Reach out
                  </a>
                </div>

                {/* Contact + honesty note */}
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-500">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold tracking-tight">Privacy &amp; honesty</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      AttendFlow only reads your own attendance from{" "}
                      <span className="font-mono text-[11px]">agclms.in</span> using the
                      credentials you enter. Passwords are stored AES-256 encrypted,
                      only if you opt in. Not an official AGC product.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Questions, feedback or a bug?{" "}
                      <a
                        href="mailto:navpreet70095@gmail.com"
                        className="font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                      >
                        navpreet70095@gmail.com
                      </a>
                    </p>
                  </div>
                </div>

                <p className="pt-1 text-center text-[11px] text-muted-foreground">
                  AttendFlow v1.0 · Made with intent, not templates
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
