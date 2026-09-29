"use client";

import { useMemo, useState } from "react";
import { formatTime12Hour, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Calendar,
  Coffee,
  CalendarCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PlannerState } from "@/lib/academic-planner-client";
import {
  getStandardDayOfWeek,
  toDateString,
} from "@/lib/academic-planner";
import {
  adaptLegacyTimetableEntries,
  isLaboratorySubject,
  extractEntryGroups,
  type UniversalTimetableEntry,
} from "@/lib/date-iteration-engine";

interface OverviewTimetableCardProps {
  plannerState: PlannerState | null;
  selectedGroup: "G1" | "G2" | "Both";
  onGroupChange: (group: "G1" | "G2" | "Both") => void;
  onOpenPlanner: () => void;
}

interface ProcessedClassItem {
  id: string;
  dayOfWeek: number;
  subjectCode: string;
  subjectName: string;
  matchedSubjectCode?: string | null;
  startTime: string;
  endTime: string;
  room?: string | null;
  teacher?: string | null;
  batch?: string | null;
  isLab: boolean;
  status: "in-progress" | "upcoming" | "completed" | "scheduled";
}

interface DayScheduleInfo {
  date: Date;
  dateStr: string;
  dayName: string;
  formattedDate: string;
  isHoliday: boolean;
  holidayName?: string;
  isOffDay: boolean;
  offDayReason?: string;
  classes: ProcessedClassItem[];
}

