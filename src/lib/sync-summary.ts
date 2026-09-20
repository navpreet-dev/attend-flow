import type { DashboardPayload, SubjectInfo } from "@/lib/types";
import { mustAttend, overallStats } from "@/lib/af-client";

export interface SubjectChange {
  subjectCode: string;
  subjectName: string;
  prevPercentage: number;
  nextPercentage: number;
  prevAttended: number;
  nextAttended: number;
  prevTotal: number;
  nextTotal: number;
  deltaPercentage: number;
  deltaAttended: number;
  deltaTotal: number;
  status: "IMPROVED" | "DECREASED" | "UNCHANGED";
}

export interface CriticalSubjectSummary {
  subjectCode: string;
  subjectName: string;
  percentage: number;
  mustAttendCount: number;
}

export interface SyncSummary {
  isInitialSync: boolean;
  syncedAt: string;
  totalSubjects: number;
  improvedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  overallPrevPercentage: number | null;
  overallNextPercentage: number;
  overallDeltaPercentage: number;
  changedSubjects: SubjectChange[];
  criticalSubjects: CriticalSubjectSummary[];
  newLogsRecorded: number;
  hasSignificantChanges: boolean;
}

/**
 * Computes a detailed, non-fabricated diff between the previous and freshly synced attendance payload.
 * Completely failsafe: if previous data is null or empty, it produces a clean initial sync summary.
 */
export function generateSyncSummary(
  prevData: DashboardPayload | null,
  nextData: DashboardPayload
): SyncSummary {
  const currentOverall = overallStats(nextData.subjects);
  const threshold = nextData.settings.threshold;

  const criticalSubjects: CriticalSubjectSummary[] = nextData.subjects
    .filter((s) => s.total > 0 && s.percentage < threshold)
    .map((s) => ({
      subjectCode: s.subjectCode,
      subjectName: s.subjectName,
      percentage: s.percentage,
      mustAttendCount: mustAttend(s.attended, s.total, threshold),
    }))
    .sort((a, b) => a.percentage - b.percentage);

  // Initial sync handling when no previous dataset is recorded
  if (!prevData || !prevData.subjects || prevData.subjects.length === 0) {
    return {
      isInitialSync: true,
      syncedAt: nextData.lastSyncAt || new Date().toISOString(),
      totalSubjects: nextData.subjects.length,
      improvedCount: 0,
      decreasedCount: 0,
      unchangedCount: nextData.subjects.length,
      overallPrevPercentage: null,
      overallNextPercentage: currentOverall.percentage,
      overallDeltaPercentage: 0,
      changedSubjects: [],
      criticalSubjects,
      newLogsRecorded: nextData.logs ? nextData.logs.length : 0,
      hasSignificantChanges: false,
    };
  }

  const prevOverall = overallStats(prevData.subjects);
  const prevSubjectMap = new Map<string, SubjectInfo>();
  for (const s of prevData.subjects) {
    prevSubjectMap.set(s.subjectCode, s);
  }

  const changedSubjects: SubjectChange[] = [];
  let improvedCount = 0;
  let decreasedCount = 0;
  let unchangedCount = 0;

  for (const nextSub of nextData.subjects) {
    const prevSub = prevSubjectMap.get(nextSub.subjectCode);

    if (!prevSub) {
      // Newly discovered subject
      changedSubjects.push({
        subjectCode: nextSub.subjectCode,
        subjectName: nextSub.subjectName,
        prevPercentage: 0,
        nextPercentage: nextSub.percentage,
        prevAttended: 0,
        nextAttended: nextSub.attended,
        prevTotal: 0,
        nextTotal: nextSub.total,
        deltaPercentage: nextSub.percentage,
        deltaAttended: nextSub.attended,
        deltaTotal: nextSub.total,
        status: "IMPROVED",
      });
      improvedCount++;
      continue;
    }

    const deltaPct = Math.round((nextSub.percentage - prevSub.percentage) * 10) / 10;
    const deltaAttended = nextSub.attended - prevSub.attended;
    const deltaTotal = nextSub.total - prevSub.total;

    if (deltaTotal !== 0 || deltaAttended !== 0 || deltaPct !== 0) {
      let status: "IMPROVED" | "DECREASED" | "UNCHANGED" = "UNCHANGED";
      if (deltaPct > 0 || (deltaPct === 0 && deltaAttended > 0 && deltaTotal === deltaAttended)) {
        status = "IMPROVED";
        improvedCount++;
      } else if (deltaPct < 0 || (deltaTotal > 0 && deltaAttended === 0)) {
        status = "DECREASED";
        decreasedCount++;
      } else {
        unchangedCount++;
      }

      changedSubjects.push({
        subjectCode: nextSub.subjectCode,
        subjectName: nextSub.subjectName,
        prevPercentage: prevSub.percentage,
        nextPercentage: nextSub.percentage,
        prevAttended: prevSub.attended,
        nextAttended: nextSub.attended,
        prevTotal: prevSub.total,
        nextTotal: nextSub.total,
        deltaPercentage: deltaPct,
        deltaAttended,
        deltaTotal,
        status,
      });
    } else {
      unchangedCount++;
    }
  }

  const prevLogCount = prevData.logs ? prevData.logs.length : 0;
  const nextLogCount = nextData.logs ? nextData.logs.length : 0;
  const newLogsRecorded = Math.max(0, nextLogCount - prevLogCount);

  const overallDelta =
    Math.round((currentOverall.percentage - prevOverall.percentage) * 10) / 10;

  return {
    isInitialSync: false,
    syncedAt: nextData.lastSyncAt || new Date().toISOString(),
    totalSubjects: nextData.subjects.length,
    improvedCount,
    decreasedCount,
    unchangedCount,
    overallPrevPercentage: prevOverall.percentage,
    overallNextPercentage: currentOverall.percentage,
    overallDeltaPercentage: overallDelta,
    changedSubjects: changedSubjects.sort((a, b) => Math.abs(b.deltaPercentage) - Math.abs(a.deltaPercentage)),
    criticalSubjects,
    newLogsRecorded,
    hasSignificantChanges: changedSubjects.length > 0 || newLogsRecorded > 0,
  };
}
