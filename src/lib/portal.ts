/**
 * AGC ERP (agclms.in) student portal client.
 *
 * Flow (verified against the live portal):
 *  1. GET  https://agclms.in/Elogin/StudentLogin
 *     -> collect .AspNetCore.Antiforgery.* cookie + __RequestVerificationToken from the form
 *  2. POST StudentId / Password / __RequestVerificationToken (same URL, cookies attached)
 *     -> 302 to /DashBoardStudent on success; login form re-rendered on failure
 *  3. GET  /DashBoardStudent -> profile (name, section, dept, incharge) + subject table rows
 *     each row links to /DashBoardStudent/AttendanceReport?SAId=...
 *  4. GET  each AttendanceReport link -> <tbody> rows: <td>dd-MM-yyyy</td>...PRESENT/ABSENT
 *
 * No third-party HTML parser needed — the portal markup is stable Bootstrap/Razor output.
 */

const PORTAL_ORIGIN = "https://agclms.in";
const LOGIN_URL = `${PORTAL_ORIGIN}/Elogin/StudentLogin`;
const DASHBOARD_URL = `${PORTAL_ORIGIN}/DashBoardStudent`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 25000;

export class PortalError extends Error {
  code:
    | "INVALID_CREDENTIALS"
    | "PORTAL_DOWN"
    | "NETWORK"
    | "TIMEOUT"
    | "NO_SUBJECTS"
    | "UNKNOWN";

  constructor(code: typeof PortalError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "PortalError";
  }
}

export interface PortalProfile {
  name: string;
  course: string;
  section: string;
  department: string;
  incharge: string;
}

export interface PortalSubject {
  subjectCode: string;
  subjectName: string;
  subjectType: string;
  saId: string | null;
  attended: number;
  total: number;
  percentage: number;
}

export interface PortalLogEntry {
  subjectCode: string;
  date: string; // dd-MM-yyyy as printed by the portal
  status: "PRESENT" | "ABSENT";
}

export interface PortalSnapshot {
  profile: PortalProfile;
  subjects: PortalSubject[];
  logs: PortalLogEntry[];
  fetchedAt: string; // ISO
}

/* ------------------------------ tiny helpers ------------------------------ */

type CookieJar = Map<string, string>;

function collectCookies(jar: CookieJar, res: Response) {
  const raw: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
  for (const line of raw) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      jar.set(name, value);
    }
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

async function fetchPage(
  url: string,
  init: RequestInit,
  jar: CookieJar
): Promise<{ res: Response; html: string }> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(init.headers as Record<string, string> | undefined),
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      redirect: init.redirect ?? "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(msg)) {
      throw new PortalError("TIMEOUT", "The college portal took too long to respond. Please try again.");
    }
    throw new PortalError("NETWORK", "Could not reach the college portal. Check your connection and try again.");
  }
  collectCookies(jar, res);
  const html = await res.text();
  return { res, html };
}

function extractVerificationToken(html: string): string | null {
  // Attribute order varies between Razor renders; try both orders.
  const m =
    html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i) ||
    html.match(/value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i);
  return m ? m[1] : null;
}

function isLoginPage(html: string): boolean {
  return (
    /<title>\s*Student Login\s*-\s*AGC ERP/i.test(html) ||
    (html.includes('name="StudentId"') && html.includes('name="Password"')) ||
    /Enter Your Credentials to Login/i.test(html)
  );
}

function looksAuthenticated(html: string): boolean {
  return (
    /Role:\s*STUDENT/i.test(html) ||
    /AttendanceReport/i.test(html) ||
    /SectionName/i.test(html) ||
    /DashBoardStudent/i.test(html)
  );
}

/* ------------------------------ parsing ----------------------------------- */

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const v = stripTags(m[1]);
      if (v) return v;
    }
  }
  return null;
}

