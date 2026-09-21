"use client";

import type {
  AcademicCalendarConfig,
  TimetableEntryItem,
  HolidayItem,
} from "./academic-planner";

export interface PlannerState {
  configured: boolean;
  calendar: AcademicCalendarConfig | null;
  timetable: TimetableEntryItem[];
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
  entries: TimetableEntryItem[]
): Promise<void> {
  const res = await fetch("/api/planner/timetable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
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
