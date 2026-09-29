"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { DashboardPayload, SubjectInfo } from "@/lib/types";
import { canSkip, mustAttend, parsePortalDate } from "@/lib/af-client";
import { CalendarDays } from "lucide-react";

function pctColor(pct: number, threshold: number): "ok" | "warn" | "danger" {
  if (pct >= threshold) return "ok";
  if (pct >= threshold - 5) return "warn";
  return "danger";
}

const COLOR = {
  ok: {
    text: "text-primary",
    bar: "var(--primary)",
    badge: "border-primary/25 bg-primary/10 text-primary",
  },
  warn: {
    text: "text-amber-600 dark:text-amber-400",
    bar: "#f59e0b",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  danger: {
    text: "text-rose-600 dark:text-rose-400",
    bar: "#f43f5e",
    badge: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
} as const;

export function SubjectCard({
  subject,
  data,
  threshold,
  index: _index,
  onOpenSimulator,
  scheduledRemaining,
  isGroupDivided,
  labRemaining,
  remainingByGroup,
  selectedGroup,
}: {
  subject: SubjectInfo;
  data: DashboardPayload;
  threshold: number;
  index: number;
  onOpenSimulator?: (code: string) => void;
  scheduledRemaining?: number | null;
  isGroupDivided?: boolean;
  labRemaining?: { G1: number; G2: number };
  remainingByGroup?: Record<string, number> | null;
  selectedGroup?: string;
}) {
  const isLab =
    Boolean(isGroupDivided) ||
    subject.subjectType === "Practical" ||
    subject.subjectType === "Lab" ||
    /lab|laboratory|practical/i.test(subject.subjectName) ||
    /lab|laboratory|practical/i.test(subject.subjectCode);
  const level = pctColor(subject.percentage, threshold);
  const c = COLOR[level];
  const need = mustAttend(subject.attended, subject.total, threshold);
  const skip = canSkip(subject.attended, subject.total, threshold);

  const subjectLogs = useMemo(
    () =>
      data.logs
        .filter((l) => l.subjectCode === subject.subjectCode)
        .sort((a, b) => parsePortalDate(b.date) - parsePortalDate(a.date)),
    [data.logs, subject.subjectCode]
  );

  const { presentCount, dutyLeaveCount, absentCount } = useMemo(() => {
    let p = 0, d = 0, a = 0;
    for (const l of subjectLogs) {
      if (l.status === "DUTY_LEAVE") d++;
      else if (l.status === "PRESENT") p++;
      else if (l.status === "ABSENT") a++;
    }
    return { presentCount: p, dutyLeaveCount: d, absentCount: a };
  }, [subjectLogs]);

  const remainingLabel = useMemo(() => {
    // If no calculation data exists at all, return empty
    if (
      typeof scheduledRemaining !== "number" &&
      !remainingByGroup &&
      !labRemaining
    ) {
      return "";
    }

    const groups = remainingByGroup || (labRemaining as Record<string, number> | undefined);
    const hasGroupSplits = Boolean(isGroupDivided && groups && Object.keys(groups).length > 0);

    // Condition B — Group-Divided Subjects (Labs / Tutorials with specific group splits)
    if (hasGroupSplits && groups) {
      const normToggle = (selectedGroup || "Both").trim().toUpperCase();

      if (normToggle === "G1") {
        const count = groups["G1"] !== undefined ? groups["G1"] : (typeof scheduledRemaining === "number" ? scheduledRemaining : 0);
        return ` · ${count} scheduled classes remain (G1)`;
      }

      if (normToggle === "G2") {
        const count = groups["G2"] !== undefined ? groups["G2"] : (typeof scheduledRemaining === "number" ? scheduledRemaining : 0);
        return ` · ${count} scheduled classes remain (G2)`;
      }

      if (
        normToggle !== "BOTH" &&
        normToggle !== "UNKNOWN" &&
        normToggle !== "" &&
        groups[normToggle] !== undefined
      ) {
        return ` · ${groups[normToggle]} scheduled classes remain (${selectedGroup})`;
      }

      // When toggle is set to "Both" (or "Unknown"): render full group distribution dynamically
      const entries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
      if (entries.length > 0) {
        const breakdown = entries.map(([g, count]) => `${g}: ${count}`).join(" · ");
        return ` · ${breakdown} scheduled classes remain`;
      }
    }

    // Condition A — Unified / Non-Group Subjects (Lectures, unified classes, electives)
    // Completely ignore selectedGroup toggle state! Never display G1/G2 text for lectures.
    if (typeof scheduledRemaining === "number") {
      return ` · ${scheduledRemaining} scheduled classes remain`;
    }

    return "";
  }, [scheduledRemaining, isGroupDivided, remainingByGroup, labRemaining, selectedGroup]);

  const remainingText = useMemo(() => {
    if (!remainingLabel) return "";
    return remainingLabel.replace(/^\s*·\s*/, "").trim();
  }, [remainingLabel]);

  return (
    <Card className="flex h-full min-w-0 flex-col rounded-xl border border-border/80 bg-card transition-colors duration-150 ease-out hover:border-border hover:bg-accent/10">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {/* Subject name & type */}
        <div className="min-w-0">
          <p
            className="line-clamp-2 text-base font-medium leading-snug tracking-tight"
            title={subject.subjectName}
          >
            {subject.subjectName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {subject.subjectType}
            {subject.subjectCode.startsWith("AGC-") && subject.saId ? ` · SAId ${subject.saId}` : ""}
          </p>
        </div>

        {/* Hero percentage & status */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`font-display text-3xl font-bold tabular-nums sm:text-4xl ${c.text}`}>
              {subject.percentage.toFixed(1)}%
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {subject.total === 0 ? "No classes yet" : level === "ok" ? "On track" : "Below target"}
            </span>
          </div>
          <Progress
            value={subject.percentage}
            aria-label={`${subject.subjectName} attendance ${subject.percentage.toFixed(1)} percent`}
            className="h-1 [&>div]:bg-current"
            style={{ color: c.bar }}
          />
        </div>

        {/* Attendance counts & remaining */}
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{subject.attended}/{subject.total} classes attended</p>
          {remainingText ? <p>{remainingText}</p> : null}
        </div>

        {/* Status guidance line: plain text-xs, no border, no bg, colored by status */}
        <div>
          {need > 0 ? (
            <p className={`text-xs font-medium ${c.text}`}>
              Attend {need} in a row to reach {threshold}%
            </p>
          ) : (
            <p className={`text-xs font-medium ${c.text}`}>
              Can skip {skip} and stay ≥ {threshold}%
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-10 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Class log ({subjectLogs.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{subject.subjectName}</DialogTitle>
                <DialogDescription>
                  {subject.attended} of {subject.total} classes attended ·{" "}
                  {subject.percentage.toFixed(1)}% attendance
                  {dutyLeaveCount > 0 && (
                    <span className="block mt-1 text-xs text-muted-foreground">
                      {presentCount} Present · {dutyLeaveCount} Duty Leave · {absentCount} Absent
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <ScrollArea className="max-h-[50vh] pr-3 [&>[data-slot=scroll-area-viewport]]:max-h-[50vh]">
                {subjectLogs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No dated class records found on the portal for this subject.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {subjectLogs.map((l, i) => (
                      <li
                        key={`${l.date}-${i}`}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                          {l.date}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            l.status === "DUTY_LEAVE"
                              ? "border-border bg-muted/60 text-muted-foreground font-medium"
                              : l.status === "PRESENT"
                              ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                              : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          }
                        >
                          {l.status === "DUTY_LEAVE" ? "Duty Leave" : l.status === "PRESENT" ? "Present" : "Absent"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </DialogContent>
          </Dialog>

          {onOpenSimulator && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-10 rounded-lg px-3.5 text-xs font-medium"
              onClick={() => onOpenSimulator(subject.subjectCode)}
              title="Open What-If Simulator for this subject"
            >
              Simulate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