function parseProfile(dashboardHtml: string): PortalProfile {
  const name =
    firstMatch(dashboardHtml, [
      /<span\s+class=["']fs-4\s+ms-2["']\s*>([^<]+)<\/span>/i,
      /<b>([A-Za-z][A-Za-z .]{2,})<\/b>\s*\(Roll\s*No/i,
      /Welcome[,\s]+<[^>]*>([^<]+)</i,
      /Role:\s*STUDENT[\s\S]{0,400}?<b>([^<]+)<\/b>/i,
    ]) ?? "";

  const section =
    firstMatch(dashboardHtml, [
      /SectionName\s*:\s*<i>([^<]+)<\/i>/i,
      /SectionName\s*:\s*([^<\n\r]+)/i,
      /Section\s*:\s*<i>([^<]+)<\/i>/i,
    ]) ?? "";

  const incharge =
    firstMatch(dashboardHtml, [
      /Incharge\s+Name\s*:\s*([^<\n\r]+)/i,
      /Incharge\s*:\s*([^<\n\r]+)/i,
    ]) ?? "Faculty Incharge";

  const department =
    firstMatch(dashboardHtml, [
      /(Department\s+of\s+[A-Za-z &]{3,60})/i,
    ]) ?? "";

  const course =
    firstMatch(dashboardHtml, [
      /(BCA|BBA|B\.?Tech|MCA|MBA|M\.?Tech|B\.?Com|B\.?Sc|M\.?Sc|D\.?Pharmacy|B\.?Pharmacy|GNM|ANM|B\.?A\.?LL\.?B|LLB)[^<\n\r]{0,30}/i,
    ]) ?? "";

  return {
    name: name || "Student",
    course: course || "Program",
    section: section || "—",
    department: department || "—",
    incharge,
  };
}

interface SubjectRow {
  name: string;
  type: string;
  href: string;
  saId: string | null;
}

function parseSubjectRows(dashboardHtml: string): SubjectRow[] {
  const rows: SubjectRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;

  while ((m = trRe.exec(dashboardHtml)) !== null) {
    const row = m[1];
    if (!/AttendanceReport\?/i.test(row)) continue;

    const hrefMatch =
      row.match(/href=["']([^"']*AttendanceReport\?[^"']+)["']/i) ||
      row.match(/href=["']([^"']*AttendanceReport[^"']*)["']/i);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1]).trim();

    // Extract every <td> cell text in order.
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(row)) !== null) {
      const text = stripTags(td[1]);
      if (text) cells.push(text);
    }

    const saMatch = href.match(/SAId=(\d+)/i);
    const name = cells[0] ?? `Subject ${rows.length + 1}`;
    // Some rows may include extra cells (faculty etc.); second cell is the type when present.
    const type = cells[1] && cells[1].length <= 24 ? cells[1] : "Theory";

    if (name && name.toLowerCase() !== "subject") {
      rows.push({
        name,
        type,
        href: href.startsWith("http") ? href : `${PORTAL_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`,
        saId: saMatch ? saMatch[1] : null,
      });
    }
  }
  return rows;
}

const DATE_RE = /\b(\d{2})[-/](\d{2})[-/](\d{4})\b/;

function parseAttendanceReport(html: string): { attended: number; total: number; logs: PortalLogEntry[] } {
  let attended = 0;
  let total = 0;
  const logs: PortalLogEntry[] = [];

  const tbodies: string[] = [];
  const tbodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  let tb: RegExpExecArray | null;
  while ((tb = tbodyRe.exec(html)) !== null) tbodies.push(tb[1]);

  const scope = tbodies.length > 0 ? tbodies.join("\n") : html;

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(scope)) !== null) {
    const row = tr[1];
    const rowText = stripTags(row);
    const dm = rowText.match(DATE_RE);
    if (!dm) continue;

    let status: "PRESENT" | "ABSENT" | null = null;
    if (/\bPRESENT\b/i.test(rowText)) status = "PRESENT";
    else if (/\bABSENT\b/i.test(rowText)) status = "ABSENT";
    else if (/\bP\b/.test(rowText) && rowText.replace(/[^A-Za-z]/g, "").length <= 1) status = "PRESENT";
    else if (/\bA\b/.test(rowText) && rowText.replace(/[^A-Za-z]/g, "").length <= 1) status = "ABSENT";
    if (!status) continue;

    total += 1;
    if (status === "PRESENT") attended += 1;
    logs.push({
      subjectCode: "", // filled by caller
      date: `${dm[1]}-${dm[2]}-${dm[3]}`,
      status,
    });
  }

  return { attended, total, logs };
}

/* ------------------------------ main flow ---------------------------------- */

