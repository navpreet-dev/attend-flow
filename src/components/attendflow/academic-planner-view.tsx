"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  CalendarDays,
  CalendarCheck,
  Clock,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Copy,
  Info,
  Save,
  RotateCcw,
  Sparkles,
  Calendar,
  Layers,
  BookOpen,
  MapPin,
  User,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DashboardPayload } from "@/lib/types";
import {
  matchTimetableSubject,
  calculateSubjectScheduleMetrics,
  calculatePlannerRecovery,
  type AcademicCalendarConfig,
  type TimetableEntryItem,
  type HolidayItem,
  type ScheduledClassInstance,
} from "@/lib/academic-planner";
import {
  apiGetPlanner,
  apiSaveCalendar,
  apiSaveTimetable,
  apiClearPlanner,
  type PlannerState,
} from "@/lib/academic-planner-client";

interface AcademicPlannerViewProps {
  data: DashboardPayload;
  onPlannerUpdated?: () => void;
}

const DAYS = [
  { id: 1, label: "Monday", short: "Mon" },
  { id: 2, label: "Tuesday", short: "Tue" },
  { id: 3, label: "Wednesday", short: "Wed" },
  { id: 4, label: "Thursday", short: "Thu" },
  { id: 5, label: "Friday", short: "Fri" },
  { id: 6, label: "Saturday", short: "Sat" },
  { id: 7, label: "Sunday", short: "Sun" },
];

