"use client";

import { useMemo, useState, useEffect } from "react";
import { formatTime12Hour } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Calculator,
  Calendar,
  CheckCircle2,
  HelpCircle,
  Info,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { DashboardPayload, SubjectInfo } from "@/lib/types";
import { overallStats } from "@/lib/af-client";
import {
  calculateRecovery,
  simulateAttendance,
  calculateRecoveryDate,
  simulateSemesterProjection,
} from "@/lib/attendance-calculator";
import { Clock } from "lucide-react";
import type { PlannerState } from "@/lib/academic-planner-client";
import {
  calculateSubjectScheduleMetrics,
  generateScheduledClasses,
} from "@/lib/academic-planner";
import {
  adaptLegacyTimetableEntries,
  extractEntryGroups,
} from "@/lib/date-iteration-engine";

interface CalculatorSimulatorViewProps {
  data: DashboardPayload;
  threshold: number;
  initialSelectedSubjectCode?: string | null;
  plannerState?: PlannerState | null;
  isGroupDividedMap?: Record<string, boolean>;
  labRemainingMap?: Record<string, { G1: number; G2: number }>;
  remainingByGroupMap?: Record<string, Record<string, number> | null>;
  scheduledRemainingMap?: Record<string, number>;
}

export function CalculatorSimulatorView({
  data,
  threshold,
  initialSelectedSubjectCode,
  plannerState,
  isGroupDividedMap,
  labRemainingMap,
  remainingByGroupMap,
  scheduledRemainingMap,
}: CalculatorSimulatorViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<"simulator" | "recovery">("simulator");

  // Default to first real subject (never OVERALL) so individual-subject math is always shown
  const firstSubjectCode = data.subjects[0]?.subjectCode ?? "CUSTOM";
  const [selectedSubjectCode, setSelectedSubjectCode] = useState<string>(
    initialSelectedSubjectCode && initialSelectedSubjectCode !== "OVERALL"
      ? initialSelectedSubjectCode
      : firstSubjectCode
  );

  // Local G1/G2 toggle for group-divided subjects inside the simulator
  // null means "not yet chosen" (user must pick when subject is a lab)
  const [simulatorLabGroup, setSimulatorLabGroup] = useState<"G1" | "G2" | null>(null);

  // Sync initialSelectedSubjectCode if changed externally (e.g. from subject card tap)
  useEffect(() => {
    if (initialSelectedSubjectCode && initialSelectedSubjectCode !== "OVERALL") {
      setSelectedSubjectCode(initialSelectedSubjectCode);
      setSimulatorLabGroup(null); // reset local group when subject changes externally
    }
  }, [initialSelectedSubjectCode]);

  // Reset lab group whenever the user manually switches subjects
  const handleSubjectChange = (code: string) => {
    setSelectedSubjectCode(code);
    setSimulatorLabGroup(null);
  };

  // Overall stats (still used for CUSTOM fallback math)
  const overall = useMemo(() => overallStats(data.subjects), [data.subjects]);

  // Custom manual inputs
  const [customAttended, setCustomAttended] = useState<number>(20);
  const [customTotal, setCustomTotal] = useState<number>(25);

  // Simulator Scenario Inputs
  const [attendMore, setAttendMore] = useState<number>(0);
  const [bunkMore, setBunkMore] = useState<number>(1);

  // Recovery Calculator Inputs
  const [targetPercentage, setTargetPercentage] = useState<number>(threshold);
  const [remainingClassesInput, setRemainingClassesInput] = useState<string>("");

  // Update target percentage when prop changes
  useEffect(() => {
    setTargetPercentage(threshold);
  }, [threshold]);

  const savedGroup = useMemo(() => {
    if (typeof window !== "undefined") {
      const g = localStorage.getItem("attendflow_lab_group");
      if (g === "G1" || g === "G2" || g === "Both") return g as "G1" | "G2" | "Both";
    }
    return "Both";
  }, []);

  // Derive timetable schedule metrics for currently selected subject if planner configured.
  // For group-divided subjects, pass the local simulator toggle (simulatorLabGroup), otherwise
  // fall back to the globally saved group preference.
  const timetableMetrics = useMemo(() => {
    if (!plannerState?.calendar || !plannerState?.timetable || plannerState.timetable.length === 0) {
      return null;
    }
    if (selectedSubjectCode === "CUSTOM") {
      return null;
    }
    const groupArg = simulatorLabGroup ?? savedGroup;
    return calculateSubjectScheduleMetrics(
      selectedSubjectCode,
      plannerState.calendar,
      plannerState.timetable,
      new Date(),
      groupArg
    );
  }, [plannerState, selectedSubjectCode, savedGroup, simulatorLabGroup]);

  // Resolve group-divided metadata from precomputed maps or timetable inspection (universally data-driven)
  const isCurrentSubjectGroupDivided = useMemo(() => {
    if (selectedSubjectCode === "CUSTOM") return false;
    // 1. Direct from dashboard map if available
    if (isGroupDividedMap && isGroupDividedMap[selectedSubjectCode] !== undefined) {
      return Boolean(isGroupDividedMap[selectedSubjectCode]);
    }
    // 2. Direct from timetable metrics
    if (timetableMetrics?.isGroupDivided) return true;
    if (timetableMetrics?.remainingByGroup && Object.keys(timetableMetrics.remainingByGroup).length > 0) return true;
    // 3. Fallback: inspect timetable entries for this subject with legacy adaptation
    if (plannerState?.timetable) {
      const adapted = adaptLegacyTimetableEntries(plannerState.timetable as any);
      const subEntries = adapted.filter(
        (e) => (e.matchedSubjectCode || e.subjectCode) === selectedSubjectCode
      );
      return subEntries.some((e) => {
        const g = extractEntryGroups(e);
        return Boolean(g && g.length > 0);
      });
    }
    return false;
  }, [selectedSubjectCode, isGroupDividedMap, timetableMetrics, plannerState]);

  // effectiveRemainingClasses — the single source of truth for scheduler math in this view.
  // For unified (theory) subjects: use scheduledRemaining directly.
  // For group-divided (lab) subjects: use the count for the selected simulatorLabGroup.
  // If the group toggle is null (not chosen yet), default to 0 to avoid misleading forecasts.
  const effectiveRemainingClasses = useMemo(() => {
    if (selectedSubjectCode === "CUSTOM") return 0;
    if (isCurrentSubjectGroupDivided) {
      if (!simulatorLabGroup) return 0; // user hasn't chosen a group yet
      const count =
        timetableMetrics?.remainingByGroup?.[simulatorLabGroup] ??
        remainingByGroupMap?.[selectedSubjectCode]?.[simulatorLabGroup] ??
        (simulatorLabGroup === "G1"
          ? (timetableMetrics?.labRemaining?.G1 ?? labRemainingMap?.[selectedSubjectCode]?.G1)
          : (timetableMetrics?.labRemaining?.G2 ?? labRemainingMap?.[selectedSubjectCode]?.G2));
      return Math.max(0, count ?? 0);
    }
    return Math.max(
      0,
      timetableMetrics?.scheduledRemaining ?? (scheduledRemainingMap?.[selectedSubjectCode] ?? 0)
    );
  }, [
    selectedSubjectCode,
    isCurrentSubjectGroupDivided,
    simulatorLabGroup,
    timetableMetrics,
    remainingByGroupMap,
    labRemainingMap,
    scheduledRemainingMap,
  ]);

  // When subject, group toggle, or effectiveRemainingClasses changes, update Recovery input
  useEffect(() => {
    if (effectiveRemainingClasses > 0) {
      setRemainingClassesInput(String(effectiveRemainingClasses));
    } else if (!isCurrentSubjectGroupDivided) {
      setRemainingClassesInput("");
    }
  }, [effectiveRemainingClasses, isCurrentSubjectGroupDivided]);

  // Resolve currently active subject data
  const currentSubjectInfo = useMemo(() => {
    if (selectedSubjectCode === "CUSTOM") {
      const safeA = Math.max(0, customAttended);
      const safeT = Math.max(safeA, customTotal);
      const pct = safeT > 0 ? (safeA / safeT) * 100 : 0;
      return {
        name: "Custom Manual Input",
        code: "CUSTOM",
        attended: safeA,
        total: safeT,
        percentage: Math.round(pct * 10) / 10,
        isCustom: true,
      };
    }
    const found = data.subjects.find((s) => s.subjectCode === selectedSubjectCode);
    if (found) {
      return {
        name: found.subjectName,
        code: found.subjectCode,
        attended: found.attended,
        total: found.total,
        percentage: found.percentage,
        isCustom: false,
      };
    }
    // Fallback: show first available subject
    const first = data.subjects[0];
    return {
      name: first?.subjectName ?? "No subject",
      code: first?.subjectCode ?? "",
      attended: first?.attended ?? 0,
      total: first?.total ?? 0,
      percentage: first?.percentage ?? 0,
      isCustom: false,
    };
  }, [selectedSubjectCode, data.subjects, customAttended, customTotal]);

  // Compute Simulation Result
  const simulation = useMemo(() => {
    return simulateAttendance(
      currentSubjectInfo.attended,
      currentSubjectInfo.total,
      attendMore,
      bunkMore,
      targetPercentage
    );
  }, [currentSubjectInfo, attendMore, bunkMore, targetPercentage]);

  // Compute Recovery Result
  const remainingNum =
    remainingClassesInput.trim() === "" ? undefined : Math.max(0, parseInt(remainingClassesInput, 10) || 0);

  const recovery = useMemo(() => {
    return calculateRecovery(
      currentSubjectInfo.attended,
      currentSubjectInfo.total,
      targetPercentage,
      remainingNum
    );
  }, [currentSubjectInfo, targetPercentage, remainingNum]);

  // Upcoming class instances for currently selected subject
  const upcomingClassesForSubject = useMemo(() => {
    if (!plannerState?.calendar || !plannerState?.timetable || plannerState.timetable.length === 0) {
      return [];
    }
    if (selectedSubjectCode === "OVERALL" || selectedSubjectCode === "CUSTOM") {
      return [];
    }
    const allInstances = generateScheduledClasses(plannerState.calendar, plannerState.timetable, new Date(), savedGroup);
    return allInstances.filter(
      (inst) =>
        (inst.matchedSubjectCode === selectedSubjectCode || inst.subjectCode === selectedSubjectCode) &&
        !inst.isPassed
    );
  }, [plannerState, selectedSubjectCode, savedGroup]);

  // Calendar Recovery Date prediction
  const recoveryDatePrediction = useMemo(() => {
    if (!upcomingClassesForSubject || upcomingClassesForSubject.length === 0) {
      return null;
    }
    return calculateRecoveryDate(recovery.classesNeeded, upcomingClassesForSubject);
  }, [recovery.classesNeeded, upcomingClassesForSubject]);

  // Semester End Projection — uses effectiveRemainingClasses so labs use the chosen group's count
  const semesterProjection = useMemo(() => {
    // If it's a lab with no group selected, don't show misleading numbers
    if (isCurrentSubjectGroupDivided && !simulatorLabGroup) return null;
    if (effectiveRemainingClasses <= 0) return null;
    return simulateSemesterProjection(
      currentSubjectInfo.attended,
      currentSubjectInfo.total,
      effectiveRemainingClasses,
      bunkMore,
      targetPercentage
    );
  }, [effectiveRemainingClasses, isCurrentSubjectGroupDivided, simulatorLabGroup, currentSubjectInfo.attended, currentSubjectInfo.total, bunkMore, targetPercentage]);

  return (
    <div className="space-y-6">
      {/* ----------------- Top Subject / Course Selector Bar ----------------- */}
      <Card className="card-premium rounded-2xl border-border/60">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 flex-1">
              <Label htmlFor="subject-select" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Course / Subject to Analyze
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={selectedSubjectCode} onValueChange={handleSubjectChange}>
                  <SelectTrigger id="subject-select" className="w-full sm:w-[320px] rounded-xl font-medium">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl max-h-72">
                    {/* Overall Attendance removed — eligibility is per-subject only */}
                    {data.subjects.map((s) => (
                      <SelectItem key={s.subjectCode} value={s.subjectCode}>
                        {s.subjectName} ({s.attended}/{s.total} · {s.percentage.toFixed(1)}%)
                      </SelectItem>
                    ))}
                    <SelectItem value="CUSTOM">
                      <span className="italic text-muted-foreground">⚙️ Custom manual values…</span>
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Badge
                  variant="outline"
                  className={`font-display text-xs font-semibold px-2.5 py-1 rounded-full ${
                    currentSubjectInfo.percentage >= targetPercentage
                      ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                  }`}
                >
                  Current: {currentSubjectInfo.percentage.toFixed(1)}% ({currentSubjectInfo.attended}/{currentSubjectInfo.total})
                </Badge>
              </div>

              {/* Lab Group Toggle — only rendered when selected subject is group-divided */}
              {isCurrentSubjectGroupDivided && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Lab Group:
                  </span>
                  <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
                    {(["G1", "G2"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setSimulatorLabGroup(g)}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                          simulatorLabGroup === g
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        aria-pressed={simulatorLabGroup === g}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                  {!simulatorLabGroup && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      ← Select your lab group for accurate forecasts
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Sub-tab switcher */}
            <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setActiveSubTab("simulator")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeSubTab === "simulator"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                What-If Simulator
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab("recovery")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeSubTab === "recovery"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calculator className="h-3.5 w-3.5" />
                Recovery Calculator
              </button>
            </div>
          </div>

          {/* Custom values inline inputs if "CUSTOM" selected */}
          {currentSubjectInfo.isCustom && (
            <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-3 max-w-sm">
              <div>
                <Label htmlFor="custom-attended" className="text-xs text-muted-foreground">
                  Classes Attended
                </Label>
                <Input
                  id="custom-attended"
                  type="number"
                  min={0}
                  value={customAttended}
                  onChange={(e) => setCustomAttended(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="rounded-lg mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label htmlFor="custom-total" className="text-xs text-muted-foreground">
                  Total Classes
                </Label>
                <Input
                  id="custom-total"
                  type="number"
                  min={customAttended}
                  value={customTotal}
                  onChange={(e) => setCustomTotal(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="rounded-lg mt-1 font-mono text-sm"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* -------------------- MAIN TOOL VIEWS -------------------- */}
      <AnimatePresence mode="wait">
        {activeSubTab === "simulator" ? (
          <motion.div
            key="simulator-tab"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* Left Column: Simulator Controls */}
            <div className="space-y-6 lg:col-span-5">
              <Card className="card-premium rounded-2xl border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-emerald-600" />
                      Test Bunk / Attendance Scenarios
                    </CardTitle>
                    {(attendMore > 0 || bunkMore > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                        onClick={() => {
                          setAttendMore(0);
                          setBunkMore(0);
                        }}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </Button>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    Choose quick bunk scenarios or adjust custom classes below.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Quick Scenarios Buttons */}
                  <div>
                    <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick Scenarios
                    </Label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Button
                        variant={bunkMore === 1 && attendMore === 0 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9"
                        onClick={() => {
                          setAttendMore(0);
                          setBunkMore(1);
                        }}
                      >
                        Bunk 1 class
                      </Button>
                      <Button
                        variant={bunkMore === 2 && attendMore === 0 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9"
                        onClick={() => {
                          setAttendMore(0);
                          setBunkMore(2);
                        }}
                      >
                        Bunk 2 classes
                      </Button>
                      <Button
                        variant={bunkMore === 3 && attendMore === 0 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9"
                        onClick={() => {
                          setAttendMore(0);
                          setBunkMore(3);
                        }}
                      >
                        Bunk 3 classes
                      </Button>
                      <Button
                        variant={attendMore === 3 && bunkMore === 0 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9 text-emerald-600 dark:text-emerald-400"
                        onClick={() => {
                          setAttendMore(3);
                          setBunkMore(0);
                        }}
                      >
                        +3 Attended
                      </Button>
                      <Button
                        variant={attendMore === 5 && bunkMore === 0 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9 text-emerald-600 dark:text-emerald-400"
                        onClick={() => {
                          setAttendMore(5);
                          setBunkMore(0);
                        }}
                      >
                        +5 Attended
                      </Button>
                      <Button
                        variant={attendMore === 4 && bunkMore === 2 ? "default" : "outline"}
                        size="sm"
                        className="rounded-xl text-xs font-semibold h-9 text-amber-600 dark:text-amber-400"
                        onClick={() => {
                          setAttendMore(4);
                          setBunkMore(2);
                        }}
                      >
                        Attend 4, Bunk 2
                      </Button>
                    </div>
                  </div>

                  {/* Steppers */}
                  <div className="space-y-4 pt-2 border-t border-border/60">
                    {/* Bunk Stepper */}
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/60 bg-muted/20">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Classes to Bunk (Miss)</p>
                        <p className="text-[11px] text-muted-foreground">Increases total without attending</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => setBunkMore(Math.max(0, bunkMore - 1))}
                          disabled={bunkMore <= 0}
                          aria-label="Decrease bunks"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-10 text-center font-mono text-base font-bold tabular-nums">
                          {bunkMore}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => setBunkMore(bunkMore + 1)}
                          aria-label="Increase bunks"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Attend Stepper */}
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/60 bg-muted/20">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Classes to Attend</p>
                        <p className="text-[11px] text-muted-foreground">Attends upcoming lectures in a row</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => setAttendMore(Math.max(0, attendMore - 1))}
                          disabled={attendMore <= 0}
                          aria-label="Decrease attended"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-10 text-center font-mono text-base font-bold tabular-nums">
                          {attendMore}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => setAttendMore(attendMore + 1)}
                          aria-label="Increase attended"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Simulator Output Projection Card */}
            <div className="space-y-6 lg:col-span-7">
              <Card className="card-premium rounded-2xl border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="font-display text-lg font-semibold tracking-tight">
                        Projected Outcome
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Target: <span className="font-semibold text-foreground">{targetPercentage}%</span> · {currentSubjectInfo.name}
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={`font-display text-xs font-bold px-3 py-1 rounded-full ${
                        simulation.isAboveTarget
                          ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {simulation.isAboveTarget ? "✓ Above Target" : "⚠ Below Target"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Before vs After Hero Numbers */}
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 p-4 rounded-2xl border border-border/60 bg-muted/20">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Current
                      </p>
                      <p className="font-display text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
                        {simulation.initialPercentage.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {simulation.initialAttended}/{simulation.initialTotal} classes
                      </p>
                    </div>

                    <div className="border-l border-border/60 pl-3 sm:pl-4">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Projected
                      </p>
                      <div className="flex items-baseline gap-2">
                        <p
                          className={`font-display text-2xl sm:text-3xl font-bold tabular-nums ${
                            simulation.isAboveTarget
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {simulation.projectedPercentage.toFixed(1)}%
                        </p>
                        {simulation.deltaPercentage !== 0 && (
                          <span
                            className={`inline-flex items-center text-xs font-bold ${
                              simulation.deltaPercentage > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {simulation.deltaPercentage > 0 ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5" />
                            )}
                            {simulation.deltaPercentage > 0 ? "+" : ""}
                            {simulation.deltaPercentage.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {simulation.projectedAttended}/{simulation.projectedTotal} classes
                      </p>
                    </div>
                  </div>

                  {/* Progress Comparison */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progress comparison</span>
                      <span className="font-semibold text-foreground">
                        Target: {targetPercentage}%
                      </span>
                    </div>
                    <Progress
                      value={simulation.projectedPercentage}
                      aria-label="Projected attendance progress"
                      className="h-2.5"
                      style={{
                        color: simulation.isAboveTarget ? "#10b981" : "#f43f5e",
                      }}
                    />
                  </div>

                  {/* Plain English Summary Box */}
                  <div
                    className={`rounded-xl border p-4 text-xs sm:text-sm leading-relaxed ${
                      simulation.isAboveTarget
                        ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-950 dark:text-emerald-200"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-200"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {simulation.isAboveTarget ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">{simulation.summaryText}</p>
                        <p className="mt-1 text-xs opacity-90">
                          {simulation.isAboveTarget ? (
                            <>
                              You can skip up to{" "}
                              <span className="font-bold">{simulation.safeBunksRemaining}</span> more
                              class{simulation.safeBunksRemaining === 1 ? "" : "es"} and still stay
                              above your {targetPercentage}% target.
                            </>
                          ) : (
                            <>
                              You will need to attend the next{" "}
                              <span className="font-bold">{simulation.mustAttendRemaining}</span> class
                              {simulation.mustAttendRemaining === 1 ? "" : "es"} in a row without
                              missing any to recover back to {targetPercentage}%.
                            </>
                          )}
                        </p>
                        {effectiveRemainingClasses > 0 && (
                          <p className="mt-2 text-xs border-t border-current/15 pt-2 opacity-95">
                            <strong>Timetable context:</strong> Based on your schedule
                            {isCurrentSubjectGroupDivided && simulatorLabGroup
                              ? ` (${simulatorLabGroup})`
                              : ""}
                            , there are{" "}
                            <strong>{effectiveRemainingClasses}</strong> classes remaining for this subject.
                            After this simulated scenario ({attendMore + bunkMore} classes),{" "}
                            <strong>{Math.max(0, effectiveRemainingClasses - attendMore - bunkMore)}</strong> scheduled
                            classes will remain.
                          </p>
                        )}
                        {isCurrentSubjectGroupDivided && !simulatorLabGroup && (
                          <p className="mt-2 text-xs border-t border-current/15 pt-2 opacity-80 italic">
                            Select your lab group (G1 / G2) above to see timetable-accurate forecasts.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Calendar & Timetable Semester-End Outlook */}
                  {semesterProjection && (
                    <div className="rounded-2xl border border-border/80 bg-gradient-to-br from-muted/30 to-muted/10 p-4 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                            Semester-End Attendance Outlook
                          </span>
                        </div>
                        <Badge variant="outline" className="text-[11px] border-border/80">
                          {semesterProjection.scheduledRemaining} classes left in semester
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                        <div className="p-3 rounded-xl bg-background border border-border/60 shadow-2xs">
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Semester Safe Bunks</p>
                          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                            {semesterProjection.safeBunksTotal}
                          </p>
                          <p className="text-[10px] text-muted-foreground">can skip before semester end</p>
                        </div>

                        <div className="p-3 rounded-xl bg-background border border-border/60 shadow-2xs">
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Simulated Final %</p>
                          <p className={`text-xl font-bold ${semesterProjection.isAboveTarget ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {semesterProjection.projectedPercentage.toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">with {bunkMore} bunk{bunkMore === 1 ? "" : "s"}</p>
                        </div>

                        <div className="p-3 rounded-xl bg-background border border-border/60 shadow-2xs col-span-2 sm:col-span-1">
                          <p className="text-[10px] uppercase text-muted-foreground font-semibold">Max Reachable %</p>
                          <p className="text-xl font-bold text-primary">
                            {semesterProjection.maxPossiblePercentage.toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">with 100% attendance</p>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {semesterProjection.message}
                      </p>

                      {timetableMetrics?.nextClass && (
                        <div className="rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-xs flex items-center justify-between text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            <span>Next class: <strong className="text-foreground">{timetableMetrics.nextClass.date} ({formatTime12Hour(timetableMetrics.nextClass.startTime)}–{formatTime12Hour(timetableMetrics.nextClass.endTime)})</strong></span>
                          </span>
                          {timetableMetrics.nextClass.room && (
                            <span className="text-[11px] font-medium">{timetableMetrics.nextClass.room}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        ) : (
          /* ----------------- RECOVERY CALCULATOR TAB ----------------- */
          <motion.div
            key="recovery-tab"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* Left Column: Target & Constraints Controls */}
            <div className="space-y-6 lg:col-span-5">
              <Card className="card-premium rounded-2xl border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-emerald-600" />
                    Recovery Target &amp; Constraints
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Calculate minimum consecutive classes required to reach target.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Target Percentage Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="target-slider" className="text-xs font-semibold">
                        Desired Attendance Target
                      </Label>
                      <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                        {targetPercentage}%
                      </span>
                    </div>
                    <Slider
                      id="target-slider"
                      value={[targetPercentage]}
                      min={50}
                      max={100}
                      step={1}
                      onValueChange={(v) => setTargetPercentage(v[0])}
                      className="py-1"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>50%</span>
                      <span className="font-bold text-foreground">75% (Standard)</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* Optional Remaining Classes Limit */}
                  <div className="space-y-1.5 pt-3 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="remaining-classes" className="text-xs font-semibold">
                        Estimated Remaining Classes in Semester
                      </Label>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        Optional
                      </Badge>
                    </div>
                    {effectiveRemainingClasses > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Timetable{isCurrentSubjectGroupDivided && simulatorLabGroup ? ` (${simulatorLabGroup})` : ""}
                            : <strong>{effectiveRemainingClasses}</strong> classes remain
                            {timetableMetrics && timetableMetrics.upcomingThisWeek.length > 0
                              ? ` (${timetableMetrics.upcomingThisWeek.length} this week)`
                              : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setRemainingClassesInput(String(effectiveRemainingClasses))}
                          className="text-[11px] underline font-semibold hover:opacity-80"
                        >
                          Auto-fill
                        </button>
                      </div>
                    )}
                    {isCurrentSubjectGroupDivided && !simulatorLabGroup && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">
                        Select your lab group (G1 / G2) in the selector above to auto-fill.
                      </p>
                    )}
                    <Input
                      id="remaining-classes"
                      type="number"
                      min={0}
                      placeholder="e.g. 15 (leave empty if unknown)"
                      value={remainingClassesInput}
                      onChange={(e) => setRemainingClassesInput(e.target.value)}
                      className="rounded-xl font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      Entering remaining classes checks whether recovery is mathematically possible
                      before the semester concludes.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Recovery Output */}
            <div className="space-y-6 lg:col-span-7">
              <Card className="card-premium rounded-2xl border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="font-display text-lg font-semibold tracking-tight">
                        Recovery Feasibility Analysis
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {currentSubjectInfo.name} · Target {targetPercentage}%
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={`font-display text-xs font-bold px-3 py-1 rounded-full ${
                        recovery.status === "ALREADY_ABOVE"
                          ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                          : recovery.status === "RECOVERABLE"
                          ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {recovery.status === "ALREADY_ABOVE"
                        ? "✓ Already at Target"
                        : recovery.status === "RECOVERABLE"
                        ? "⚡ Recoverable"
                        : "⚠ Recovery Restricted"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  {/* Hero Metric */}
                  <div className="p-4 sm:p-5 rounded-2xl border border-border/60 bg-muted/20 text-center sm:text-left flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Required Attendance Streak
                      </p>
                      <div className="mt-1 flex items-baseline justify-center sm:justify-start gap-2">
                        {recovery.status === "ALREADY_ABOVE" ? (
                          <span className="font-display text-3xl sm:text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                            0 classes
                          </span>
                        ) : recovery.status === "IMPOSSIBLE_TARGET" ? (
                          <span className="font-display text-2xl sm:text-3xl font-bold text-rose-600 dark:text-rose-400">
                            Impossible (100%)
                          </span>
                        ) : (
                          <>
                            <span className="font-display text-3xl sm:text-4xl font-bold text-foreground">
                              {recovery.classesNeeded}
                            </span>
                            <span className="text-sm font-medium text-muted-foreground">
                              consecutive classes in a row
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {recovery.status === "RECOVERABLE" && (
                      <div className="rounded-xl border border-emerald-600/30 bg-emerald-600/10 px-4 py-2 text-center shrink-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                          Resulting %
                        </p>
                        <p className="font-display text-xl font-bold text-emerald-600 dark:text-emerald-400">
                          {recovery.projectedPercentage.toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Calendar-Aware Recovery Date Prediction */}
                  {recoveryDatePrediction && recoveryDatePrediction.recoveryDate && recovery.status === "RECOVERABLE" && (
                    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0 shadow-xs">
                          <Calendar className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              Predicted Recovery Date
                            </p>
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] py-0 px-1.5 font-semibold">
                              Timetable Projected
                            </Badge>
                          </div>
                          <p className="text-base sm:text-lg font-bold text-foreground">
                            {recoveryDatePrediction.formattedDate}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Attend all upcoming classes to reach {targetPercentage}% on {recoveryDatePrediction.dayName} ({recoveryDatePrediction.classesNeeded} classes from today).
                          </p>
                        </div>
                      </div>
                      <div className="text-right sm:text-right shrink-0">
                        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs px-2.5 py-1">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Reachable
                        </Badge>
                      </div>
                    </div>
                  )}

                  {/* Explanatory Message Box */}
                  <div
                    className={`rounded-xl border p-4 text-xs sm:text-sm leading-relaxed ${
                      recovery.status === "ALREADY_ABOVE"
                        ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-950 dark:text-emerald-200"
                        : recovery.status === "RECOVERABLE"
                        ? "border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-200"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-200"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {recovery.status === "ALREADY_ABOVE" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : recovery.status === "RECOVERABLE" ? (
                        <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">{recovery.message}</p>
                        {recovery.maxPossiblePercentage !== undefined && (
                          <p className="mt-1 text-xs opacity-90">
                            Max possible attendance with perfect attendance:{" "}
                            <span className="font-bold">
                              {recovery.maxPossiblePercentage.toFixed(1)}%
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mathematical Step Breakdown */}
                  <div className="rounded-xl border border-border/60 p-3.5 space-y-2 text-xs bg-card">
                    <p className="font-display font-semibold text-foreground flex items-center gap-1.5">
                      <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
                      Calculation Breakdown
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px] text-muted-foreground">
                      <div className="rounded-lg bg-muted/40 p-2 text-center">
                        <span className="block text-[10px] text-muted-foreground/80">Current Ratio</span>
                        <span className="font-bold text-foreground">
                          {recovery.currentAttended}/{recovery.currentTotal}
                        </span>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2 text-center">
                        <span className="block text-[10px] text-muted-foreground/80">Target</span>
                        <span className="font-bold text-foreground">{targetPercentage}%</span>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2 text-center">
                        <span className="block text-[10px] text-muted-foreground/80">Streak Needed</span>
                        <span className="font-bold text-foreground">
                          +{recovery.classesNeeded}
                        </span>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2 text-center">
                        <span className="block text-[10px] text-muted-foreground/80">Final Ratio</span>
                        <span className="font-bold text-foreground">
                          {recovery.currentAttended + recovery.classesNeeded}/
                          {recovery.currentTotal + recovery.classesNeeded}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
