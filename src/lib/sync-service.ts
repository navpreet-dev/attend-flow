import { db } from "@/lib/db";
import { fetchPortalSnapshot, PortalError } from "@/lib/portal";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { STALE_AFTER_MS, type DashboardPayload, type SubjectInfo, type LogInfo } from "@/lib/types";

export class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Syncing too often — try again in ${retryAfterSec}s.`);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * In-memory per-student rate limiting + in-flight de-duplication so parallel
 * clicks / concurrent users never hammer the college portal.
 */
const lastSyncByRoll = new Map<string, number>();
const inFlightByStudent = new Map<string, Promise<DashboardPayload>>();
const MIN_SYNC_INTERVAL_MS = 45_000;

export async function getDashboardData(studentDbId: string): Promise<DashboardPayload> {
  const student = await db.student.findUnique({
    where: { id: studentDbId },
    include: {
      subjects: { orderBy: { subjectName: "asc" } },
      syncEvents: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!student) throw new Error("Student not found");

  const logs = await db.attendanceLog.findMany({
    where: { studentId: studentDbId },
    orderBy: { date: "desc" },
    take: 4000,
  });

  const subjectNames = new Map(student.subjects.map((s) => [s.subjectCode, s.subjectName]));

  return {
    authenticated: true,
    profile: {
      rollNo: student.rollNo,
      name: student.name ?? "Student",
      course: student.course ?? "—",
      section: student.section ?? "—",
      department: student.department ?? "—",
      incharge: student.incharge ?? "—",
    },
    subjects: student.subjects.map<SubjectInfo>((s) => ({
      subjectCode: s.subjectCode,
      subjectName: s.subjectName,
      subjectType: s.subjectType,
      attended: s.attended,
      total: s.total,
      percentage: s.percentage,
    })),
    logs: logs.map<LogInfo>((l) => ({
      subjectCode: l.subjectCode,
      subjectName: subjectNames.get(l.subjectCode),
      date: l.date,
      status: l.status as "PRESENT" | "ABSENT",
    })),
    settings: {
      threshold: student.threshold,
      autoSync: student.autoSync,
      notifyLow: student.notifyLow,
      rememberMe: student.rememberMe,
    },
    lastSyncAt: student.lastSyncAt ? student.lastSyncAt.toISOString() : null,
    lastSyncOk: student.lastSyncOk,
    stale:
      !student.lastSyncAt || Date.now() - student.lastSyncAt.getTime() > STALE_AFTER_MS,
    recentSyncs: student.syncEvents.map((e) => ({
      id: e.id,
      status: e.status,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/**
 * Persists a freshly scraped portal snapshot for a student.
 */
export async function persistSnapshot(
  studentDbId: string,
  snapshot: Awaited<ReturnType<typeof fetchPortalSnapshot>>,
  opts: { remember?: boolean } = {}
): Promise<void> {
  const student = await db.student.findUnique({ where: { id: studentDbId } });
  if (!student) throw new Error("Student not found");
  const remember = opts.remember ?? student.rememberMe;

  await db.student.update({
    where: { id: studentDbId },
    data: {
      name: snapshot.profile.name || student.name,
      course: snapshot.profile.course || student.course,
      section: snapshot.profile.section || student.section,
      department: snapshot.profile.department || student.department,
      incharge: snapshot.profile.incharge || student.incharge,
      lastSyncAt: new Date(),
      lastSyncOk: true,
    },
  });

  for (const s of snapshot.subjects) {
    await db.subjectAttendance.upsert({
      where: {
        studentId_subjectCode: { studentId: studentDbId, subjectCode: s.subjectCode },
      },
      create: {
        studentId: studentDbId,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        subjectType: s.subjectType,
        saId: s.saId,
        attended: s.attended,
        total: s.total,
        percentage: s.percentage,
        lastUpdated: new Date(),
      },
      update: {
        subjectName: s.subjectName,
        subjectType: s.subjectType,
        saId: s.saId,
        attended: s.attended,
        total: s.total,
        percentage: s.percentage,
        lastUpdated: new Date(),
      },
    });
  }

  const existingLogs = await db.attendanceLog.findMany({
    where: { studentId: studentDbId },
    select: { subjectCode: true, date: true },
  });
  const have = new Set(existingLogs.map((l) => `${l.subjectCode}|${l.date}`));
  const seen = new Set<string>();
  const newLogs = snapshot.logs.filter((l) => {
    const key = `${l.subjectCode}|${l.date}`;
    if (have.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (newLogs.length > 0) {
    await db.attendanceLog.createMany({
      data: newLogs.map((l) => ({
        studentId: studentDbId,
        subjectCode: l.subjectCode,
        date: l.date,
        status: l.status,
      })),
    });
  }
}

/**
 * Runs a full portal scrape for the student, persists the snapshot and
 * returns the fresh dashboard payload. Throws PortalError / RateLimitError.
 */
export async function syncStudent(
  studentDbId: string,
  opts: {
    credentials?: { rollNo: string; password: string };
    remember?: boolean;
    force?: boolean;
  }
): Promise<DashboardPayload> {
  const student = await db.student.findUnique({ where: { id: studentDbId } });
  if (!student) throw new PortalError("UNKNOWN", "Session not found. Please log in again.");

  const rollNo = opts.credentials?.rollNo ?? student.rollNo;
  const password =
    opts.credentials?.password ??
    (student.passwordEnc ? decryptSecret(student.passwordEnc) : null);

  if (!password) {
    throw new PortalError(
      "UNKNOWN",
      "Saved credentials are not available. Please log in again with your portal password to sync."
    );
  }

  // Rate limiting (fresh credentials typed by the user bypass it — that's a login).
  if (!opts.credentials && !opts.force) {
    const last = lastSyncByRoll.get(rollNo);
    if (last && Date.now() - last < MIN_SYNC_INTERVAL_MS) {
      throw new RateLimitError(Math.ceil((MIN_SYNC_INTERVAL_MS - (Date.now() - last)) / 1000));
    }
  }

  // De-duplicate concurrent syncs for the same student.
  const existing = inFlightByStudent.get(studentDbId);
  if (existing) return existing;

  const job = (async (): Promise<DashboardPayload> => {
    const remember = opts.remember ?? student.rememberMe;
    let ok = false;
    let message: string | null = null;
    try {
      const snapshot = await fetchPortalSnapshot(rollNo, password);
      ok = true;
      message = `Synced ${snapshot.subjects.length} subjects`;

      await db.student.update({
        where: { id: studentDbId },
        data: {
          name: snapshot.profile.name || student.name,
          course: snapshot.profile.course || student.course,
          section: snapshot.profile.section || student.section,
          department: snapshot.profile.department || student.department,
          incharge: snapshot.profile.incharge || student.incharge,
          rememberMe: remember,
          ...(remember ? { passwordEnc: encryptSecret(password) } : {}),
          lastSyncAt: new Date(),
          lastSyncOk: true,
        },
      });

      // Upsert subjects
      for (const s of snapshot.subjects) {
        await db.subjectAttendance.upsert({
          where: {
            studentId_subjectCode: { studentId: studentDbId, subjectCode: s.subjectCode },
          },
          create: {
            studentId: studentDbId,
            subjectCode: s.subjectCode,
            subjectName: s.subjectName,
            subjectType: s.subjectType,
            saId: s.saId,
            attended: s.attended,
            total: s.total,
            percentage: s.percentage,
            lastUpdated: new Date(),
          },
          update: {
            subjectName: s.subjectName,
            subjectType: s.subjectType,
            saId: s.saId,
            attended: s.attended,
            total: s.total,
            percentage: s.percentage,
            lastUpdated: new Date(),
          },
        });
      }

      // Append-only log rows (dedup on subject+date)
      const existingLogs = await db.attendanceLog.findMany({
        where: { studentId: studentDbId },
        select: { subjectCode: true, date: true },
      });
      const have = new Set(existingLogs.map((l) => `${l.subjectCode}|${l.date}`));
      const seen = new Set<string>();
      const newLogs = snapshot.logs.filter((l) => {
        const key = `${l.subjectCode}|${l.date}`;
        if (have.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (newLogs.length > 0) {
        await db.attendanceLog.createMany({
          data: newLogs.map((l) => ({
            studentId: studentDbId,
            subjectCode: l.subjectCode,
            date: l.date,
            status: l.status,
          })),
        });
      }
    } catch (e) {
      message = e instanceof Error ? e.message : "Unknown sync error";
      await db.student
        .update({ where: { id: studentDbId }, data: { lastSyncOk: false } })
        .catch(() => {});
      throw e;
    } finally {
      lastSyncByRoll.set(rollNo, Date.now());
      inFlightByStudent.delete(studentDbId);
      await db.syncEvent
        .create({
          data: {
            studentId: studentDbId,
            status: ok ? "SUCCESS" : "FAILED",
            message,
          },
        })
        .catch(() => {});
    }

    return getDashboardData(studentDbId);
  })();

  inFlightByStudent.set(studentDbId, job);
  return job;
}
