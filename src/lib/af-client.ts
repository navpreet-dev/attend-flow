"use client";

import type { DashboardPayload, SubjectInfo } from "@/lib/types";

const CACHE_KEY = "af_offline_cache_v1";

export function cachePayload(data: DashboardPayload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function readCachedPayload(): DashboardPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: DashboardPayload; savedAt: number };
    if (!parsed?.data?.authenticated) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearCachedPayload() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

async function safeJson<T = any>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function apiLogin(
  rollNo: string,
  password: string,
  remember: boolean
): Promise<DashboardPayload> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rollNo, password, remember }),
  });
  const json = await safeJson<{ error?: string } & DashboardPayload>(res);
  if (!res.ok) {
    if (res.status === 503 || res.status === 504) {
      throw new Error("College LMS portal is slow or unreachable from server right now. Please try again in a moment.");
    }
    throw new Error(json?.error || `Login failed (HTTP ${res.status}). Please try again.`);
  }
  if (!json) throw new Error("Empty response from server. Please try again.");
  return json as DashboardPayload;
}

export async function apiMe(): Promise<DashboardPayload | null> {
  const res = await fetch("/api/me", { cache: "no-store" });
  const json = await safeJson<DashboardPayload>(res);
  if (!json?.authenticated) return null;
  return json;
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export async function apiSync(): Promise<DashboardPayload> {
  const res = await fetch("/api/sync", { method: "POST" });
  const json = await safeJson<{ error?: string; authenticated?: boolean } & DashboardPayload>(res);
  if (!res.ok && !json?.authenticated) {
    if (res.status === 401) throw new SessionExpiredError(json?.error || "Please log in again.");
    if (res.status === 503 || res.status === 504) {
      throw new Error("College portal timed out. Please try again in a moment.");
    }
    throw new Error(json?.error || "Sync failed.");
  }
  if (!json) throw new Error("Empty response from server.");
  return json as DashboardPayload;
}

export async function apiLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function apiSettings(patch: {
  threshold?: number;
  autoSync?: boolean;
  notifyLow?: boolean;
}): Promise<{ threshold: number; autoSync: boolean; notifyLow: boolean; rememberMe: boolean }> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Could not save settings.");
  return res.json();
}

/* ------------------------------- analytics -------------------------------- */

export function overallStats(subjects: SubjectInfo[]) {
  const attended = subjects.reduce((a, s) => a + s.attended, 0);
  const total = subjects.reduce((a, s) => a + s.total, 0);
  const percentage = total > 0 ? (attended / total) * 100 : 0;
  return { attended, total, percentage: Math.round(percentage * 10) / 10 };
}

/** Consecutive classes needed to reach the target percentage. */
export function mustAttend(attended: number, total: number, target: number): number {
  if (target >= 100) return Number.POSITIVE_INFINITY;
  const n = Math.ceil((target * total - 100 * attended) / (100 - target));
  return Math.max(0, n);
}

/** Classes that can be skipped while staying at or above the target. */
export function canSkip(attended: number, total: number, target: number): number {
  const k = Math.floor((100 * attended - target * total) / target);
  return Math.max(0, k);
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/* --------------------------------- export --------------------------------- */

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportSubjectsCsv(data: DashboardPayload) {
  const rows: (string | number)[][] = [
    ["Subject Code", "Subject Name", "Type", "Attended", "Total", "Percentage"],
    ...data.subjects.map((s) => [
      s.subjectCode,
      s.subjectName,
      s.subjectType,
      s.attended,
      s.total,
      s.percentage.toFixed(1),
    ]),
  ];
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  download(`attendflow-subjects-${data.profile?.rollNo ?? "student"}.csv`, csv, "text/csv;charset=utf-8");
}

export function exportLogsCsv(data: DashboardPayload) {
  const rows: (string | number)[][] = [["Date", "Subject", "Status"]];
  const sorted = [...data.logs].sort(
    (a, b) => parsePortalDate(b.date) - parsePortalDate(a.date)
  );
  for (const l of sorted) {
    rows.push([l.date, l.subjectName ?? l.subjectCode, l.status]);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  download(`attendflow-log-${data.profile?.rollNo ?? "student"}.csv`, csv, "text/csv;charset=utf-8");
}

export function exportJson(data: DashboardPayload) {
  download(
    `attendflow-backup-${data.profile?.rollNo ?? "student"}.json`,
    JSON.stringify(data, null, 2),
    "application/json"
  );
}

export function parsePortalDate(ddmmyyyy: string): number {
  const m = ddmmyyyy.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}
