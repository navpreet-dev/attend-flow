"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  UploadCloud,
  FileText,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Plus,
  FileUp,
  X,
  BookOpenCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import type { DashboardPayload } from "@/lib/types";
import type {
  TimetableEntryItem,
} from "@/lib/academic-planner";
import {
  apiGetPlanner,
  apiSaveCalendar,
  apiSaveTimetable,
  apiClearPlanner,
  apiUploadPlannerDocument,
  type PlannerState,
} from "@/lib/academic-planner-client";
import {
  parseTimetableDocument,
  parseAcademicCalendarDocument,
  type ParsedTimetableEntry,
  type ParsedHolidayItem,
} from "@/lib/academic-document-parser";

const DAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

interface AcademicPlannerViewProps {
  data: DashboardPayload;
  threshold?: number;
  onPlannerUpdated?: () => void;
}

export function AcademicPlannerView({
  data,
  threshold = 75,
  onPlannerUpdated,
}: AcademicPlannerViewProps) {
  const [plannerState, setPlannerState] = useState<PlannerState>({
    configured: false,
    calendar: null,
    timetable: [],
  });
  const [loading, setLoading] = useState(true);

  // Upload progress states
  const [uploadingTimetable, setUploadingTimetable] = useState(false);
  const [uploadingCalendar, setUploadingCalendar] = useState(false);
  const [uploadStepMessage, setUploadStepMessage] = useState("");

  // Review states
  const [reviewTimetable, setReviewTimetable] = useState<{
    fileName: string;
    entries: ParsedTimetableEntry[];
    extractedVia: string;
  } | null>(null);

  const [reviewCalendar, setReviewCalendar] = useState<{
    fileName: string;
    startDate: string;
    endDate: string;
    workingDays: number[];
    holidays: ParsedHolidayItem[];
    extractedVia: string;
    notes: string[];
  } | null>(null);

  // Saving states
  const [savingTimetable, setSavingTimetable] = useState(false);
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [clearing, setClearing] = useState(false);

  // File input refs
  const timetableInputRef = useRef<HTMLInputElement>(null);
  const calendarInputRef = useRef<HTMLInputElement>(null);

  // Load existing planner state
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const state = await apiGetPlanner();
        setPlannerState(state);
      } catch (err) {
        console.error("Failed to load planner:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Subject options from active student subjects
  const agcSubjectOptions = useMemo(() => {
    return data.subjects.map((s) => ({
      code: s.subjectCode,
      name: s.subjectName,
    }));
  }, [data.subjects]);

  // Handle Timetable File Upload
  async function handleTimetableFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    let timer: NodeJS.Timeout | null = null;
    try {
      setUploadingTimetable(true);
      setUploadStepMessage("Uploading timetable file...");

      timer = setTimeout(() => {
        setUploadStepMessage("Scanning timetable structure & matching subjects...");
      }, 1200);

      const response = await apiUploadPlannerDocument(file, "timetable");
      if (response.ok && response.type === "timetable") {
        setReviewTimetable({
          fileName: file.name,
          entries: response.result.entries,
          extractedVia: response.extractedVia,
        });
        toast.success(
          `Detected ${response.result.entries.length} classes from ${file.name}!`
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not extract timetable. Please try a clearer PDF or image."
      );
    } finally {
      if (timer) clearTimeout(timer);
      setUploadingTimetable(false);
      setUploadStepMessage("");
      if (timetableInputRef.current) timetableInputRef.current.value = "";
    }
  }

  // Handle Calendar File Upload
  async function handleCalendarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    let timer: NodeJS.Timeout | null = null;
    try {
      setUploadingCalendar(true);
      setUploadStepMessage("Uploading calendar file...");

      timer = setTimeout(() => {
        setUploadStepMessage("Reading semester dates and detecting holidays...");
      }, 1200);

      const response = await apiUploadPlannerDocument(file, "calendar");
      if (response.ok && response.type === "calendar") {
        setReviewCalendar({
          fileName: file.name,
          startDate: response.result.startDate,
          endDate: response.result.endDate,
          workingDays: response.result.workingDays,
          holidays: response.result.holidays,
          extractedVia: response.extractedVia,
          notes: response.result.notes,
        });
        toast.success(`Detected semester dates & ${response.result.holidays.length} holidays!`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not extract calendar dates. Please try another format."
      );
    } finally {
      if (timer) clearTimeout(timer);
      setUploadingCalendar(false);
      setUploadStepMessage("");
      if (calendarInputRef.current) calendarInputRef.current.value = "";
    }
  }

  // Quick 1-Click: Load Amritsar Group of Colleges BCA-3B Schedule
  function handleLoadAmritsarTemplate() {
    const parsedCalendar = parseAcademicCalendarDocument(
      "AMRITSAR GROUP OF COLLEGES w.e.f. 15.07.2026",
      "amritsar_calendar.pdf"
    );
    const parsedTimetable = parseTimetableDocument(
      "AMRITSAR GROUP OF COLLEGES BCA-3B",
      "amritsar_timetable.png",
      agcSubjectOptions.map((s) => ({ subjectCode: s.code, subjectName: s.name }))
    );

    setReviewCalendar({
      fileName: "Amritsar Group of Colleges Academic Calendar 2026.pdf",
      startDate: parsedCalendar.startDate,
      endDate: parsedCalendar.endDate,
      workingDays: parsedCalendar.workingDays,
      holidays: parsedCalendar.holidays,
      extractedVia: "pdf-parse",
      notes: parsedCalendar.notes,
    });

    setReviewTimetable({
      fileName: "BCA-3rd Semester (Section B) Time Table.png",
      entries: parsedTimetable.entries,
      extractedVia: "tesseract",
    });

    toast.success("Loaded Amritsar Group of Colleges BCA-3B schedule! Review and save below.");
  }

  // Save Confirmed Timetable
  async function handleConfirmSaveTimetable() {
    if (!reviewTimetable || reviewTimetable.entries.length === 0) return;

    try {
      setSavingTimetable(true);
      const itemsToSave: TimetableEntryItem[] = reviewTimetable.entries.map((e) => ({
        dayOfWeek: e.dayOfWeek,
        subjectCode: e.matchedSubjectCode || e.subjectCode || "SUBJ",
        subjectName: e.subjectName,
        startTime: e.startTime,
        endTime: e.endTime,
        room: e.room,
        teacher: e.teacher,
        matchedSubjectCode: e.matchedSubjectCode,
      }));

      await apiSaveTimetable(itemsToSave, reviewTimetable.fileName);
      const updated = await apiGetPlanner();
      setPlannerState(updated);
      setReviewTimetable(null);
      toast.success("Timetable saved and applied successfully!");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save timetable.");
    } finally {
      setSavingTimetable(false);
    }
  }

  // Save Confirmed Calendar
  async function handleConfirmSaveCalendar() {
    if (!reviewCalendar) return;

    try {
      setSavingCalendar(true);
      await apiSaveCalendar({
        startDate: reviewCalendar.startDate,
        endDate: reviewCalendar.endDate,
        workingDays: reviewCalendar.workingDays,
        holidays: reviewCalendar.holidays.map((h) => ({
          date: h.date,
          name: h.name,
        })),
        sourceFileName: reviewCalendar.fileName,
      });

      const updated = await apiGetPlanner();
      setPlannerState(updated);
      setReviewCalendar(null);
      toast.success("Academic calendar saved and applied successfully!");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save calendar.");
    } finally {
      setSavingCalendar(false);
    }
  }

  // Clear Planner
  async function handleClearPlanner() {
    try {
      setClearing(true);
      await apiClearPlanner();
      setPlannerState({
        configured: false,
        calendar: null,
        timetable: [],
      });
      toast.success("Academic planner cleared. AttendFlow restored to default.");
      onPlannerUpdated?.();
    } catch (err) {
      toast.error("Failed to clear planner data.");
    } finally {
      setClearing(false);
    }
  }

  // Review timetable entry updater
  function updateReviewTimetableEntry(
    id: string,
    updates: Partial<ParsedTimetableEntry>
  ) {
    if (!reviewTimetable) return;
    setReviewTimetable({
      ...reviewTimetable,
      entries: reviewTimetable.entries.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    });
  }

  // Remove entry from review
  function removeReviewTimetableEntry(id: string) {
    if (!reviewTimetable) return;
    setReviewTimetable({
      ...reviewTimetable,
      entries: reviewTimetable.entries.filter((e) => e.id !== id),
    });
  }

  // Remove holiday from review calendar
  function removeReviewHoliday(index: number) {
    if (!reviewCalendar) return;
    setReviewCalendar({
      ...reviewCalendar,
      holidays: reviewCalendar.holidays.filter((_, i) => i !== index),
    });
  }

  // Add holiday to review calendar
  const [newHolDate, setNewHolDate] = useState("");
  const [newHolName, setNewHolName] = useState("");
  function addReviewHoliday() {
    if (!reviewCalendar || !newHolDate) return;
    setReviewCalendar({
      ...reviewCalendar,
      holidays: [
        ...reviewCalendar.holidays,
        { date: newHolDate, name: newHolName.trim() || "Holiday" },
      ],
    });
    setNewHolDate("");
    setNewHolName("");
  }

  return (
    <div className="space-y-6">
      {/* Hidden file inputs */}
      <input
        ref={timetableInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
        className="hidden"
        onChange={handleTimetableFileSelect}
      />
      <input
        ref={calendarInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
        className="hidden"
        onChange={handleCalendarFileSelect}
      />

      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-primary/5 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              <span>Smart Academic Planner</span>
              <span className="text-muted-foreground">· Optional Planning Tool</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Upload Timetable & Academic Calendar
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Upload your existing timetable and academic calendar. AttendFlow automatically
              reads them, detects your weekly schedule and holidays, and uses them to power smart recovery
              and bunk simulations.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadAmritsarTemplate}
              className="text-xs bg-primary/5 border-primary/30 hover:bg-primary/10 text-primary"
            >
              <BookOpenCheck className="h-3.5 w-3.5 mr-1.5" />
              1-Click: Amritsar BCA-3B Schedule
            </Button>

            {plannerState.configured && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearPlanner}
                disabled={clearing}
                className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30 dark:border-rose-900"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {clearing ? "Clearing..." : "Reset"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Upload Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Timetable Upload Dropzone */}
        <Card className="border-border/80 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Weekly Timetable</CardTitle>
                  <CardDescription className="text-xs">
                    Your weekly class schedule
                  </CardDescription>
                </div>
              </div>
              {plannerState.timetable.length > 0 ? (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px]">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {plannerState.timetable.length} classes active
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px]">
                  Not uploaded
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
            <div
              onClick={() => !uploadingTimetable && timetableInputRef.current?.click()}
              className="group cursor-pointer rounded-xl border-2 border-dashed border-border/80 hover:border-primary/60 bg-muted/20 hover:bg-primary/5 p-6 transition-all text-center flex flex-col items-center justify-center gap-2"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-xs group-hover:scale-105 transition-transform text-primary">
                {uploadingTimetable ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <UploadCloud className="h-5 w-5" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {uploadingTimetable
                    ? uploadStepMessage || "Scanning timetable..."
                    : plannerState.timetable.length > 0
                    ? "Upload New Timetable to Replace"
                    : "Choose Timetable File"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports: <strong className="text-foreground/80 font-medium">PDF, JPG, JPEG, PNG, DOC, DOCX</strong>
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploadingTimetable}
                className="mt-2 text-xs"
              >
                <FileUp className="h-3.5 w-3.5 mr-1.5" />
                {uploadingTimetable ? "Reading file..." : "Browse File"}
              </Button>
            </div>

            {plannerState.timetableSourceFileName && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5 truncate">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">Active file: <strong className="text-foreground">{plannerState.timetableSourceFileName}</strong></span>
                </span>
                <span className="text-[11px] shrink-0 font-medium">{plannerState.timetable.length} weekly classes</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Academic Calendar Upload Dropzone */}
        <Card className="border-border/80 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Academic Calendar</CardTitle>
                  <CardDescription className="text-xs">
                    Semester dates & holidays
                  </CardDescription>
                </div>
              </div>
              {plannerState.calendar ? (
                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px]">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px]">
                  Not uploaded
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
            <div
              onClick={() => !uploadingCalendar && calendarInputRef.current?.click()}
              className="group cursor-pointer rounded-xl border-2 border-dashed border-border/80 hover:border-primary/60 bg-muted/20 hover:bg-primary/5 p-6 transition-all text-center flex flex-col items-center justify-center gap-2"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-xs group-hover:scale-105 transition-transform text-primary">
                {uploadingCalendar ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : (
                  <UploadCloud className="h-5 w-5" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {uploadingCalendar
                    ? uploadStepMessage || "Scanning calendar..."
                    : plannerState.calendar
                    ? "Upload New Calendar to Replace"
                    : "Choose Academic Calendar File"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports: <strong className="text-foreground/80 font-medium">PDF, JPG, JPEG, PNG, DOC, DOCX</strong>
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploadingCalendar}
                className="mt-2 text-xs"
              >
                <FileUp className="h-3.5 w-3.5 mr-1.5" />
                {uploadingCalendar ? "Reading file..." : "Browse File"}
              </Button>
            </div>

            {plannerState.calendar && (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5 truncate">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">
                    {plannerState.calendarSourceFileName ? (
                      <>Active: <strong className="text-foreground">{plannerState.calendarSourceFileName}</strong></>
                    ) : (
                      <>Semester: <strong className="text-foreground">{plannerState.calendar.startDate} to {plannerState.calendar.endDate}</strong></>
                    )}
                  </span>
                </span>
                <span className="text-[11px] shrink-0 font-medium">
                  {plannerState.calendar.holidays.length} holidays
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* REVIEW MODAL: Detected Timetable */}
      <Dialog open={Boolean(reviewTimetable)} onOpenChange={(open) => !open && setReviewTimetable(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
          <DialogHeader className="space-y-1 shrink-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs">
                Auto-Detected ({reviewTimetable?.entries.length || 0} classes)
              </Badge>
              <span className="text-xs text-muted-foreground truncate">{reviewTimetable?.fileName}</span>
            </div>
            <DialogTitle className="text-xl">Review Detected Timetable</DialogTitle>
            <DialogDescription className="text-xs">
              Review your scheduled classes and confirm the AGC attendance courses below. Click Save & Apply when ready.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 my-2">
            {reviewTimetable?.entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs space-y-2 text-xs"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[11px] font-semibold">
                      {DAY_NAMES[entry.dayOfWeek] || `Day ${entry.dayOfWeek}`}
                    </Badge>
                    <span className="font-mono text-muted-foreground">
                      {entry.startTime} – {entry.endTime}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {entry.matchedSubjectCode ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px]">
                        ✓ {entry.matchedSubjectName || "Matched with AGC"}
                      </Badge>
                    ) : (
                      <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px]">
                        Needs subject mapping
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-rose-600"
                      onClick={() => removeReviewTimetableEntry(entry.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
                      Detected Class Title
                    </label>
                    <p className="font-medium text-foreground truncate">{entry.subjectName}</p>
                    {(entry.room || entry.teacher) && (
                      <p className="text-[11px] text-muted-foreground">
                        {[entry.room, entry.teacher].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider">
                      Maps to AGC Attendance Course
                    </label>
                    <Select
                      value={entry.matchedSubjectCode || "none"}
                      onValueChange={(val) => {
                        const matched = agcSubjectOptions.find((o) => o.code === val);
                        updateReviewTimetableEntry(entry.id, {
                          matchedSubjectCode: val === "none" ? null : val,
                          matchedSubjectName: matched ? matched.name : null,
                          matchConfidence: val === "none" ? "none" : "high",
                          needsReview: val === "none",
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs mt-0.5">
                        <SelectValue placeholder="Select AGC course..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-muted-foreground">
                          -- Not Mapped (Ignore for Attendance) --
                        </SelectItem>
                        {agcSubjectOptions.map((subj) => (
                          <SelectItem key={subj.code} value={subj.code}>
                            {subj.name} ({subj.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="shrink-0 pt-2 flex flex-row items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewTimetable(null)}
              disabled={savingTimetable}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmSaveTimetable}
              disabled={savingTimetable || !reviewTimetable?.entries.length}
            >
              {savingTimetable ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Save & Apply Timetable
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REVIEW MODAL: Detected Academic Calendar */}
      <Dialog open={Boolean(reviewCalendar)} onOpenChange={(open) => !open && setReviewCalendar(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
          <DialogHeader className="space-y-1 shrink-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-xs">
                Auto-Detected ({reviewCalendar?.holidays.length || 0} holidays)
              </Badge>
              <span className="text-xs text-muted-foreground truncate">{reviewCalendar?.fileName}</span>
            </div>
            <DialogTitle className="text-xl">Review Academic Calendar</DialogTitle>
            <DialogDescription className="text-xs">
              Confirm your semester dates and detected holidays. These dates will exclude classes from recovery planning.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 my-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Semester Start Date</label>
                <Input
                  type="date"
                  value={reviewCalendar?.startDate || ""}
                  onChange={(e) =>
                    setReviewCalendar((prev) => prev ? { ...prev, startDate: e.target.value } : null)
                  }
                  className="h-8 text-xs mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Semester End Date</label>
                <Input
                  type="date"
                  value={reviewCalendar?.endDate || ""}
                  onChange={(e) =>
                    setReviewCalendar((prev) => prev ? { ...prev, endDate: e.target.value } : null)
                  }
                  className="h-8 text-xs mt-1"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between pb-1">
                <span className="font-semibold text-foreground">
                  Detected Holidays ({reviewCalendar?.holidays.length || 0})
                </span>
                <span className="text-[11px] text-muted-foreground">Excluded from class counts</span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {reviewCalendar?.holidays.map((h, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-[11px] font-semibold text-foreground shrink-0">{h.date}</span>
                      <span className="truncate text-muted-foreground">{h.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-rose-600 shrink-0"
                      onClick={() => removeReviewHoliday(idx)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Add custom holiday */}
              <div className="flex items-center gap-2 pt-2">
                <Input
                  type="date"
                  value={newHolDate}
                  onChange={(e) => setNewHolDate(e.target.value)}
                  className="h-7 text-xs w-36"
                />
                <Input
                  placeholder="Holiday label (e.g. Diwali)"
                  value={newHolName}
                  onChange={(e) => setNewHolName(e.target.value)}
                  className="h-7 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={addReviewHoliday}
                  disabled={!newHolDate}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 pt-2 flex flex-row items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewCalendar(null)}
              disabled={savingCalendar}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmSaveCalendar}
              disabled={savingCalendar}
            >
              {savingCalendar ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Save & Apply Calendar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active Schedule Overview (if configured) */}
      {plannerState.configured && plannerState.calendar && (
        <Card className="border-emerald-500/25 bg-emerald-500/5 shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                    Active Planning Schedule
                  </CardTitle>
                  <CardDescription className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    Your attendance calculator & recovery tools are utilizing this schedule
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-lg bg-background/80 p-3 border border-border/60">
                <p className="text-[10px] text-muted-foreground uppercase font-medium">Semester Period</p>
                <p className="font-semibold text-foreground mt-0.5">
                  {plannerState.calendar.startDate} → {plannerState.calendar.endDate}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {plannerState.calendar.holidays.length} excluded holiday dates
                </p>
              </div>

              <div className="rounded-lg bg-background/80 p-3 border border-border/60">
                <p className="text-[10px] text-muted-foreground uppercase font-medium">Weekly Classes</p>
                <p className="font-semibold text-foreground mt-0.5">
                  {plannerState.timetable.length} scheduled classes
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {new Set(plannerState.timetable.map((t) => t.matchedSubjectCode || t.subjectCode)).size} subjects mapped
                </p>
              </div>

              <div className="rounded-lg bg-background/80 p-3 border border-border/60 sm:col-span-2 lg:col-span-1">
                <p className="text-[10px] text-muted-foreground uppercase font-medium">Planning Status</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  Active in Calculator & Simulator
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Future classes calculated deterministically
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Safety / Reality Rule Notice */}
      <div className="rounded-xl border border-muted bg-muted/30 p-3.5 text-xs text-muted-foreground flex items-start gap-2.5">
        <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <p>
          <strong className="text-foreground">Planning calculation note:</strong> Timetable and calendar
          schedules are user-provided planning data. Real-world classes may be rescheduled, canceled, or
          have extra sessions by faculty. AttendFlow uses this information strictly for mathematical
          projections.
        </p>
      </div>
    </div>
  );
}
