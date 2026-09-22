"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTime12Hour, cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  BellRing,
  CalendarCheck2,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileDown,
  FileJson,
  FileSpreadsheet,
  GraduationCap,
  History,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WifiOff,
  CalendarDays,
} from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import {
  canSkip,
  exportJson,
  exportLogsCsv,
  exportSubjectsCsv,
  fmtDateTime,
  mustAttend,
  overallStats,
  parsePortalDate,
} from "@/lib/af-client";
import { apiSettings, apiLogout, apiSync, cachePayload, SessionExpiredError } from "@/lib/af-client";
import { ThemeToggle } from "./theme-toggle";
import { SubjectCard } from "./subject-card";
import { TrendsCharts } from "./trends-chart";
import { CalculatorSimulatorView } from "./calculator-simulator-view";
import { AcademicPlannerView } from "./academic-planner-view";
import { NotificationsPopover } from "./notifications-popover";
import { SyncSummaryDialog } from "./sync-summary-dialog";
import { generateSyncSummary, type SyncSummary } from "@/lib/sync-summary";
import { enablePushAlerts, disablePushAlerts, registerServiceWorker } from "@/lib/push-client";
import { apiGetPlanner, type PlannerState } from "@/lib/academic-planner-client";
import {
  calculateSubjectScheduleMetrics,
  generateScheduledClasses,
  toDateString,
} from "@/lib/academic-planner";

interface DashboardViewProps {
  data: DashboardPayload;
  offline: boolean;
  onData: (d: DashboardPayload) => void;
  onLogout: () => void;
}

