import { db } from "@/lib/db";
import {
  fetchPortalSnapshot,
  PortalError,
  PORTAL_SESSION_REUSE_MS,
  type PortalCookie,
  type PortalPurpose,
} from "@/lib/portal";
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
 * Subjects whose report could not be fetched (reportOk=false) keep their last
 * stored values — we never overwrite real attendance with misleading zeros.
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
      ...(remember ? persistPortalCookies(snapshot) : { portalCookiesEnc: null, portalCookiesAt: null }),
    },
  });

  for (const s of snapshot.subjects) {
    if (!s.reportOk) continue;
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

type PortalCookiesUpdate =
  | { portalCookiesEnc: string; portalCookiesAt: Date }
  | { portalCookiesEnc: null; portalCookiesAt: null };

/**
 * Encrypts the authenticated portal cookies of a snapshot for at-rest storage.
 * Stored ONLY under the same explicit remember-me consent as the password —
 * they are AES-256-GCM sealed like every other portal secret.
 */
function persistPortalCookies(snapshot: {
  cookies: PortalCookie[];
}): PortalCookiesUpdate {
  if (!snapshot.cookies || snapshot.cookies.length === 0) {
    return { portalCookiesEnc: null, portalCookiesAt: null };
  }
  try {
    return {
      portalCookiesEnc: encryptSecret(JSON.stringify(snapshot.cookies)),
      portalCookiesAt: new Date(),
    };
  } catch {
    return { portalCookiesEnc: null, portalCookiesAt: null };
  }
}

/** Decrypts stored portal cookies, or null when absent/expired/unreadable. */
function loadPortalCookies(student: {
  portalCookiesEnc: string | null;
  portalCookiesAt: Date | null;
}): PortalCookie[] | null {
  if (!student.portalCookiesEnc || !student.portalCookiesAt) return null;
  if (Date.now() - student.portalCookiesAt.getTime() > PORTAL_SESSION_REUSE_MS) return null;
  try {
    const parsed = JSON.parse(decryptSecret(student.portalCookiesEnc));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter(
      (c): c is PortalCookie => c && typeof c.name === "string" && typeof c.value === "string"
    );
  } catch {
    return null;
  }
}

/**
 * Runs a full portal scrape for the student, persists the snapshot and
 * returns the fresh dashboard payload. Throws PortalError / RateLimitError.
 *
 * Request pattern (gentle on the portal firewall):
 *  1. Reuse the stored authenticated portal session when fresh — syncs then touch
 *     only /DashBoardStudent + subject reports, never the rate-limited login page.
 *  2. Fall back to a fresh portal login only when the session is missing/expired.
 */
export async function syncStudent(
  studentDbId: string,
  opts: {
    credentials?: { rollNo: string; password: string };
    remember?: boolean;
    force?: boolean;
    purpose?: PortalPurpose;
  }
): Promise<DashboardPayload> {
  const student = await db.student.findUnique({ where: { id: studentDbId } });
  if (!student) throw new PortalError("UNKNOWN", "Session not found. Please log in again.");

  const rollNo = opts.credentials?.rollNo ?? student.rollNo;
  const password =
    opts.credentials?.password ??
    (student.passwordEnc ? decryptSecret(student.passwordEnc) : null);

  if (!password) {
    if (student.passwordEnc) {
      // Stored payload is unreadable (e.g. server secret rotated). Self-heal:
      // drop it so the student is simply asked to log in again next visit.
      await db.student
        .update({
          where: { id: studentDbId },
          data: { passwordEnc: null, portalCookiesEnc: null, portalCookiesAt: null },
        })
        .catch(() => {});
    }
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
    const purpose: PortalPurpose = opts.purpose ?? "interactive";
    let ok = false;
    let message: string | null = null;
    try {
      // Freshly typed credentials mean an explicit login — always do a real login.
      // Otherwise try the stored portal session first (fewer requests, no login page).
      const storedCookies = opts.credentials ? null : loadPortalCookies(student);
      const snapshot = await fetchPortalSnapshot(rollNo, password, {
        existingCookies: storedCookies ?? undefined,
        purpose,
      });
      ok = true;
      const failedReports = snapshot.subjects.filter((s) => !s.reportOk).length;
      message =
        failedReports > 0
          ? `Synced ${snapshot.subjects.length - failedReports}/${snapshot.subjects.length} subjects (${failedReports} report${failedReports === 1 ? "" : "s"} temporarily unavailable — previous values kept)`
          : `Synced ${snapshot.subjects.length} subjects${snapshot.reusedSession ? " via saved portal session" : ""}`;

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
          ...(remember ? persistPortalCookies(snapshot) : { portalCookiesEnc: null, portalCookiesAt: null }),
          lastSyncAt: new Date(),
          lastSyncOk: true,
        },
      });

      // Upsert subjects (skip subjects whose report failed — keep last real values)
      for (const s of snapshot.subjects) {
        if (!s.reportOk) continue;
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