export function AcademicPlannerView({ data, onPlannerUpdated }: AcademicPlannerViewProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [plannerState, setPlannerState] = useState<PlannerState>({
    configured: false,
    calendar: null,
    timetable: [],
  });

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<"overview" | "timetable" | "calendar">("overview");

  // Calendar form state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState<string>("");
  const [newHolidayName, setNewHolidayName] = useState<string>("");

  // Timetable form state
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntryItem[]>([]);

  // Class modal state
  const [isAddClassOpen, setIsAddClassOpen] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [classSubjectName, setClassSubjectName] = useState("");
  const [classSubjectCode, setClassSubjectCode] = useState("");
  const [classMatchedCode, setClassMatchedCode] = useState<string>("");
  const [classStartTime, setClassStartTime] = useState("09:00");
  const [classEndTime, setClassEndTime] = useState("10:00");
  const [classRoom, setClassRoom] = useState("");
  const [classTeacher, setClassTeacher] = useState("");

  // Fetch planner on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const res = await apiGetPlanner();
        if (cancelled) return;
        setPlannerState(res);
        if (res.calendar) {
          setStartDate(res.calendar.startDate);
          setEndDate(res.calendar.endDate);
          setWorkingDays(res.calendar.workingDays || [1, 2, 3, 4, 5]);
          setHolidays(res.calendar.holidays || []);
        } else {
          // Defaults: current semester (approx. 4 months from now)
          const today = new Date();
          const y = today.getFullYear();
          const m = today.getMonth();
          const start = new Date(y, m, 1);
          const end = new Date(y, m + 4, 0);
          setStartDate(start.toISOString().split("T")[0]);
          setEndDate(end.toISOString().split("T")[0]);
        }
        if (res.timetable) {
          setTimetableEntries(res.timetable);
        }
      } catch (e) {
        console.error("Failed to load planner:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync calendar form save
  async function handleSaveCalendar() {
    if (!startDate || !endDate) {
      toast.error("Please enter semester start and end dates.");
      return;
    }
    if (startDate > endDate) {
      toast.error("Start date must be before or equal to end date.");
      return;
    }
    try {
      setSaving(true);
      await apiSaveCalendar({
        startDate,
        endDate,
        workingDays,
        holidays,
      });
      const updated = await apiGetPlanner();
      setPlannerState(updated);
      toast.success("Academic calendar saved successfully.");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save calendar.");
    } finally {
      setSaving(false);
    }
  }

  // Add holiday handler
  function handleAddHoliday() {
    if (!newHolidayDate) {
      toast.error("Please choose a holiday date.");
      return;
    }
    if (holidays.some((h) => h.date === newHolidayDate)) {
      toast.error("This holiday date is already added.");
      return;
    }
    setHolidays([
      ...holidays,
      {
        id: Math.random().toString(36).substring(2, 9),
        date: newHolidayDate,
        name: newHolidayName.trim() || "Holiday",
      },
    ]);
    setNewHolidayDate("");
    setNewHolidayName("");
  }

  // Remove holiday handler
  function handleRemoveHoliday(date: string) {
    setHolidays(holidays.filter((h) => h.date !== date));
  }

  // Working day toggle
  function handleToggleWorkingDay(dayId: number) {
    if (workingDays.includes(dayId)) {
      if (workingDays.length === 1) {
        toast.error("At least one working day must be selected.");
        return;
      }
      setWorkingDays(workingDays.filter((d) => d !== dayId));
    } else {
      setWorkingDays([...workingDays, dayId].sort());
    }
  }

  // Timetable entry modal handlers
  function openAddClassModal(entry?: TimetableEntryItem) {
    if (entry) {
      setEditingClassId(entry.id || null);
      setClassSubjectName(entry.subjectName);
      setClassSubjectCode(entry.subjectCode);
      setClassMatchedCode(entry.matchedSubjectCode || "");
      setClassStartTime(entry.startTime);
      setClassEndTime(entry.endTime);
      setClassRoom(entry.room || "");
      setClassTeacher(entry.teacher || "");
    } else {
      setEditingClassId(null);
      setClassSubjectName("");
      setClassSubjectCode("");
      setClassMatchedCode("");
      setClassStartTime("09:00");
      setClassEndTime("10:00");
      setClassRoom("");
      setClassTeacher("");
    }
    setIsAddClassOpen(true);
  }

  function handleSaveClassModal() {
    const name = classSubjectName.trim();
    if (!name) {
      toast.error("Please enter a subject name.");
      return;
    }

    // Determine matched code if not explicitly selected
    let finalMatched = classMatchedCode;
    if (!finalMatched) {
      const autoMatch = matchTimetableSubject(name, data.subjects);
      if (autoMatch.confidence !== "none" && autoMatch.matchedCode) {
        finalMatched = autoMatch.matchedCode;
      }
    }

    const code = classSubjectCode.trim() || finalMatched || name.substring(0, 6).toUpperCase();

    const newEntry: TimetableEntryItem = {
      id: editingClassId || `tmp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      dayOfWeek: selectedDay,
      subjectCode: code,
      subjectName: name,
      startTime: classStartTime,
      endTime: classEndTime,
      room: classRoom.trim() || null,
      teacher: classTeacher.trim() || null,
      matchedSubjectCode: finalMatched || null,
    };

    let updated: TimetableEntryItem[];
    if (editingClassId) {
      updated = timetableEntries.map((e) => (e.id === editingClassId ? newEntry : e));
    } else {
      updated = [...timetableEntries, newEntry];
    }

    setTimetableEntries(updated);
    setIsAddClassOpen(false);
  }

  function handleDeleteClass(id?: string) {
    if (!id) return;
    setTimetableEntries(timetableEntries.filter((e) => e.id !== id));
  }

  function handleDuplicateClass(entry: TimetableEntryItem) {
    const duplicated: TimetableEntryItem = {
      ...entry,
      id: `tmp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    };
    setTimetableEntries([...timetableEntries, duplicated]);
    toast.success(`Duplicated ${entry.subjectName}`);
  }

  async function handleSaveTimetable() {
    try {
      setSaving(true);
      await apiSaveTimetable(timetableEntries);
      const updated = await apiGetPlanner();
      setPlannerState(updated);
      toast.success("Timetable saved successfully.");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save timetable.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearAll() {
    if (
      !confirm(
        "Are you sure you want to remove your academic calendar and timetable? AttendFlow will revert to standard unassisted mode."
      )
    ) {
      return;
    }
    try {
      setSaving(true);
      await apiClearPlanner();
      setPlannerState({ configured: false, calendar: null, timetable: [] });
      setTimetableEntries([]);
      toast.success("Academic planner cleared.");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear planner.");
    } finally {
      setSaving(false);
    }
  }

  // Filter timetable for currently selected day
  const currentDayClasses = useMemo(() => {
    return timetableEntries
      .filter((e) => e.dayOfWeek === selectedDay)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [timetableEntries, selectedDay]);

  // Derived calendar config
  const activeCalendarConfig: AcademicCalendarConfig | null = useMemo(() => {
    if (!startDate || !endDate) return null;
    return {
      startDate,
      endDate,
      workingDays,
      holidays,
    };
  }, [startDate, endDate, workingDays, holidays]);

  // Pre-calculate recovery insights across all portal subjects
  const subjectInsights = useMemo(() => {
    if (!activeCalendarConfig || timetableEntries.length === 0) return [];

    return data.subjects.map((s) => {
      const metrics = calculateSubjectScheduleMetrics(
        s.subjectCode,
        activeCalendarConfig,
        timetableEntries
      );
      const recovery = calculatePlannerRecovery({
        attended: s.attended,
        total: s.total,
        targetPercentage: data.settings.threshold,
        scheduledRemaining: metrics.scheduledRemaining,
      });

      return {
        subject: s,
        metrics,
        recovery,
      };
    });
  }, [data.subjects, activeCalendarConfig, timetableEntries, data.settings.threshold]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Explanation */}
      <Card className="card-premium rounded-2xl border-border/60 bg-gradient-to-r from-emerald-500/[0.04] to-teal-500/[0.04]">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full font-medium">
                  Optional Feature
                </Badge>
                <span className="text-xs text-muted-foreground">Planning calculation tool</span>
              </div>
              <h2 className="font-display text-xl font-bold tracking-tight">Academic Planner &amp; Timetable</h2>
              <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Optional — add your semester calendar and weekly timetable to get precise future scheduled-class
                counts, intelligent recovery feasibility, and enhanced bunk simulations.
              </p>
            </div>

            {plannerState.configured && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={saving}
                className="self-start text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 sm:self-center"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Reset Planner
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sub Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
        <TabsList className="h-10 w-full justify-start rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="overview" className="gap-1.5 rounded-lg px-3 text-xs sm:text-sm">
            <Layers className="h-3.5 w-3.5" /> Overview &amp; Insights
          </TabsTrigger>
          <TabsTrigger value="timetable" className="gap-1.5 rounded-lg px-3 text-xs sm:text-sm">
            <Clock className="h-3.5 w-3.5" /> Weekly Timetable ({timetableEntries.length})
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5 rounded-lg px-3 text-xs sm:text-sm">
            <Calendar className="h-3.5 w-3.5" /> Academic Calendar
          </TabsTrigger>
        </TabsList>

        {/* -------------------------------- OVERVIEW TAB -------------------------------- */}
        <TabsContent value="overview" className="mt-0 space-y-6">
          {!plannerState.configured && timetableEntries.length === 0 ? (
            <Card className="rounded-2xl border-dashed border-border/80">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-600 mb-3">
                  <CalendarCheck className="h-6 w-6" />
                </div>
                <h3 className="font-display text-base font-semibold">No Academic Planner Configured</h3>
                <p className="mt-1 max-w-md text-xs text-muted-foreground sm:text-sm">
                  AttendFlow is currently operating in standard unassisted mode. Configure your semester dates and
                  weekly timetable to unlock future class forecasting.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => setActiveTab("calendar")} size="sm" className="rounded-xl">
                    1. Set Academic Calendar
                  </Button>
                  <Button onClick={() => setActiveTab("timetable")} variant="outline" size="sm" className="rounded-xl">
                    2. Add Timetable
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card className="card-premium rounded-2xl border-border/60 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Semester Range</p>
                  <p className="mt-1 font-display text-lg font-semibold">
                    {startDate || "—"} to {endDate || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{holidays.length} holiday(s) configured</p>
                </Card>

                <Card className="card-premium rounded-2xl border-border/60 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Weekly Schedule</p>
                  <p className="mt-1 font-display text-lg font-semibold">
                    {timetableEntries.length} class{timetableEntries.length === 1 ? "" : "es"} / week
                  </p>
                  <p className="text-xs text-muted-foreground">{workingDays.length} working days active</p>
                </Card>

                <Card className="card-premium rounded-2xl border-border/60 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Mapped Subjects</p>
                  <p className="mt-1 font-display text-lg font-semibold">
                    {subjectInsights.filter((i) => i.metrics.totalScheduled > 0).length} of {data.subjects.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Scheduled in timetable</p>
                </Card>
              </div>

              {/* Subject Recovery Table */}
              <Card className="card-premium rounded-2xl border-border/60 overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Subject-Wise Recovery Feasibility</CardTitle>
                  <CardDescription className="text-xs">
                    Mathematical projections based on your entered timetable and {data.settings.threshold}% attendance
                    target.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-y border-border/70 bg-muted/40 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Subject</th>
                          <th className="px-4 py-3">Current</th>
                          <th className="px-4 py-3">Scheduled Remaining</th>
                          <th className="px-4 py-3">Needed</th>
                          <th className="px-4 py-3">Feasibility</th>
                          <th className="px-4 py-3">Next Class</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {subjectInsights.map(({ subject, metrics, recovery }) => (
                          <tr key={subject.subjectCode} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 font-medium">
                              <p className="truncate max-w-[200px]" title={subject.subjectName}>
                                {subject.subjectName}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-mono">{subject.subjectCode}</p>
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {subject.percentage.toFixed(1)}%
                              <span className="text-muted-foreground ml-1">
                                ({subject.attended}/{subject.total})
                              </span>
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {metrics.scheduledRemaining > 0 ? (
                                <span className="font-semibold">{metrics.scheduledRemaining} classes</span>
                              ) : (
                                <span className="text-muted-foreground italic">None scheduled</span>
                              )}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {recovery.classesNeeded > 0 ? (
                                <span className="font-semibold text-amber-600 dark:text-amber-400">
                                  {recovery.classesNeeded} in a row
                                </span>
                              ) : (
                                <span className="text-emerald-600 dark:text-emerald-400">0 (Safe)</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {recovery.status === "ALREADY_ABOVE" && (
                                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                  Safe · On Track
                                </Badge>
                              )}
                              {recovery.status === "RECOVERABLE" && (
                                <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                                  Reachable ({metrics.scheduledRemaining - recovery.classesNeeded} buffer)
                                </Badge>
                              )}
                              {recovery.status === "IMPOSSIBLE" && (
                                <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400">
                                  Impossible (Max {recovery.maxPossiblePercentage.toFixed(1)}%)
                                </Badge>
                              )}
                              {recovery.status === "NO_CLASSES" && (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  No classes yet
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {metrics.nextClass ? (
                                <span>
                                  {metrics.nextClass.date} ({metrics.nextClass.startTime})
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* -------------------------------- TIMETABLE TAB -------------------------------- */}
        <TabsContent value="timetable" className="mt-0 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => {
                const count = timetableEntries.filter((e) => e.dayOfWeek === day.id).length;
                return (
                  <Button
                    key={day.id}
                    variant={selectedDay === day.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDay(day.id)}
                    className="rounded-xl text-xs"
                  >
                    {day.short}
                    {count > 0 && (
                      <span className="ml-1.5 rounded-full bg-background/20 px-1.5 py-0.2 text-[10px] font-bold">
                        {count}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => openAddClassModal()} size="sm" className="rounded-xl gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Class
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveTimetable}
                disabled={saving}
                className="rounded-xl gap-1.5"
              >
                <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>

          {/* Classes for Selected Day */}
          <div className="space-y-3">
            {currentDayClasses.length === 0 ? (
              <Card className="rounded-2xl border-dashed border-border/70">
                <CardContent className="py-10 text-center text-xs text-muted-foreground sm:text-sm">
                  No classes scheduled for {DAYS.find((d) => d.id === selectedDay)?.label}.
                  <div className="mt-3">
                    <Button onClick={() => openAddClassModal()} variant="outline" size="sm" className="rounded-xl">
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a Class for this day
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {currentDayClasses.map((entry) => {
                  const hasMapping = Boolean(entry.matchedSubjectCode);
                  return (
                    <Card
                      key={entry.id}
                      className="card-premium rounded-2xl border-border/60 transition-all hover:border-emerald-600/30"
                    >
                      <CardContent className="p-4 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-sm tracking-tight" title={entry.subjectName}>
                              {entry.subjectName}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono">
                              {entry.startTime} – {entry.endTime}
                            </p>
                          </div>
                          {hasMapping ? (
                            <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                              Mapped
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]">
                              Needs mapping
                            </Badge>
                          )}
                        </div>

                        {(entry.room || entry.teacher) && (
                          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground pt-1">
                            {entry.room && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> {entry.room}
                              </span>
                            )}
                            {entry.teacher && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" /> {entry.teacher}
                              </span>
                            )}
                          </div>
                        )}

                        <Separator className="my-1.5" />

                        <div className="flex items-center justify-between pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDuplicateClass(entry)}
                            className="h-7 px-2 text-xs text-muted-foreground"
                            title="Duplicate class to same day"
                          >
                            <Copy className="h-3 w-3 mr-1" /> Duplicate
                          </Button>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openAddClassModal(entry)}
                              className="h-7 px-2 text-xs"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClass(entry.id)}
                              className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* -------------------------------- CALENDAR TAB -------------------------------- */}
        <TabsContent value="calendar" className="mt-0 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Semester Dates & Working Days Card */}
            <Card className="card-premium rounded-2xl border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Semester Timeline</CardTitle>
                <CardDescription className="text-xs">
                  Define your semester date bounds and normal college working days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="start-date" className="text-xs font-medium">
                      Semester Start Date
                    </Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="rounded-xl text-xs h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="end-date" className="text-xs font-medium">
                      Semester End Date
                    </Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="rounded-xl text-xs h-9"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Label className="text-xs font-medium">College Working Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d) => {
                      const isSelected = workingDays.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => handleToggleWorkingDay(d.id)}
                          className={`rounded-xl px-3 py-1.5 text-xs font-medium border transition-colors ${
                            isSelected
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-background text-muted-foreground border-border/70 hover:bg-muted"
                          }`}
                        >
                          {d.short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  onClick={handleSaveCalendar}
                  disabled={saving}
                  size="sm"
                  className="w-full rounded-xl gap-1.5 mt-2"
                >
                  <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Calendar"}
                </Button>
              </CardContent>
            </Card>

            {/* Holidays & Non-Working Dates */}
            <Card className="card-premium rounded-2xl border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Holidays &amp; Non-Working Dates</CardTitle>
                <CardDescription className="text-xs">
                  Classes falling on these dates will be excluded from scheduled remaining calculations.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={newHolidayDate}
                    onChange={(e) => setNewHolidayDate(e.target.value)}
                    className="rounded-xl text-xs h-9 flex-1"
                  />
                  <Input
                    type="text"
                    placeholder="Holiday Name (e.g. Diwali)"
                    value={newHolidayName}
                    onChange={(e) => setNewHolidayName(e.target.value)}
                    className="rounded-xl text-xs h-9 flex-1"
                  />
                  <Button onClick={handleAddHoliday} size="sm" variant="secondary" className="rounded-xl shrink-0">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {holidays.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground italic">
                      No holidays added yet.
                    </p>
                  ) : (
                    holidays
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((h) => (
                        <div
                          key={h.date}
                          className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-semibold text-foreground">{h.date}</span>
                            <span className="text-muted-foreground ml-2">· {h.name || "Holiday"}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveHoliday(h.date)}
                            className="text-muted-foreground hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add / Edit Class Modal */}
      <Dialog open={isAddClassOpen} onOpenChange={setIsAddClassOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editingClassId ? "Edit Class" : "Add Timetable Class"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure class details for {DAYS.find((d) => d.id === selectedDay)?.label}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Subject Name</Label>
              <Input
                placeholder="e.g. Computer Networks"
                value={classSubjectName}
                onChange={(e) => {
                  setClassSubjectName(e.target.value);
                  // Auto match against portal subjects
                  if (!classMatchedCode) {
                    const match = matchTimetableSubject(e.target.value, data.subjects);
                    if (match.matchedCode) {
                      setClassMatchedCode(match.matchedCode);
                    }
                  }
                }}
                className="rounded-xl text-xs h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Map to AttendFlow Subject</Label>
              <Select value={classMatchedCode} onValueChange={setClassMatchedCode}>
                <SelectTrigger className="rounded-xl text-xs h-9">
                  <SelectValue placeholder="Select corresponding AttendFlow subject" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {data.subjects.map((s) => (
                    <SelectItem key={s.subjectCode} value={s.subjectCode} className="text-xs">
                      {s.subjectName} ({s.subjectCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Matches this timetable class with live attendance data pulled from AGC LMS.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Start Time</Label>
                <Input
                  type="time"
                  value={classStartTime}
                  onChange={(e) => setClassStartTime(e.target.value)}
                  className="rounded-xl text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">End Time</Label>
                <Input
                  type="time"
                  value={classEndTime}
                  onChange={(e) => setClassEndTime(e.target.value)}
                  className="rounded-xl text-xs h-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Classroom / Lab (Optional)</Label>
                <Input
                  placeholder="e.g. Lab 4 or Room 201"
                  value={classRoom}
                  onChange={(e) => setClassRoom(e.target.value)}
                  className="rounded-xl text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Teacher (Optional)</Label>
                <Input
                  placeholder="e.g. Prof. Sharma"
                  value={classTeacher}
                  onChange={(e) => setClassTeacher(e.target.value)}
                  className="rounded-xl text-xs h-9"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setIsAddClassOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveClassModal} className="rounded-xl">
              Save Class
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