export function OverviewTimetableCard({
  plannerState,
  selectedGroup,
  onGroupChange,
  onOpenPlanner,
}: OverviewTimetableCardProps) {
  const [activeView, setActiveView] = useState<"today" | "tomorrow" | "both">("today");

  const now = new Date();
  const currentHours = String(now.getHours()).padStart(2, "0");
  const currentMinutes = String(now.getMinutes()).padStart(2, "0");
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  const { todayInfo, tomorrowInfo, hasAnyTimetable } = useMemo(() => {
    const rawTimetable = plannerState?.timetable || [];
    const hasAnyTimetable = rawTimetable.length > 0;

    const todayDate = new Date();
    const todayDateStr = toDateString(todayDate);
    const todayDayOfWeek = getStandardDayOfWeek(todayDate);

    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowDateStr = toDateString(tomorrowDate);
    const tomorrowDayOfWeek = getStandardDayOfWeek(tomorrowDate);

    const calendar = plannerState?.calendar;
    const holidayMap = new Map<string, string>();
    if (calendar?.holidays) {
      for (const h of calendar.holidays) {
        if (h.date) {
          holidayMap.set(h.date, h.name || "Academic Holiday");
        }
      }
    }

    const timetableOffDays = new Set<number>(calendar?.timetableOffDays || []);
    const workingDays = new Set<number>(
      calendar?.workingDays && calendar.workingDays.length > 0
        ? calendar.workingDays
        : [1, 2, 3, 4, 5]
    );

    // Adapt timetable entries dynamically for lab batches (G1/G2)
    const adaptedEntries: UniversalTimetableEntry[] = hasAnyTimetable
      ? adaptLegacyTimetableEntries(
          rawTimetable.map((t, idx) => ({
            id: t.id || `entry-${idx}`,
            dayOfWeek: t.dayOfWeek,
            subjectCode: t.subjectCode,
            subjectName: t.subjectName,
            matchedSubjectCode: t.matchedSubjectCode || t.subjectCode,
            startTime: t.startTime,
            endTime: t.endTime,
            room: t.room,
            teacher: t.teacher,
            batch: t.batch || (t as any).labGroup || null,
            isLab: isLaboratorySubject(t),
          }))
        )
      : [];

    // Helper to filter and build class items for a specific day
    const buildDaySchedule = (
      date: Date,
      dateStr: string,
      dayOfWeek: number,
      isToday: boolean
    ): DayScheduleInfo => {
      const isHoliday = holidayMap.has(dateStr);
      const holidayName = holidayMap.get(dateStr);

      const isTimetableOff = timetableOffDays.has(dayOfWeek);
      const isNonWorking = !workingDays.has(dayOfWeek);
      const isOffDay = isTimetableOff || isNonWorking;
      const offDayReason = isTimetableOff
        ? "Timetable Off Day (No lectures scheduled for your section)"
        : isNonWorking
        ? "Weekend / Non-working Day"
        : undefined;

      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const formattedDate = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      if (!hasAnyTimetable || isHoliday || isOffDay) {
        return {
          date,
          dateStr,
          dayName,
          formattedDate,
          isHoliday,
          holidayName,
          isOffDay,
          offDayReason,
          classes: [],
        };
      }

      // Filter classes for this day
      const dayClasses = adaptedEntries.filter((entry) => entry.dayOfWeek === dayOfWeek);

      // Filter by selected lab group
      const filtered = dayClasses.filter((entry) => {
        if (selectedGroup === "Both" || selectedGroup === ("Unknown" as any)) return true;
        const groups = extractEntryGroups(entry);
        if (!groups || groups.length === 0) return true;
        return groups.includes(selectedGroup);
      });

      // Sort by start time
      filtered.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

      const classes: ProcessedClassItem[] = filtered.map((c, idx) => {
        const isLab = Boolean(c.isLab || isLaboratorySubject(c));
        const startTime = c.startTime || "09:00";
        const endTime = c.endTime || c.startTime || "10:00";

        let status: "in-progress" | "upcoming" | "completed" | "scheduled" = "scheduled";
        if (isToday) {
          if (currentTimeStr >= startTime && currentTimeStr < endTime) {
            status = "in-progress";
          } else if (currentTimeStr < startTime) {
            status = "upcoming";
          } else {
            status = "completed";
          }
        }

        return {
          id: c.id || `class-${idx}`,
          dayOfWeek: c.dayOfWeek,
          subjectCode: c.subjectCode,
          subjectName: c.subjectName,
          matchedSubjectCode: c.matchedSubjectCode || c.subjectCode,
          startTime,
          endTime,
          room: c.room,
          teacher: c.teacher,
          batch: c.batch,
          isLab,
          status,
        };
      });

      return {
        date,
        dateStr,
        dayName,
        formattedDate,
        isHoliday,
        holidayName,
        isOffDay,
        offDayReason,
        classes,
      };
    };

    const todayInfo = buildDaySchedule(todayDate, todayDateStr, todayDayOfWeek, true);
    const tomorrowInfo = buildDaySchedule(tomorrowDate, tomorrowDateStr, tomorrowDayOfWeek, false);

    return { todayInfo, tomorrowInfo, hasAnyTimetable };
  }, [plannerState, selectedGroup, currentTimeStr]);

  // If no timetable has been uploaded at all, render a sleek setup invite
  if (!hasAnyTimetable) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CalendarDays className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight">
                  Daily Class Timetable
                </h3>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  · Not configured
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                Upload your class timetable in the Academic Planner to unlock live Today &amp; Tomorrow schedules, lecture rooms, and exact remaining classes.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onOpenPlanner}
            className="shrink-0 gap-1.5 text-xs font-semibold self-start sm:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upload Timetable
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // Count active classes
  const todayCount = todayInfo.classes.length;
  const tomorrowCount = tomorrowInfo.classes.length;

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3 min-w-0 transition-colors duration-150 ease-out">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 border-b border-border/50 pb-3">
        {/* Title and subtitle */}
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <CalendarCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="font-display font-semibold text-sm sm:text-base text-foreground tracking-tight">
                Class Timetable
              </h3>
            </div>
            <span className="text-xs text-muted-foreground">
              ({todayCount} Today · {tomorrowCount} Tomorrow)
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            Live schedule for today and tomorrow · synced with your weekly timetable
          </p>
        </div>

        {/* Controls: stacked on mobile, row on desktop */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2 w-full sm:w-auto">
          {/* Lab Group selector */}
          <div className="flex items-center gap-0.5 rounded-lg surface-inset p-0.5 text-xs min-h-9 sm:min-h-8 w-full sm:w-auto">
            <span className="px-2 text-[11px] font-medium text-muted-foreground shrink-0">Lab:</span>
            {(["Both", "G1", "G2"] as const).map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => onGroupChange(group)}
                className={cn(
                  "flex-1 sm:flex-initial rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-150 active:scale-[0.98] min-h-8 sm:min-h-7 flex items-center justify-center",
                  selectedGroup === group
                    ? "bg-background text-foreground border border-border/70 shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {group}
              </button>
            ))}
          </div>

          {/* View switcher: Today / Tomorrow / Side-by-Side */}
          <div className="flex items-center rounded-lg surface-inset p-0.5 text-xs min-h-9 sm:min-h-8 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveView("today")}
              className={cn(
                "flex-1 sm:flex-initial rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150 active:scale-[0.98] flex items-center justify-center gap-1 min-h-8 sm:min-h-7",
                activeView === "today"
                  ? "bg-background text-foreground border border-border/70 shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Today
              {todayCount > 0 && (
                <span className="ml-0.5 text-xs text-muted-foreground font-normal">
                  {todayCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("tomorrow")}
              className={cn(
                "flex-1 sm:flex-initial rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150 active:scale-[0.98] flex items-center justify-center gap-1 min-h-8 sm:min-h-7",
                activeView === "tomorrow"
                  ? "bg-background text-foreground border border-border/70 shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Tomorrow
              {tomorrowCount > 0 && (
                <span className="ml-0.5 text-xs text-muted-foreground font-normal">
                  {tomorrowCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("both")}
              className={cn(
                "flex-1 sm:flex-initial rounded-md px-2 py-1 text-xs font-semibold transition-colors duration-150 active:scale-[0.98] flex items-center justify-center whitespace-nowrap min-h-8 sm:min-h-7",
                activeView === "both"
                  ? "bg-background text-foreground border border-border/70 shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Side-by-Side
            </button>
          </div>

          {/* Planner button */}
          <div className="flex justify-start sm:justify-start w-full sm:w-auto">
            <button
              type="button"
              onClick={onOpenPlanner}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline flex items-center gap-1 min-h-9 py-1"
              title="View full weekly timetable & calendar"
            >
              Full Timetable <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <AnimatePresence mode="wait">
        {activeView === "both" ? (
          <motion.div
            key="both"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <DayScheduleCard dayInfo={todayInfo} isToday={true} />
            <DayScheduleCard dayInfo={tomorrowInfo} isToday={false} />
          </motion.div>
        ) : activeView === "today" ? (
          <motion.div
            key="today"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <DayScheduleCard dayInfo={todayInfo} isToday={true} isSingleView={true} />
          </motion.div>
        ) : (
          <motion.div
            key="tomorrow"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <DayScheduleCard dayInfo={tomorrowInfo} isToday={false} isSingleView={true} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DayScheduleCardProps {
  dayInfo: DayScheduleInfo;
  isToday: boolean;
  isSingleView?: boolean;
}

function DayScheduleCard({ dayInfo, isToday }: DayScheduleCardProps) {
  const { dayName, formattedDate, isHoliday, holidayName, isOffDay, offDayReason, classes } = dayInfo;

  return (
    <div className="space-y-2">
      {/* Day header banner */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isToday ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Today
            </span>
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">
              Tomorrow
            </span>
          )}
          <span className="text-xs font-medium text-foreground">· {dayName}</span>
          <span className="text-xs text-muted-foreground">({formattedDate})</span>
        </div>

        <div>
          {classes.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {classes.length} {classes.length === 1 ? "lecture" : "lectures"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              0 lectures
            </span>
          )}
        </div>
      </div>

      {/* Holiday state */}
      {isHoliday ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span>College Holiday</span>
          </div>
          <p className="text-xs font-semibold text-foreground">{holidayName || "Academic Holiday"}</p>
          <p className="text-[11px] text-muted-foreground">No classes scheduled on this date.</p>
        </div>
      ) : isOffDay ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coffee className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Off-Day</span>
          </div>
          <p className="text-xs font-medium text-foreground">{offDayReason || "No classes scheduled."}</p>
          <p className="text-[11px] text-muted-foreground">Enjoy your time off!</p>
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-center space-y-0.5">
          <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>No Classes</span>
          </div>
          <p className="text-xs text-muted-foreground">No timetable lectures found for {dayName}.</p>
        </div>
      ) : (
        /* Class list: responsive 2-line layout on mobile, 1-row on desktop */
        <div className="divide-y divide-border/50">
          {classes.map((cls) => {
            const isCompleted = cls.status === "completed";
            const isLive = cls.status === "in-progress";
            const meta = [cls.room, cls.teacher, cls.matchedSubjectCode].filter(Boolean).join(" · ");
            const typeLabel = cls.isLab ? `Lab${cls.batch ? ` (${cls.batch})` : ""}` : "Theory";

            return (
              <div
                key={cls.id}
                className={cn(
                  "py-2 text-xs transition-colors",
                  isLive && "bg-primary/[0.04] -mx-1.5 px-1.5 rounded-md"
                )}
              >
                {/* Mobile view (<sm): 2-line layout */}
                <div className="sm:hidden space-y-1">
                  {/* Line 1: Subject name + Status/Type */}
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        "line-clamp-2 text-xs font-medium min-w-0 flex-1 leading-snug",
                        isLive
                          ? "font-semibold text-foreground"
                          : isCompleted
                          ? "text-muted-foreground"
                          : "text-foreground"
                      )}
                      title={cls.subjectName}
                    >
                      {cls.subjectName}
                    </p>

                    <div className="flex items-center gap-1.5 shrink-0 text-right text-[11px] text-muted-foreground">
                      {isLive && (
                        <span className="inline-flex items-center gap-1 font-semibold text-primary">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                          Live
                        </span>
                      )}
                      {isCompleted && (
                        <span className="inline-flex items-center gap-0.5">
                          <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                          Completed
                        </span>
                      )}
                      {cls.status === "upcoming" && <span>Upcoming</span>}
                      <span>· {typeLabel}</span>
                    </div>
                  </div>

                  {/* Line 2: Time + room · faculty · code */}
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span className={cn("tabular-nums", isLive ? "font-semibold text-foreground" : "font-medium")}>
                      {formatTime12Hour(cls.startTime)} – {formatTime12Hour(cls.endTime)}
                    </span>
                    {meta && <span>· {meta}</span>}
                  </p>
                </div>

                {/* Desktop view (>=sm): 1-row layout */}
                <div className="hidden sm:flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="shrink-0 w-28 sm:w-32 text-left">
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          isLive
                            ? "font-semibold text-foreground"
                            : isCompleted
                            ? "text-muted-foreground"
                            : "font-medium text-foreground"
                        )}
                      >
                        {formatTime12Hour(cls.startTime)} – {formatTime12Hour(cls.endTime)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-xs sm:text-[13px]",
                          isLive
                            ? "font-semibold text-foreground"
                            : isCompleted
                            ? "text-muted-foreground"
                            : "font-medium text-foreground"
                        )}
                        title={cls.subjectName}
                      >
                        {cls.subjectName}
                      </p>
                      {meta && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {meta}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-right">
                    {isLive && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        Live
                      </span>
                    )}
                    {isCompleted && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                        Completed
                      </span>
                    )}
                    {cls.status === "upcoming" && (
                      <span className="text-[11px] text-muted-foreground">
                        Upcoming
                      </span>
                    )}

                    <span className="text-[11px] text-muted-foreground">
                      {typeLabel}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
