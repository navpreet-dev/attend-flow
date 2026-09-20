"use client";

import { useMemo, useState, useEffect } from "react";
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
import { calculateRecovery, simulateAttendance } from "@/lib/attendance-calculator";

interface CalculatorSimulatorViewProps {
  data: DashboardPayload;
  threshold: number;
  initialSelectedSubjectCode?: string | null;
}

export function CalculatorSimulatorView({
  data,
  threshold,
  initialSelectedSubjectCode,
}: CalculatorSimulatorViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<"simulator" | "recovery">("simulator");
  const [selectedSubjectCode, setSelectedSubjectCode] = useState<string>(
    initialSelectedSubjectCode || "OVERALL"
  );

  // Sync initialSelectedSubjectCode if changed externally
  useEffect(() => {
    if (initialSelectedSubjectCode) {
      setSelectedSubjectCode(initialSelectedSubjectCode);
    }
  }, [initialSelectedSubjectCode]);

  // Overall stats
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

  // Resolve currently active subject data
  const currentSubjectInfo = useMemo(() => {
    if (selectedSubjectCode === "OVERALL") {
      return {
        name: "Overall Attendance (All Subjects)",
        code: "OVERALL",
        attended: overall.attended,
        total: overall.total,
        percentage: overall.percentage,
        isCustom: false,
      };
    }
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
    return {
      name: "Overall Attendance",
      code: "OVERALL",
      attended: overall.attended,
      total: overall.total,
      percentage: overall.percentage,
      isCustom: false,
    };
  }, [selectedSubjectCode, data.subjects, overall, customAttended, customTotal]);

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

  return (
    <div className="space-y-6">
      {/* ----------------- Top Subject / Course Selector Bar ----------------- */}
      <Card className="card-premium rounded-2xl border-border/60">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label htmlFor="subject-select" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Select Course / Subject to Analyze
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={selectedSubjectCode} onValueChange={setSelectedSubjectCode}>
                  <SelectTrigger id="subject-select" className="w-full sm:w-[320px] rounded-xl font-medium">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl max-h-72">
                    <SelectItem value="OVERALL">
                      <span className="font-semibold">Overall Attendance</span> ({overall.attended}/{overall.total} · {overall.percentage.toFixed(1)}%)
                    </SelectItem>
                    {data.subjects.map((s) => (
                      <SelectItem key={s.subjectCode} value={s.subjectCode}>
                        {s.subjectName} ({s.attended}/{s.total} · {s.percentage.toFixed(1)}%)
                      </SelectItem>
                    ))}
                    <SelectItem value="CUSTOM">
                      <span className="italic text-muted-foreground">⚙️ Custom custom values…</span>
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
                      </div>
                    </div>
                  </div>
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