export function DashboardView({ data, offline, onData, onLogout }: DashboardViewProps) {
  const [syncing, setSyncing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [selectedToolSubject, setSelectedToolSubject] = useState<string>("OVERALL");
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [prevData, setPrevData] = useState<DashboardPayload | null>(null);
  const [plannerState, setPlannerState] = useState<PlannerState | null>(null);
  const notifiedRef = useRef<string>("");

  const loadPlanner = useCallback(async () => {
    try {
      const res = await apiGetPlanner();
      setPlannerState(res);
    } catch {
      // Ignore planner load errors (optional feature)
    }
  }, []);

  useEffect(() => {
    void loadPlanner();
  }, [loadPlanner]);

  const threshold = data.settings.threshold;
  const overall = useMemo(() => overallStats(data.subjects), [data.subjects]);
  const lowSubjects = useMemo(
    () =>
      data.subjects
        .filter((s) => s.total > 0 && s.percentage < threshold)
        .sort((a, b) => a.percentage - b.percentage),
    [data.subjects, threshold]
  );

  // Lab group selection (G1, G2, or Both for all/both)
  const [selectedGroup, setSelectedGroup] = useState<"G1" | "G2" | "Both">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("attendflow_lab_group");
      if (saved === "G1" || saved === "G2" || saved === "Both") return saved as "G1" | "G2" | "Both";
      if (saved === "Unknown") return "Both";
    }
    return "Both";
  });

  const handleGroupChange = useCallback((g: "G1" | "G2" | "Both") => {
    setSelectedGroup(g);
    if (typeof window !== "undefined") {
      localStorage.setItem("attendflow_lab_group", g);
    }
  }, []);

  // Map scheduled remaining classes per subject if planner is configured
  const { scheduledRemainingMap, labRemainingMap, remainingByGroupMap, isGroupDividedMap } = useMemo(() => {
    if (!plannerState?.calendar || !plannerState?.timetable || plannerState.timetable.length === 0) {
      return {
        scheduledRemainingMap: {} as Record<string, number>,
        labRemainingMap: {} as Record<string, { G1: number; G2: number }>,
        remainingByGroupMap: {} as Record<string, Record<string, number> | null>,
        isGroupDividedMap: {} as Record<string, boolean>,
      };
    }
    const remMap: Record<string, number> = {};
    const labMap: Record<string, { G1: number; G2: number }> = {};
    const groupMap: Record<string, Record<string, number> | null> = {};
    const divMap: Record<string, boolean> = {};
    for (const s of data.subjects) {
      const m = calculateSubjectScheduleMetrics(
        s.subjectCode,
        plannerState.calendar,
        plannerState.timetable,
        new Date(),
        selectedGroup
      );
      remMap[s.subjectCode] = m.scheduledRemaining;
      divMap[s.subjectCode] = Boolean(m.isGroupDivided);
      if (m.labRemaining) {
        labMap[s.subjectCode] = m.labRemaining;
      }
      groupMap[s.subjectCode] = m.remainingByGroup ?? null;
    }
    return {
      scheduledRemainingMap: remMap,
      labRemainingMap: labMap,
      remainingByGroupMap: groupMap,
      isGroupDividedMap: divMap,
    };
  }, [plannerState, data.subjects, selectedGroup]);

  // Today and Tomorrow upcoming classes preview
  const { todayClasses, tomorrowClasses } = useMemo(() => {
    if (!plannerState?.calendar || !plannerState?.timetable || plannerState.timetable.length === 0) {
      return { todayClasses: [], tomorrowClasses: [] };
    }
    const today = new Date();
    const todayStr = toDateString(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateString(tomorrow);

    const all = generateScheduledClasses(plannerState.calendar, plannerState.timetable, today, selectedGroup);
    const todayClasses = all.filter((c) => c.date === todayStr);
    const tomorrowClasses = all.filter((c) => c.date === tomorrowStr);
    return { todayClasses, tomorrowClasses };
  }, [plannerState, selectedGroup]);

  const runSync = useCallback(
    async (silent = false) => {
      if (syncing) return;
      setSyncing(true);
      try {
        const prev = data;
        const fresh = await apiSync();
        setPrevData(prev);
        onData(fresh);

        try {
          const summary = generateSyncSummary(prev, fresh);
          setSyncSummary(summary);
          if (!silent && !fresh.error) {
            setShowSummaryDialog(true);
          }
        } catch {
          /* summary generation failures must never fail the sync */
        }

        if (fresh.error) {
          toast.warning(fresh.error);
        } else if (!silent) {
          toast.success("Attendance synced with the college portal.");
        }
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          toast.error(e.message);
          setTimeout(() => onLogout(), 600);
          return;
        }
        const msg = e instanceof Error ? e.message : "Sync failed.";
        if (!silent) toast.error(msg);
        else if (msg.includes("log in")) toast.error(msg);
      } finally {
        setSyncing(false);
      }
    },
    [data, onData, onLogout, syncing]
  );

  // Cache for offline access
  useEffect(() => {
    cachePayload(data);
  }, [data]);

  // Auto background sync when stale + autoSync enabled
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (offline) return;
    if (autoSyncedRef.current) return;
    if (data.settings.autoSync && data.stale && data.settings.rememberMe) {
      autoSyncedRef.current = true;
      void runSync(true);
    }
  }, [data.stale, data.settings.autoSync, data.settings.rememberMe, offline, runSync]);

  // Low-attendance browser notifications (once per dataset)
  useEffect(() => {
    if (!data.settings.notifyLow || lowSubjects.length === 0) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const key = `${data.lastSyncAt}-${lowSubjects.length}`;
    if (notifiedRef.current === key) return;
    notifiedRef.current = key;
    try {
      const worst = lowSubjects[0];
      new Notification("Low attendance warning", {
        body:
          lowSubjects.length === 1
            ? `${worst.subjectName} is at ${worst.percentage.toFixed(1)}% (below ${threshold}%).`
            : `${lowSubjects.length} subjects are below ${threshold}%. Lowest: ${worst.subjectName} at ${worst.percentage.toFixed(1)}%.`,
        tag: "attendflow-low-attendance",
      });
    } catch {
      /* notification failures are non-fatal */
    }
  }, [data.settings.notifyLow, data.lastSyncAt, lowSubjects, threshold]);

  async function handleLogout() {
    try {
      await apiLogout();
    } finally {
      onLogout();
    }
  }

  async function updateSettings(patch: Parameters<typeof apiSettings>[0]) {
    setSavingSettings(true);
    try {
      const s = await apiSettings(patch);
      onData({ ...data, settings: { ...data.settings, ...s } });
      toast.success("Settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  // Register service worker for Web Push notifications
  useEffect(() => {
    registerServiceWorker();
  }, []);

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Notifications are not supported in this browser.");
      return;
    }
    const result = await enablePushAlerts();
    if (result === "granted") {
      await updateSettings({ notifyLow: true });
      toast.success("Push alerts enabled. You'll receive alerts even when the tab is closed.");
    } else if (result === "denied") {
      toast.error("Notification permission was denied in browser settings.");
    } else {
      toast.error("Push notifications are not supported or configured on this device.");
    }
  }

  const overallLevel =
    overall.percentage >= threshold ? "ok" : overall.percentage >= threshold - 5 ? "warn" : "danger";
  const overallColor =
    overallLevel === "ok" ? "text-emerald-600 dark:text-emerald-500" : overallLevel === "warn" ? "text-amber-600 dark:text-amber-500" : "text-rose-600 dark:text-rose-500";

  const overallNeed = mustAttend(overall.attended, overall.total, threshold);
  const overallSkip = canSkip(overall.attended, overall.total, threshold);

  const sortedLogs = useMemo(
    () => [...data.logs].sort((a, b) => parsePortalDate(b.date) - parsePortalDate(a.date)),
    [data.logs]
  );

  const overallDutyLeave = useMemo(
    () => data.logs.filter((l) => l.status === "DUTY_LEAVE").length,
    [data.logs]
  );

  return (
    <div className="flex-1">
      {/* ------------------------------- Header ------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-600/20">
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-semibold leading-tight tracking-tight">
              AttendFlow
              <span className="ml-2.5 hidden text-xs font-medium text-muted-foreground sm:inline">
                {data.profile?.name} · {data.profile?.rollNo}
              </span>
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {data.profile?.course} · {data.profile?.section}
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runSync()}
              disabled={syncing}
              className="gap-1.5"
              aria-label="Sync attendance now"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync"}</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" aria-label="Export data">
                  <FileDown className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Download reports</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportSubjectsCsv(data)}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" /> Subjects (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportLogsCsv(data)}>
                  <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Class log (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportJson(data)}>
                  <FileJson className="mr-2 h-4 w-4" aria-hidden="true" /> Full backup (JSON)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <NotificationsPopover
              data={data}
              prevData={prevData}
              onSelectSubjectForSimulator={(code) => {
                setSelectedToolSubject(code);
                setActiveTab("tools");
              }}
            />

            <ThemeToggle />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="Log out"
              className="rounded-full text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Offline / error banners */}
        {offline && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            You&apos;re offline — showing your last saved snapshot from this device.
          </div>
        )}
        {data.lastSyncOk === false && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            The last sync attempt couldn&apos;t reach the portal. Press Sync to retry.
          </div>
        )}

        {/* Low attendance warning */}
        {lowSubjects.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card-premium max-w-full overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/[0.08] to-rose-500/[0.08] p-4 sm:p-5"
            role="alert"
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-semibold tracking-tight text-amber-800 dark:text-amber-300">
                  Low attendance warning — {lowSubjects.length} subject{lowSubjects.length === 1 ? "" : "s"} below {threshold}%
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {lowSubjects.slice(0, 6).map((s) => (
                    <Badge
                      key={s.subjectCode}
                      variant="outline"
                      className="max-w-full whitespace-normal break-words border-amber-500/30 bg-background/60 text-left leading-relaxed"
                    >
                      {s.subjectName} · {s.percentage.toFixed(1)}% · attend next {mustAttend(s.attended, s.total, threshold)}
                    </Badge>
                  ))}
                  {lowSubjects.length > 6 && (
                    <Badge variant="outline" className="border-amber-500/30 bg-background/60">
                      +{lowSubjects.length - 6} more
                    </Badge>
                  )}
                </div>
                {!data.settings.notifyLow && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={enableNotifications}>
                    <BellRing className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Get notified when attendance drops
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ------------------------------ Stat cards ---------------------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="card-premium rounded-2xl border-border/60">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em]">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Overall attendance
              </CardDescription>
              <CardTitle className={`font-display text-[2.1rem] font-bold leading-none tracking-tight tabular-nums ${overallColor}`}>
                {overall.total > 0 ? `${overall.percentage.toFixed(1)}%` : "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Progress
                value={overall.percentage}
                aria-label={`Overall attendance ${overall.percentage.toFixed(1)} percent`}
                className="h-1.5"
                style={{ color: overallLevel === "ok" ? "#10b981" : overallLevel === "warn" ? "#f59e0b" : "#f43f5e" }}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {overallNeed > 0
                  ? `Attend next ${overallNeed} to reach ${threshold}%`
                  : `Can skip ${overallSkip} and stay ≥ ${threshold}%`}
              </p>
            </CardContent>
          </Card>

          <Card className="card-premium rounded-2xl border-border/60">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em]">
                <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" /> Classes attended
              </CardDescription>
              <CardTitle className="font-display text-[2.1rem] font-bold leading-none tracking-tight tabular-nums">
                {overall.attended}
                <span className="text-lg font-medium text-muted-foreground">/{overall.total}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {overall.total - overall.attended} missed
                {overallDutyLeave > 0 ? ` · ${overallDutyLeave} duty leave` : ""} across {data.subjects.length} subjects
              </p>
            </CardContent>
          </Card>

          <Card className="card-premium rounded-2xl border-border/60">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em]">
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Subjects on track
              </CardDescription>
              <CardTitle className="font-display text-[2.1rem] font-bold leading-none tracking-tight tabular-nums">
                {data.subjects.length - lowSubjects.length}
                <span className="text-lg font-medium text-muted-foreground">/{data.subjects.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {lowSubjects.length === 0
                  ? "Everything above target — keep it up!"
                  : `${lowSubjects.length} need attention`}
              </p>
            </CardContent>
          </Card>

          <Card className="card-premium rounded-2xl border-border/60">
            <CardHeader className="pb-1">
              <CardDescription className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.11em]">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Last synced
              </CardDescription>
              <CardTitle className="font-display text-xl font-semibold leading-snug tracking-tight">
                {data.lastSyncAt ? fmtDateTime(data.lastSyncAt) : "Never"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {data.lastSyncOk === true ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    Live from agclms.in
                  </>
                ) : data.lastSyncOk === false ? (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                    Last attempt failed — retry
                  </>
                ) : (
                  "Awaiting first sync"
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* -------------------------------- Tabs -------------------------------- */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="scrollbar-slim h-11 w-full justify-start overflow-x-auto rounded-xl bg-muted/50 p-1">
            <TabsTrigger value="overview" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> Overview
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <Calculator className="h-4 w-4" aria-hidden="true" /> Calculator &amp; Simulator
            </TabsTrigger>
            <TabsTrigger value="trends" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <TrendingUp className="h-4 w-4" aria-hidden="true" /> Trends
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <History className="h-4 w-4" aria-hidden="true" /> History
            </TabsTrigger>
            <TabsTrigger value="planner" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <CalendarDays className="h-4 w-4" aria-hidden="true" /> Academic Planner
              {plannerState?.configured && (
                <span className="ml-1 h-2 w-2 rounded-full bg-emerald-500" title="Timetable Active" />
              )}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:px-4 sm:text-[13px]">
              <Settings2 className="h-4 w-4" aria-hidden="true" /> Settings
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-0 space-y-4">
            {/* Upcoming Classes Preview (Timetable) */}
            {(todayClasses.length > 0 || tomorrowClasses.length > 0) && (
              <div className="card-premium rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.04] to-teal-500/[0.04] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Upcoming Classes (Timetable)</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("planner")}
                    className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    View Timetable →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-border/60 bg-card/60 p-3">
                    <p className="font-semibold text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wider">Today</p>
                    {todayClasses.length === 0 ? (
                      <p className="text-muted-foreground italic">No classes scheduled today.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {todayClasses.map((c, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate" title={c.subjectName}>
                              {c.subjectName}
                            </span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] shrink-0">
                              {formatTime12Hour(c.startTime)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card/60 p-3">
                    <p className="font-semibold text-muted-foreground mb-1.5 text-[11px] uppercase tracking-wider">Tomorrow</p>
                    {tomorrowClasses.length === 0 ? (
                      <p className="text-muted-foreground italic">No classes scheduled tomorrow.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {tomorrowClasses.map((c, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate" title={c.subjectName}>
                              {c.subjectName}
                            </span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] shrink-0">
                              {formatTime12Hour(c.startTime)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Subject-wise attendance</h2>
                <p className="text-xs text-muted-foreground">
                  Target: <span className="font-semibold text-foreground">{threshold}%</span> · tap any card for the full class log
                </p>
              </div>
              {plannerState?.configured && (
                <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/80 p-1 text-xs shadow-xs">
                  <span className="px-2 text-[11px] font-medium text-muted-foreground">Lab Group:</span>
                  <button
                    type="button"
                    onClick={() => handleGroupChange("Both")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      selectedGroup === "Both"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Both
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGroupChange("G1")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      selectedGroup === "G1"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    G1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGroupChange("G2")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      selectedGroup === "G2"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    G2
                  </button>
                </div>
              )}
            </div>
            {data.subjects.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No subjects found. Press <span className="font-semibold text-foreground">Sync</span> to re-fetch from the portal.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.subjects.map((s, i) => (
                  <SubjectCard
                    key={s.subjectCode}
                    subject={s}
                    data={data}
                    threshold={threshold}
                    index={i}
                    scheduledRemaining={scheduledRemainingMap[s.subjectCode]}
                    isGroupDivided={isGroupDividedMap[s.subjectCode]}
                    labRemaining={labRemainingMap[s.subjectCode]}
                    remainingByGroup={remainingByGroupMap[s.subjectCode]}
                    selectedGroup={selectedGroup}
                    onOpenSimulator={(code) => {
                      setSelectedToolSubject(code);
                      setActiveTab("tools");
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Calculator & What-If Simulator */}
          <TabsContent value="tools" className="mt-0">
            <CalculatorSimulatorView
              data={data}
              threshold={threshold}
              initialSelectedSubjectCode={selectedToolSubject}
              plannerState={plannerState}
              isGroupDividedMap={isGroupDividedMap}
              labRemainingMap={labRemainingMap}
              remainingByGroupMap={remainingByGroupMap}
              scheduledRemainingMap={scheduledRemainingMap}
            />
          </TabsContent>

          {/* Trends */}
          <TabsContent value="trends" className="mt-0">
            <TrendsCharts data={data} threshold={threshold} />
          </TabsContent>

          {/* History */}
          <TabsContent value="history" className="mt-0 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent sync activity</CardTitle>
                <CardDescription>Every automatic and manual fetch from the college portal.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-40 [&>[data-slot=scroll-area-viewport]]:max-h-40">
                  <ul className="space-y-2 text-sm">
                    {data.recentSyncs.length === 0 && (
                      <li className="text-muted-foreground">No sync events yet.</li>
                    )}
                    {data.recentSyncs.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {e.status === "SUCCESS" ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
                          )}
                          <span className="w-0 min-w-0 flex-1 truncate text-muted-foreground">{e.message ?? e.status}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Full class log</CardTitle>
                <CardDescription>
                  {sortedLogs.length} recorded lectures · newest first
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-96 rounded-md border [&>[data-slot=scroll-area-viewport]]:max-h-96">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead className="w-[88px] sm:w-28">Date</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead className="w-20 text-right sm:w-24">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedLogs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                            No class logs recorded on the portal yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {sortedLogs.map((l, i) => (
                        <TableRow key={`${l.subjectCode}-${l.date}-${i}`}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{l.date}</TableCell>
                          <TableCell className="max-w-[140px] truncate sm:max-w-[220px]" title={l.subjectName ?? l.subjectCode}>
                            {l.subjectName ?? l.subjectCode}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={
                                l.status === "DUTY_LEAVE"
                                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400 font-medium"
                                  : l.status === "PRESENT"
                                  ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                                  : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                              }
                            >
                              {l.status === "DUTY_LEAVE" ? "Duty Leave" : l.status === "PRESENT" ? "Present" : "Absent"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings" className="mt-0 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Attendance target</CardTitle>
                  <CardDescription>
                    Warnings, predictions and recovery plans all use this threshold.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Slider
                      value={[threshold]}
                      min={30}
                      max={100}
                      step={1}
                      onValueCommit={(v) => updateSettings({ threshold: v[0] })}
                      aria-label="Attendance target percentage"
                      className="flex-1"
                    />
                    <span className="w-14 text-right text-lg font-bold tabular-nums">{threshold}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Most colleges (incl. AGC) require <span className="font-semibold">75%</span> per subject to be exam-eligible.
                  </p>
                  <Separator />
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Daily auto-sync</p>
                      <p className="text-xs text-muted-foreground">
                        Refresh automatically whenever you open AttendFlow with saved credentials.
                      </p>
                    </div>
                    <Switch
                      checked={data.settings.autoSync}
                      disabled={savingSettings || !data.settings.rememberMe}
                      onCheckedChange={(v) => updateSettings({ autoSync: v })}
                      aria-label="Toggle daily auto-sync"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Low-attendance notifications</p>
                      <p className="text-xs text-muted-foreground">
                        Browser push alert whenever any subject drops below target.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
                        <Button size="sm" variant="outline" onClick={enableNotifications}>
                          Enable
                        </Button>
                      )}
                      <Switch
                        checked={data.settings.notifyLow}
                        disabled={savingSettings}
                        onCheckedChange={async (v) => {
                          if (v) {
                            if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
                              await enableNotifications();
                            } else {
                              await updateSettings({ notifyLow: true });
                            }
                          } else {
                            await disablePushAlerts();
                            await updateSettings({ notifyLow: false });
                          }
                        }}
                        aria-label="Toggle low-attendance notifications"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Account &amp; security</CardTitle>
                  <CardDescription>How AttendFlow protects your data.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <p>
                      <span className="font-medium">Encrypted storage.</span>{" "}
                      {data.settings.rememberMe
                        ? "Your portal password is sealed with AES-256-GCM and used only to sync your attendance."
                        : "You did not tick \"Remember me\", so no password is stored — you'll re-enter it at next login."}
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <p>
                      <span className="font-medium">Offline cache.</span> Your latest snapshot is
                      saved on this device so the dashboard opens even without internet.
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <p>
                      <span className="font-medium">Portal-friendly.</span> Syncs are rate-limited so the
                      college portal is never hammered, even with thousands of students.
                    </p>
                  </div>
                  <Separator />
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Student</dt>
                    <dd className="font-medium">{data.profile?.name} ({data.profile?.rollNo})</dd>
                    <dt className="text-muted-foreground">Course</dt>
                    <dd className="font-medium">{data.profile?.course}</dd>
                    <dt className="text-muted-foreground">Section</dt>
                    <dd className="font-medium">{data.profile?.section}</dd>
                    <dt className="text-muted-foreground">Department</dt>
                    <dd className="font-medium">{data.profile?.department}</dd>
                    <dt className="text-muted-foreground">Class incharge</dt>
                    <dd className="font-medium">{data.profile?.incharge}</dd>
                  </dl>
                  <Separator />
                  <Button variant="destructive" size="sm" className="w-full" onClick={handleLogout}>
                    <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Log out &amp; clear saved session
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Academic Planner */}
          <TabsContent value="planner" className="mt-0">
            <AcademicPlannerView data={data} onPlannerUpdated={loadPlanner} />
          </TabsContent>
        </Tabs>

        {/* Post-Sync Summary Dialog */}
        <SyncSummaryDialog
          summary={syncSummary}
          open={showSummaryDialog}
          onOpenChange={setShowSummaryDialog}
          onOpenSimulator={(code) => {
            if (code) setSelectedToolSubject(code);
            setActiveTab("tools");
          }}
        />
      </main>
    </div>
  );
}