export async function fetchPortalSnapshot(
  studentId: string,
  password: string
): Promise<PortalSnapshot> {
  const jar: CookieJar = new Map();

  // ---- Step 1: login page (token + antiforgery cookie) --------------------
  const loginPage = await fetchPage(LOGIN_URL, { method: "GET" }, jar);
  if (loginPage.res.status >= 500) {
    throw new PortalError("PORTAL_DOWN", `College portal is currently unavailable (HTTP ${loginPage.res.status}).`);
  }
  if (loginPage.res.status >= 400) {
    throw new PortalError("PORTAL_DOWN", `College portal rejected the connection (HTTP ${loginPage.res.status}).`);
  }

  const token = extractVerificationToken(loginPage.html);
  if (!token) {
    throw new PortalError("PORTAL_DOWN", "Could not read the portal security token. The portal may be under maintenance.");
  }

  // ---- Step 2: submit credentials -----------------------------------------
  const body = new URLSearchParams({
    StudentId: studentId.trim(),
    Password: password,
    __RequestVerificationToken: token,
  });

  const post = await fetchPage(
    LOGIN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: PORTAL_ORIGIN,
        Referer: LOGIN_URL,
      },
      body: body.toString(),
      redirect: "manual",
    },
    jar
  );

  // A 3xx after POST means the server accepted the login and is redirecting.
  let dashboardHtml = "";
  if (post.res.status >= 300 && post.res.status < 400) {
    const loc = post.res.headers.get("location");
    const target = loc
      ? loc.startsWith("http")
        ? loc
        : `${PORTAL_ORIGIN}${loc.startsWith("/") ? "" : "/"}${loc}`
      : DASHBOARD_URL;
    const dash = await fetchPage(target, { method: "GET", headers: { Referer: LOGIN_URL } }, jar);
    dashboardHtml = dash.html;
  } else {
    dashboardHtml = post.html;
    // The portal may render the dashboard directly with HTTP 200.
    if (!looksAuthenticated(dashboardHtml)) {
      const dash = await fetchPage(DASHBOARD_URL, { method: "GET", headers: { Referer: LOGIN_URL } }, jar);
      if (looksAuthenticated(dash.html)) dashboardHtml = dash.html;
    }
  }

  // ---- Step 3: verify authentication ---------------------------------------
  if (isLoginPage(dashboardHtml) || !looksAuthenticated(dashboardHtml)) {
    throw new PortalError(
      "INVALID_CREDENTIALS",
      "Invalid roll number or password. Please check your AGC ERP credentials and try again."
    );
  }

  // ---- Step 4: parse profile + subject table --------------------------------
  const profile = parseProfile(dashboardHtml);
  const subjectRows = parseSubjectRows(dashboardHtml);

  if (subjectRows.length === 0) {
    throw new PortalError(
      "NO_SUBJECTS",
      "Logged in successfully, but no subjects are visible on your portal dashboard yet."
    );
  }

  // ---- Step 5: fetch each subject's attendance report ------------------------
  const subjects: PortalSubject[] = [];
  const logs: PortalLogEntry[] = [];

  // Fetch sequentially with a tiny gap — gentle on the portal, deterministic order.
  for (const row of subjectRows) {
    const code = row.saId ? `AGC-${row.saId}` : `AGC-${row.name.replace(/\s+/g, "-").toUpperCase().slice(0, 24)}`;
    let attended = 0;
    let total = 0;
    try {
      const rep = await fetchPage(
        row.href,
        { method: "GET", headers: { Referer: DASHBOARD_URL } },
        jar
      );
      if (rep.res.ok) {
        const parsed = parseAttendanceReport(rep.html);
        attended = parsed.attended;
        total = parsed.total;
        for (const l of parsed.logs) logs.push({ ...l, subjectCode: code });
      }
    } catch {
      // Single subject report failing should not fail the whole sync.
    }
    await new Promise((r) => setTimeout(r, 120));

    const pct = total > 0 ? (attended / total) * 100 : 0;
    subjects.push({
      subjectCode: code,
      subjectName: row.name,
      subjectType: row.type,
      saId: row.saId,
      attended,
      total,
      percentage: Math.round(pct * 10) / 10,
    });
  }

  return {
    profile,
    subjects,
    logs,
    fetchedAt: new Date().toISOString(),
  };
}
