"use client";

import { useMemo, useState } from "react";
import { formatTime12Hour, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Clock3,
  MapPin,
  User,
  FlaskConical,
  BookOpen,
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
      <div className="card-premium rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-primary/[0.03] p-4 sm:p-5 shadow-xs transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight">
                  Daily Class Timetable
                </h3>
                <Badge variant="outline" className="text-[10px] uppercase font-mono px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400">
                  Not Configured
                </Badge>
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
            className="shrink-0 gap-1.5 text-xs font-semibold self-start sm:self-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
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
    <div className="card-premium rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-card via-card/95 to-emerald-500/[0.03] p-4 sm:p-5 shadow-xs space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-semibold text-sm sm:text-base text-foreground tracking-tight">
                Class Timetable
              </h3>
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                {todayCount} Today · {tomorrowCount} Tomorrow
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Live schedule for today and tomorrow · synced with your weekly timetable
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
          {/* Lab Group selector */}
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5 text-xs">
            <span className="px-1.5 text-[10px] font-medium text-muted-foreground uppercase">Lab:</span>
            {(["Both", "G1", "G2"] as const).map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => onGroupChange(group)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all",
                  selectedGroup === group
                    ? "bg-emerald-600 text-white shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {group}
              </button>
            ))}
          </div>

          {/* View switcher: Today / Tomorrow / Both */}
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveView("today")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-all flex items-center gap-1",
                activeView === "today"
                  ? "bg-background text-foreground shadow-2xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Today
              {todayCount > 0 && (
                <span className="ml-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                  {todayCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("tomorrow")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-all flex items-center gap-1",
                activeView === "tomorrow"
                  ? "bg-background text-foreground shadow-2xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Tomorrow
              {tomorrowCount > 0 && (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground font-mono">
                  {tomorrowCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveView("both")}
              className={cn(
                "hidden sm:flex rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                activeView === "both"
                  ? "bg-background text-foreground shadow-2xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Side-by-Side
            </button>
          </div>

          {/* Planner button */}
          <button
            type="button"
            onClick={onOpenPlanner}
            className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 shrink-0 ml-1"
            title="View full weekly timetable & calendar"
          >
            Full Timetable <ArrowRight className="h-3 w-3" />
          </button>
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

function DayScheduleCard({ dayInfo, isToday, isSingleView }: DayScheduleCardProps) {
  const { dayName, formattedDate, isHoliday, holidayName, isOffDay, offDayReason, classes } = dayInfo;

  return (
    <div className="rounded-xl border border-border/70 bg-card/70 p-3.5 sm:p-4 space-y-3">
      {/* Day header banner */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex items-center gap-2">
          <Badge
            variant={isToday ? "default" : "secondary"}
            className={cn(
              "text-[11px] font-bold uppercase tracking-wider px-2 py-0.5",
              isToday
                ? "bg-emerald-600 hover:bg-emerald-600 text-white shadow-2xs"
                : "bg-muted text-foreground font-semibold"
            )}
          >
            {isToday ? "Today" : "Tomorrow"}
          </Badge>
          <span className="text-xs font-semibold text-foreground">
            {dayName}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            ({formattedDate})
          </span>
        </div>

        <div>
          {classes.length > 0 ? (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 font-mono">
              {classes.length} {classes.length === 1 ? "lecture" : "lectures"}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic">
              0 lectures
            </span>
          )}
        </div>
      </div>

      {/* Holiday state */}
      {isHoliday ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold text-xs">
            <Sparkles className="h-4 w-4" />
            <span>College Holiday</span>
          </div>
          <p className="text-sm font-medium text-foreground">{holidayName || "Academic Holiday"}</p>
          <p className="text-[11px] text-muted-foreground">No classes scheduled on this date.</p>
        </div>
      ) : isOffDay ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground font-semibold text-xs">
            <Coffee className="h-4 w-4 text-emerald-500" />
            <span>Off-Day</span>
          </div>
          <p className="text-xs font-medium text-foreground">{offDayReason || "No classes scheduled."}</p>
          <p className="text-[11px] text-muted-foreground">Enjoy your time off!</p>
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground font-semibold text-xs">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>No Classes</span>
          </div>
          <p className="text-xs text-muted-foreground">No timetable lectures found for {dayName}.</p>
        </div>
      ) : (
        /* Class list */
        <div className={cn("space-y-2", isSingleView && "grid grid-cols-1 sm:grid-cols-2 gap-2 space-y-0")}>
          {classes.map((cls) => (
            <div
              key={cls.id}
              className={cn(
                "group relative rounded-xl border p-3 transition-all text-xs",
                cls.status === "in-progress"
                  ? "border-emerald-500 bg-emerald-500/[0.08] shadow-xs ring-1 ring-emerald-500/30"
                  : cls.status === "completed"
                  ? "border-border/50 bg-muted/25 opacity-75"
                  : "border-border/70 bg-card hover:border-emerald-500/40 hover:bg-emerald-500/[0.02]"
              )}
            >
              {/* Top row: Time & Status */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono font-semibold text-foreground text-[11px]">
                    {formatTime12Hour(cls.startTime)} – {formatTime12Hour(cls.endTime)}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  {cls.status === "in-progress" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 animate-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live Now
                    </span>
                  )}
                  {cls.status === "completed" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      Completed
                    </span>
                  )}
                  {cls.status === "upcoming" && (
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                      Upcoming
                    </span>
                  )}

                  {/* Lab vs Theory badge */}
                  {cls.isLab ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[10px] px-1.5 py-0"
                    >
                      <FlaskConical className="h-2.5 w-2.5 mr-0.5 inline" />
                      Lab {cls.batch ? `(${cls.batch})` : ""}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] px-1.5 py-0"
                    >
                      <BookOpen className="h-2.5 w-2.5 mr-0.5 inline" />
                      Theory
                    </Badge>
                  )}
                </div>
              </div>

              {/* Subject Title */}
              <div className="font-semibold text-foreground text-xs sm:text-[13px] line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" title={cls.subjectName}>
                {cls.subjectName}
              </div>

              {/* Subject Code + Location + Faculty */}
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                {cls.matchedSubjectCode && (
                  <span className="font-mono font-medium text-foreground/80 bg-muted/60 px-1 rounded text-[10px]">
                    {cls.matchedSubjectCode}
                  </span>
                )}
                {cls.room && (
                  <span className="flex items-center gap-1 text-foreground/90 font-medium">
                    <MapPin className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate max-w-[120px]">{cls.room}</span>
                  </span>
                )}
                {cls.teacher && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <User className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[120px]">{cls.teacher}</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
