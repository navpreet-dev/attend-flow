"use client";

import type { DashboardPayload } from "@/lib/types";
import { mustAttend, canSkip } from "@/lib/af-client";

export type NotificationSeverity = "high" | "medium" | "low";
export type NotificationType =
  | "CRITICAL_LOW"
  | "NEAR_THRESHOLD"
  | "RECOVERY_MILESTONE"
  | "SIGNIFICANT_DROP"
  | "SYNC_SUCCESS_INFO";

export interface SmartNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  subjectCode?: string;
  subjectName?: string;
  timestamp: string;
  actionSubjectCode?: string;
}

const DISMISSED_KEY = "attendflow_dismissed_notifications_v1";

export function getDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function dismissNotificationId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const ids = getDismissedIds();
    ids.add(id);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore storage errors */
  }
}

export function clearDismissedNotifications(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Evaluates current attendance data and previous state to generate a prioritized list of smart alerts.
 */
export function generateSmartNotifications(
  current: DashboardPayload,
  previous?: DashboardPayload | null
): SmartNotification[] {
  const notifications: SmartNotification[] = [];
  const threshold = current.settings.threshold;
  const now = new Date().toISOString();

  const prevMap = new Map<string, { pct: number; attended: number; total: number }>();
  if (previous && previous.subjects) {
    for (const s of previous.subjects) {
      prevMap.set(s.subjectCode, { pct: s.percentage, attended: s.attended, total: s.total });
    }
  }

  for (const s of current.subjects) {
    if (s.total === 0) continue;

    const prev = prevMap.get(s.subjectCode);

    // 1. Critical Low Attendance (< threshold)
    if (s.percentage < threshold) {
      const needed = mustAttend(s.attended, s.total, threshold);
      notifications.push({
        id: `crit-${s.subjectCode}-${Math.floor(s.percentage)}-${s.total}`,
        type: "CRITICAL_LOW",
        severity: "high",
        title: `Low attendance: ${s.subjectName}`,
        message: `${s.subjectName} is at ${s.percentage.toFixed(1)}% (below ${threshold}%). Attend the next ${needed} class${needed === 1 ? "" : "es"} in a row to recover.`,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        timestamp: now,
        actionSubjectCode: s.subjectCode,
      });
      continue; // don't double notify with near-threshold
    }

    // 2. Recovery Milestone: Was below threshold previously and now above!
    if (prev && prev.pct < threshold && s.percentage >= threshold) {
      notifications.push({
        id: `recov-${s.subjectCode}-${s.total}`,
        type: "RECOVERY_MILESTONE",
        severity: "low",
        title: `Milestone: ${s.subjectName} recovered!`,
        message: `Great progress! ${s.subjectName} recovered from ${prev.pct.toFixed(1)}% to ${s.percentage.toFixed(1)}% and is now above ${threshold}%.`,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        timestamp: now,
        actionSubjectCode: s.subjectCode,
      });
      continue;
    }

    // 3. Near Threshold Warning (Within 3.5% above threshold)
    if (s.percentage >= threshold && s.percentage <= threshold + 3.5) {
      const skip = canSkip(s.attended, s.total, threshold);
      notifications.push({
        id: `near-${s.subjectCode}-${Math.floor(s.percentage)}-${s.total}`,
        type: "NEAR_THRESHOLD",
        severity: "medium",
        title: `Borderline target: ${s.subjectName}`,
        message: `${s.subjectName} is at ${s.percentage.toFixed(1)}% (target: ${threshold}%). You have only ${skip} safe bunk${skip === 1 ? "" : "s"} left before dropping below target.`,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        timestamp: now,
        actionSubjectCode: s.subjectCode,
      });
    }

    // 4. Significant Drop after sync (> 3% drop in single sync)
    if (prev && prev.pct - s.percentage >= 3.0) {
      notifications.push({
        id: `drop-${s.subjectCode}-${s.total}`,
        type: "SIGNIFICANT_DROP",
        severity: "medium",
        title: `Attendance drop: ${s.subjectName}`,
        message: `${s.subjectName} dropped by -${(prev.pct - s.percentage).toFixed(1)}% (from ${prev.pct.toFixed(1)}% to ${s.percentage.toFixed(1)}%).`,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        timestamp: now,
        actionSubjectCode: s.subjectCode,
      });
    }
  }

  // Sort by severity (high -> medium -> low)
  const order: Record<NotificationSeverity, number> = { high: 0, medium: 1, low: 2 };
  return notifications.sort((a, b) => order[a.severity] - order[b.severity]);
}
