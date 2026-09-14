import { randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "af_session";
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SHORT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Secure cookies only stick over HTTPS — detect via proxy headers. */
async function isHttps(): Promise<boolean> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "";
    if (proto) return proto.split(",")[0].trim() === "https";
    return false;
  } catch {
    return false;
  }
}

export async function createSession(studentDbId: string, remember: boolean) {
  const token = randomBytes(32).toString("hex");
  const ttl = remember ? REMEMBER_TTL_MS : SHORT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await db.session.create({ data: { token, studentId: studentDbId, expiresAt } });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    ...(remember ? { maxAge: Math.floor(ttl / 1000) } : {}),
  });
  return token;
}

export async function getSessionStudent() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { student: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.student;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}
