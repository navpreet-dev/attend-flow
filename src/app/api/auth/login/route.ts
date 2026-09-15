import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPortalSnapshot, PortalError } from "@/lib/portal";
import { persistSnapshot, getDashboardData } from "@/lib/sync-service";
import { createSession } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";

/**
 * Simple in-memory brute-force guard: per rollNo failure counting.
 * Protects the college portal from hammering with wrong passwords.
 */
const failedAttempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 6;

function registerFailure(rollNo: string) {
  const now = Date.now();
  const entry = failedAttempts.get(rollNo);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    failedAttempts.set(rollNo, { count: 1, firstAt: now });
    return failedAttempts.get(rollNo)!.count;
  }
  entry.count += 1;
  return entry.count;
}

function isLockedOut(rollNo: string): number {
  const entry = failedAttempts.get(rollNo);
  if (!entry) return 0;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failedAttempts.delete(rollNo);
    return 0;
  }
  return entry.count;
}

function clearFailures(rollNo: string) {
  failedAttempts.delete(rollNo);
}

export async function POST(req: NextRequest) {
  let body: { rollNo?: string; password?: string; remember?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rollNo = (body.rollNo ?? "").trim();
  const password = body.password ?? "";
  const remember = Boolean(body.remember);

  if (!rollNo || !password) {
    return NextResponse.json(
      { error: "Please enter both your University Roll No / Student ID and password." },
      { status: 400 }
    );
  }

  if (isLockedOut(rollNo) >= MAX_FAILURES) {
    return NextResponse.json(
      {
        error:
          "Too many failed attempts for this roll number. Please wait 15 minutes, verify your credentials on the AGC portal, and try again.",
      },
      { status: 429 }
    );
  }

  // Scrape the portal (stateless — nothing is stored until login succeeds).
  // An explicit login is always a real fresh portal login (interactive budget).
  let snapshot;
  try {
    snapshot = await fetchPortalSnapshot(rollNo, password, { purpose: "interactive" });
  } catch (e) {
    if (e instanceof PortalError) {
      if (e.code === "INVALID_CREDENTIALS") {
        const count = registerFailure(rollNo);
        const left = MAX_FAILURES - count;
        return NextResponse.json(
          {
            error:
              e.message +
              (left > 0 && left <= 3
                ? ` (${left} attempt${left === 1 ? "" : "s"} left before a temporary lockout.)`
                : ""),
          },
          { status: 401 }
        );
      }
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error while contacting the college portal." },
      { status: 500 }
    );
  }

  clearFailures(rollNo);

  // Upsert the student, persist snapshot, create session.
  const student = await db.student.upsert({
    where: { rollNo },
    create: {
      rollNo,
      name: snapshot.profile.name,
      course: snapshot.profile.course,
      section: snapshot.profile.section,
      department: snapshot.profile.department,
      incharge: snapshot.profile.incharge,
      rememberMe: remember,
      ...(remember ? { passwordEnc: encryptSecret(password) } : {}),
      lastSyncAt: new Date(),
      lastSyncOk: true,
    },
    update: {
      rememberMe: remember,
      ...(remember ? { passwordEnc: encryptSecret(password) } : { passwordEnc: null }),
      lastSyncAt: new Date(),
      lastSyncOk: true,
    },
  });

  await persistSnapshot(student.id, snapshot, { remember });
  await db.syncEvent.create({
    data: {
      studentId: student.id,
      status: "SUCCESS",
      message: `Login sync — ${snapshot.subjects.length} subjects`,
    },
  });

  await createSession(student.id, remember);
  const payload = await getDashboardData(student.id);
  return NextResponse.json(payload);
}
