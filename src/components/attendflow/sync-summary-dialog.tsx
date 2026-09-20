"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { SyncSummary } from "@/lib/sync-summary";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { fmtDateTime } from "@/lib/af-client";

interface SyncSummaryDialogProps {
  summary: SyncSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSimulator?: (subjectCode?: string) => void;
}

export function SyncSummaryDialog({
  summary,
  open,
  onOpenChange,
  onOpenSimulator,
}: SyncSummaryDialogProps) {
  if (!summary) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-semibold tracking-tight">
                {summary.isInitialSync ? "Initial Sync Complete" : "After-Sync Summary"}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 text-xs">
                <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                {fmtDateTime(summary.syncedAt)} · {summary.totalSubjects} subjects refreshed
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        <div className="space-y-4 text-sm">
          {/* Top Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Overall
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums">
                {summary.overallNextPercentage.toFixed(1)}%
              </p>
              {!summary.isInitialSync && summary.overallDeltaPercentage !== 0 && (
                <span
                  className={`inline-flex items-center text-[11px] font-semibold ${
                    summary.overallDeltaPercentage > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {summary.overallDeltaPercentage > 0 ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {summary.overallDeltaPercentage > 0 ? "+" : ""}
                  {summary.overallDeltaPercentage.toFixed(1)}%
                </span>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Improved
              </p>
              <p className="mt-0.5 font-display text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {summary.improvedCount}
              </p>
              <p className="text-[11px] text-muted-foreground">subjects</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Dropped
              </p>
              <p
                className={`mt-0.5 font-display text-lg font-bold tabular-nums ${
                  summary.decreasedCount > 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground"
                }`}
              >
                {summary.decreasedCount}
              </p>
              <p className="text-[11px] text-muted-foreground">subjects</p>
            </div>
          </div>

          {/* Changed Subjects Section */}
          {summary.changedSubjects.length > 0 ? (
            <div>
              <p className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attendance Changes Today
              </p>
              <ScrollArea className="max-h-48 pr-2 [&>[data-slot=scroll-area-viewport]]:max-h-48">
                <ul className="space-y-2">
                  {summary.changedSubjects.map((s) => (
                    <li
                      key={s.subjectCode}
                      className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="truncate font-semibold text-foreground">
                          {s.subjectName}
                        </p>
                        <p className="text-muted-foreground">
                          {s.prevAttended}/{s.prevTotal} → {s.nextAttended}/{s.nextTotal} classes
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {s.prevPercentage.toFixed(1)}% →
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            s.status === "IMPROVED"
                              ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-semibold"
                              : s.status === "DECREASED"
                              ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-semibold"
                              : "text-muted-foreground"
                          }
                        >
                          {s.status === "IMPROVED" && <ArrowUpRight className="mr-0.5 h-3 w-3" />}
                          {s.status === "DECREASED" && <ArrowDownRight className="mr-0.5 h-3 w-3" />}
                          {s.nextPercentage.toFixed(1)}% ({s.deltaPercentage >= 0 ? "+" : ""}
                          {s.deltaPercentage.toFixed(1)}%)
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              {summary.isInitialSync
                ? "All enrolled subjects successfully loaded from the AGC portal."
                : "No attendance changes recorded on the portal since the last sync."}
            </div>
          )}

          {/* Critical Warnings if any */}
          {summary.criticalSubjects.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  {summary.criticalSubjects.length} subject
                  {summary.criticalSubjects.length === 1 ? "" : "s"} below target
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                {summary.criticalSubjects
                  .map((s) => `${s.subjectName} (${s.percentage.toFixed(1)}% · need ${s.mustAttendCount})`)
                  .join(" · ")}
              </p>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-end gap-2">
          {onOpenSimulator && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                onOpenChange(false);
                onOpenSimulator();
              }}
            >
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              Simulate Scenarios
            </Button>
          )}
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
