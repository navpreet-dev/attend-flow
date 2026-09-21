"use client";

import type {
  AcademicCalendarConfig,
  TimetableEntryItem,
  HolidayItem,
} from "./academic-planner";
import type {
  ParsedTimetableResult,
  ParsedAcademicCalendarResult,
} from "./academic-document-parser";

export interface PlannerState {
  configured: boolean;
  calendar: AcademicCalendarConfig | null;
  calendarSourceFileName?: string | null;
  timetable: TimetableEntryItem[];
  timetableSourceFileName?: string | null;
}

export async function apiGetPlanner(): Promise<PlannerState> {
  const res = await fetch("/api/planner", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load academic planner (HTTP ${res.status})`);
  }
  return res.json();
}

export async function apiSaveCalendar(calendar: {
  startDate: string;
  endDate: string;
  workingDays: number[];
  holidays: HolidayItem[];
  sourceFileName?: string | null;
}): Promise<void> {
  const res = await fetch("/api/planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calendar),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || "Failed to save academic calendar");
  }
}

export async function apiSaveTimetable(
  entries: TimetableEntryItem[],
  sourceFileName?: string | null,
  offDays?: number[]
): Promise<void> {
  const res = await fetch("/api/planner/timetable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries, sourceFileName, offDays: offDays ?? [] }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || "Failed to save timetable entries");
  }
}

export async function apiClearPlanner(): Promise<void> {
  const res = await fetch("/api/planner", {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to clear academic planner");
  }
}

export type UploadTimetableResponse = {
  ok: true;
  type: "timetable";
  fileName: string;
  extractedVia: string;
  result: ParsedTimetableResult;
};

export type UploadCalendarResponse = {
  ok: true;
  type: "calendar";
  fileName: string;
  extractedVia: string;
  result: ParsedAcademicCalendarResult;
};

export async function apiUploadPlannerDocument(
  file: File,
  type: "timetable" | "calendar"
): Promise<UploadTimetableResponse | UploadCalendarResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);

  const res = await fetch("/api/planner/upload", {
    method: "POST",
    body: formData,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.error || `Failed to process ${type} upload (HTTP ${res.status})`);
  }

  return json;
}
