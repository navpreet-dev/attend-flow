"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
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
import { CalendarDays, ChevronRight, SkipForward, TrendingUp } from "lucide-react";

function pctColor(pct: number, threshold: number): "ok" | "warn" | "danger" {
  if (pct >= threshold) return "ok";
  if (pct >= threshold - 5) return "warn";
  return "danger";
}

const COLOR = {
  ok: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-500", badge: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border-emerald-600/20" },
  warn: { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  danger: { bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-500", badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20" },
} as const;

export function SubjectCard({
  subject,
  data,
  threshold,
  index,
}: {
  subject: SubjectInfo;
  data: DashboardPayload;
  threshold: number;
  index: number;
}) {
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4) }}
    >
      <Card className="card-premium h-full rounded-2xl border-border/60 transition-all hover:border-emerald-600/25 hover:shadow-lg hover:shadow-emerald-600/[0.06]">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold tracking-tight" title={subject.subjectName}>
                {subject.subjectName}
              </p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {subject.subjectType}
                {subject.subjectCode.startsWith("AGC-") && subject.saId ? ` · SAId ${subject.saId}` : ""}
              </p>
            </div>
            <Badge variant="outline" className={`shrink-0 rounded-full border font-display text-xs font-semibold ${c.badge}`}>
              {subject.percentage.toFixed(1)}%
            </Badge>
          </div>

          <div>
            <div className="flex items-baseline justify-between text-xs text-muted-foreground mb-1.5">
              <span>
                {subject.attended}/{subject.total} classes
              </span>
              <span className={c.text}>
                {subject.total === 0 ? "No classes yet" : level === "ok" ? "On track" : "Below target"}
              </span>
            </div>
            <Progress
              value={subject.percentage}
              aria-label={`${subject.subjectName} attendance ${subject.percentage.toFixed(1)} percent`}
              className="h-2 [&>div]:bg-current"
              style={{ color: level === "ok" ? "#10b981" : level === "warn" ? "#f59e0b" : "#f43f5e" }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {need > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                <TrendingUp className="h-3 w-3" aria-hidden="true" />
                Attend {need} in a row to reach {threshold}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-600/25 bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                <SkipForward className="h-3 w-3" aria-hidden="true" />
                Can skip {skip} and stay ≥ {threshold}%
              </span>
            )}
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="mt-auto w-full justify-between rounded-lg text-[13px] text-muted-foreground hover:text-foreground">
                View class log ({subjectLogs.length})
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{subject.subjectName}</DialogTitle>
                <DialogDescription>
                  {subject.attended} of {subject.total} classes attended ·{" "}
                  {subject.percentage.toFixed(1)}% attendance
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
                            l.status === "PRESENT"
                              ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                              : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          }
                        >
                          {l.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </motion.div>
  );
}
