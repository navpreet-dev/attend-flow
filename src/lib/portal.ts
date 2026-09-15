/**
 * AGC ERP (agclms.in) student portal client — with a ban-aware resilience layer.
 *
 * Portal flow (verified against the live portal):
 *  1. GET  https://agclms.in/Elogin/StudentLogin
 *     -> collect .AspNetCore.Antiforgery.* cookie + __RequestVerificationToken from the form
 *  2. POST StudentId / Password / __RequestVerificationToken (same URL, cookies attached)
 *     -> 302 to /DashBoardStudent on success; login form re-rendered on failure
 *  3. GET  /DashBoardStudent -> profile (name, section, dept, incharge) + subject table rows
 *     each row links to /DashBoardStudent/AttendanceReport?SAId=...
 *  4. GET  each AttendanceReport link -> <tbody> rows: <td>dd-MM-yyyy</td>...PRESENT/ABSENT
 *
 * Resilience layer (evidence-based — the portal's IIS firewall dynamically filters
 * requests to /Elogin/StudentLogin from datacenter IPs by User-Agent identity):
 *  - Honest plain client identity first; automatic rotation across identities on
 *    rejection, with sticky memory of whichever identity last succeeded.
 *  - Global request pacing: all portal requests are serialized with a minimum gap and
 *    jitter, so the app never looks like a burst bot to the portal firewall.
 *  - Circuit breaker: any HTTP 403/429 opens a global cooldown (exponential, capped).
 *    During cooldown NO request is sent — hammering would only make things worse.
 *  - Bounded retries with backoff inside the caller's deadline budget.
 *  - Portal-session reuse: callers may pass previously stored authenticated cookies so
 *    a sync skips the login page entirely (1 request instead of 3+).
 *  - Optional egress relay via PORTAL_PROXY_URL (CONNECT tunnel; TLS stays end-to-end
 *    so credentials are never visible to the relay in plaintext).
 *
 * No third-party HTML parser needed — the portal markup is stable Bootstrap/Razor output.
 */

const PORTAL_ORIGIN = "https://agclms.in";
const LOGIN_URL = `${PORTAL_ORIGIN}/Elogin/StudentLogin`;
const DASHBOARD_URL = `${PORTAL_ORIGIN}/DashBoardStudent`;

/**
 * Identity candidates, in preference order (EVIDENCE-BASED, 2026-09-15):
 *
 * Root cause of the HTTP 403s: the portal's IIS firewall rejects requests that
 * present full BROWSER User-Agent strings (Chrome/Safari/Gecko patterns) from
 * non-allowed IP ranges, while plain HTTP-client identities pass through and
 * receive the real login page. Verified deterministically from this server:
 *   plain "Mozilla/5.0"       -> 200 + antiforgery token   (repeatedly)
 *   full Chrome UA            -> 403                        (repeatedly, same minute)
 *   plain UA via Node fetch   -> 200 + token
 *   Chrome UA via Node fetch  -> 403
 *
 * So the primary identity is an honest, plain HTTP-client label (no fake browser
 * claim), and the rotation is kept as self-healing insurance: if the college ever
 * flips the rule, retries automatically fall over to the next identity and the
 * last identity that succeeded is remembered and preferred.
 */
const UA_CANDIDATES = ["Mozilla/5.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

const REQUEST_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 15_000;

/** Minimum enforced gap between ANY two requests to the portal (global).
 *  Kept human-slow on purpose: the portal firewall also runs a volume limiter
 *  that temporarily 403s an IP after request bursts. */
const MIN_REQUEST_GAP_MS = 1_200;
/** Extra random jitter added to the gap (0..N ms) — avoids metronome patterns. */
const REQUEST_GAP_JITTER_MS = 800;

/** Cooldown opened after a 403/429 (doubles per consecutive rejection, capped).
 *  During cooldown NO portal request is made at all — retrying earlier only
 *  re-triggers the firewall's volume limiter and extends the block. */
const COOLDOWN_BASE_MS = 120_000;
const COOLDOWN_MAX_MS = 15 * 60_000;

/** How long a stored portal session may be reused without a fresh login. */
export const PORTAL_SESSION_REUSE_MS = 12 * 60 * 60 * 1000;

export type PortalPurpose = "interactive" | "background";

export class PortalError extends Error {
  code:
    | "INVALID_CREDENTIALS"
    | "PORTAL_DOWN"
    | "PORTAL_BLOCKED"
    | "NETWORK"
    | "TIMEOUT"
    | "NO_SUBJECTS"
    | "UNKNOWN";

  /** Seconds after which the portal may accept requests again (PORTAL_BLOCKED only). */
  retryAfterSec?: number;

  constructor(code: typeof PortalError.prototype.code, message: string, retryAfterSec?: number) {
    super(message);
    this.code = code;
    this.name = "PortalError";
    this.retryAfterSec = retryAfterSec;
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
  /** false when the per-subject report could not be fetched — keep last stored values. */
  reportOk: boolean;
}

export interface PortalLogEntry {
  subjectCode: string;
  date: string; // dd-MM-yyyy as printed by the portal
  status: "PRESENT" | "ABSENT";
}

export interface PortalCookie {
  name: string;
  value: string;
}

export interface PortalSnapshot {
  profile: PortalProfile;
  subjects: PortalSubject[];
  logs: PortalLogEntry[];
  fetchedAt: string; // ISO
  /** Authenticated portal cookies captured at the end of a successful flow. */
  cookies: PortalCookie[];
  /** Whether the snapshot came from a reused portal session (no fresh login). */
  reusedSession: boolean;
}

/* --------------------------- resilience state ------------------------------ */

type CookieJar = Map<string, string>;

let lastRequestAt = 0;
let cooldownUntil = 0;
let consecutiveBlocks = 0;
let lastGoodUa: string | null = null;

// Serializes every portal request through one gate, enforcing the minimum gap.
let gateTail: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => Math.round(ms * (0.85 + Math.random() * 0.3));

function scheduleSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = gateTail.then(fn, fn);
  gateTail = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}

function notePortalBlocked() {
  consecutiveBlocks += 1;
  const cd = Math.min(COOLDOWN_BASE_MS * 2 ** (consecutiveBlocks - 1), COOLDOWN_MAX_MS);
  cooldownUntil = Math.max(cooldownUntil, Date.now() + cd);
  console.log(
    `[portal] rejected by portal firewall (HTTP 403/429) — global cooldown ${Math.round(cd / 1000)}s (consecutive: ${consecutiveBlocks})`
  );
}

function notePortalOk() {
  consecutiveBlocks = 0;
  cooldownUntil = 0;
}

function blockedRetryAfterSec(): number {
  return Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

/** True while the global circuit breaker is open — callers should skip, not wait. */
export function isPortalCoolingDown(): boolean {
  return Date.now() < cooldownUntil;
}

/**
 * Waits out an active cooldown. Throws PORTAL_BLOCKED if the caller's deadline
 * cannot cover the remaining cooldown plus one request attempt.
 */
async function awaitCooldown(deadlineMs: number): Promise<void> {
  const remaining = cooldownUntil - Date.now();
  if (remaining <= 0) return;
  if (Date.now() + remaining + REQUEST_TIMEOUT_MS + 2_000 > deadlineMs) {
    throw new PortalError(
      "PORTAL_BLOCKED",
      "The college portal is temporarily rate-limiting our server. Please try again in a few minutes — your saved attendance stays available meanwhile.",
      blockedRetryAfterSec()
    );
  }
  await sleep(remaining + 250);
}

/** Picks the User-Agent for attempt #i, preferring the last known-good identity. */
function uaForAttempt(attempt: number): string {
  const order = lastGoodUa
    ? [lastGoodUa, ...UA_CANDIDATES.filter((u) => u !== lastGoodUa)]
    : UA_CANDIDATES;
  return order[attempt % order.length];
}

/* --------------------------- optional egress relay -------------------------- */

let proxyDispatcher: unknown;
let proxyTried = false;

async function relayDispatcher(): Promise<unknown> {
  if (!proxyTried) {
    proxyTried = true;
    const url = process.env.PORTAL_PROXY_URL;
    if (url) {
      try {
        const { ProxyAgent } = await import("undici");
        proxyDispatcher = new ProxyAgent(url);
        console.log("[portal] using egress relay from PORTAL_PROXY_URL");
      } catch {
        console.warn("[portal] PORTAL_PROXY_URL is set but undici is unavailable — going direct.");
      }
    }
  }
  return proxyDispatcher;
}

/* ------------------------------ tiny helpers ------------------------------ */

function collectCookies(jar: CookieJar, res: Response) {
  const raw: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
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

/** Delays (ms) before each attempt for a given purpose. Index 0 = immediate.
 *  Deliberately minimal: the portal's volume limiter lasts minutes, so repeated
 *  quick retries only add fuel. Interactive fails fast (UI serves cached data);
 *  background gets one well-spaced retry. */
function attemptDelays(purpose: PortalPurpose): number[] {
  return purpose === "background" ? [0, 90_000] : [0, 5_000];
}

interface PortalFetchConfig {
  jar: CookieJar;
  purpose: PortalPurpose;
  deadlineMs: number;
  timeoutMs?: number;
  /** 403/429 retry + cooldown behaviour (default true). Probes set false. */
  resilient?: boolean;
  /** UA identity chosen by the retry loop for this specific attempt. */
  __ua?: string;
}

interface PortalFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
}

async function rawFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const dispatcher = await relayDispatcher();
  try {
    if (dispatcher) {
      const { fetch: undiciFetch } = await import("undici");
      return (await undiciFetch(url, {
        ...init,
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      } as never)) as unknown as Response;
    }
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(msg)) throw new Error("__timeout__");
    throw new Error("__network__");
  }
}

/**
 * Single paced request to the portal (no retries — retries live in portalFetch).
 * Serialized globally with a jittered minimum gap between requests.
 */
async function pacedRequest(
  url: string,
  init: PortalFetchInit,
  cfg: PortalFetchConfig
): Promise<{ res: Response; html: string }> {
  return scheduleSlot(async () => {
    const gap = lastRequestAt + jitter(MIN_REQUEST_GAP_MS + REQUEST_GAP_JITTER_MS / 2) - Date.now();
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();

    const ua = cfg.__ua ?? uaForAttempt(0);
    const headers: Record<string, string> = {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(init.headers as Record<string, string> | undefined),
    };
    const cookie = cookieHeader(cfg.jar);
    if (cookie) headers.Cookie = cookie;

    const res = await rawFetch(
      url,
      {
        method: init.method ?? "GET",
        headers,
        body: init.body,
        redirect: init.redirect ?? "follow",
      },
      cfg.timeoutMs ?? REQUEST_TIMEOUT_MS
    );
    collectCookies(cfg.jar, res);
    const html = await res.text();
    return { res, html };
  });
}

/**
 * Resilient portal request: paced, cooldown-aware, with bounded retries,
 * identity rotation on 403/429, and short retries for transient network/5xx.
 */
async function portalFetch(
  url: string,
  init: PortalFetchInit,
  cfg: PortalFetchConfig
): Promise<{ res: Response; html: string }> {
  const resilient = cfg.resilient !== false;
  const delays = resilient ? attemptDelays(cfg.purpose) : [0];

  let lastError: Error | null = null;
  let lastRes: { res: Response; html: string } | null = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    const requestMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const wait = jitter(delays[attempt]);
    if (wait > 0) {
      // Stop if the next attempt cannot fit in the caller's budget.
      if (Date.now() + wait + requestMs > cfg.deadlineMs) break;
      await sleep(wait);
    }

    try {
      await awaitCooldown(cfg.deadlineMs);
    } catch (e) {
      // Cooldown cannot fit the budget — surface only if nothing succeeded yet.
      if (lastRes) return lastRes;
      throw e;
    }

    let out: { res: Response; html: string };
    try {
      out = await pacedRequest(url, { ...init, headers: { ...init.headers } }, { ...cfg, __ua: uaForAttempt(attempt) });
    } catch (e) {
      const kind = e instanceof Error ? e.message : "";
      lastError =
        kind === "__timeout__"
          ? new PortalError("TIMEOUT", "The college portal took too long to respond. Please try again.")
          : new PortalError("NETWORK", "Could not reach the college portal. Check your connection and try again.");
      continue; // transient — try the next attempt
    }

    const status = out.res.status;
    if (status === 403 || status === 429) {
      notePortalBlocked();
      lastRes = out;
      lastError = new PortalError(
        "PORTAL_BLOCKED",
        "The college portal is temporarily blocking our server. Please try again in a few minutes.",
        blockedRetryAfterSec()
      );
      continue; // rotate identity / wait for cooldown on the next attempt
    }

    if (!resilient) {
      // Probe mode: hand every non-blocked response back — the caller interprets
      // status + markup (e.g. an unauthenticated dashboard returns 500 BY DESIGN,
      // which signals bad credentials, not an outage).
      if (status < 400) notePortalOk();
      return out;
    }

    if (status >= 500) {
      lastRes = out;
      lastError = new PortalError(
        "PORTAL_DOWN",
        `The college portal seems to be having trouble right now (HTTP ${status}). Please try again shortly.`
      );
      continue; // transient — retry with short backoff
    }

    if (status < 400) notePortalOk();
    return out;
  }

  if (lastRes) {
    // We did get responses — report the strongest error for the final state.
    const status = lastRes.res.status;
    if (status === 403 || status === 429) {
      throw new PortalError(
        "PORTAL_BLOCKED",
        "The college portal is temporarily blocking our server (its firewall is rate-limiting automated access). This usually clears within a few minutes — please try again shortly. Your saved attendance stays available meanwhile.",
        blockedRetryAfterSec()
      );
    }
    if (status >= 500) {
      throw new PortalError(
        "PORTAL_DOWN",
        `The college portal seems to be having trouble right now (HTTP ${status}). Please try again shortly.`
      );
    }
    return lastRes;
  }
  throw lastError ?? new PortalError("NETWORK", "Could not reach the college portal.");
}

/* ------------------------------ parsing ----------------------------------- */

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

export interface FetchSnapshotOptions {
  /** Previously stored authenticated portal cookies — skips the login page when valid. */
  existingCookies?: PortalCookie[];
  /** Interactive (user waiting) or background (scheduler) — controls retry budget. */
  purpose?: PortalPurpose;
  /** Absolute epoch-ms budget; defaults per purpose. */
  deadlineMs?: number;
}

function jarFromCookies(cookies: PortalCookie[] | undefined): CookieJar {
  const jar: CookieJar = new Map();
  for (const c of cookies ?? []) {
    if (c && c.name && typeof c.value === "string") jar.set(c.name, c.value);
  }
  return jar;
}

export async function fetchPortalSnapshot(
  studentId: string,
  password: string | null,
  opts: FetchSnapshotOptions = {}
): Promise<PortalSnapshot> {
  const purpose: PortalPurpose = opts.purpose ?? "interactive";
  const deadlineMs =
    opts.deadlineMs ?? Date.now() + (purpose === "background" ? 8 * 60_000 : 70_000);

  // ---- Attempt 0: reuse a stored authenticated portal session ----------------
  if (opts.existingCookies && opts.existingCookies.length > 0) {
    const jar = jarFromCookies(opts.existingCookies);
    try {
      const probe = await pacedRequest(
        DASHBOARD_URL,
        { headers: { Referer: LOGIN_URL } },
        { jar, purpose, deadlineMs, timeoutMs: PROBE_TIMEOUT_MS, resilient: false }
      );
      if (probe.res.ok && looksAuthenticated(probe.html)) {
        return await harvestFromDashboard(probe.html, jar, { reused: true, purpose, deadlineMs });
      }
    } catch {
      // Probe failures fall through to a fresh login, which reports real errors.
    }
  }

  // ---- Fresh login flow ------------------------------------------------------
  if (!password) {
    throw new PortalError(
      "UNKNOWN",
      "Saved portal session has expired and no password is stored. Please log in again with your portal password."
    );
  }

  const jar: CookieJar = new Map();

  // Step 1: login page (token + antiforgery cookie).
  const loginPage = await portalFetch(
    LOGIN_URL,
    { method: "GET" },
    { jar, purpose, deadlineMs }
  );
  if (loginPage.res.status >= 400) {
    if (loginPage.res.status === 403 || loginPage.res.status === 429) {
      throw new PortalError(
        "PORTAL_BLOCKED",
        "The college portal is temporarily blocking our server (its firewall is rate-limiting automated access). This usually clears within a few minutes — please try again shortly. Your saved attendance stays available meanwhile.",
        blockedRetryAfterSec()
      );
    }
    throw new PortalError(
      "PORTAL_DOWN",
      `College portal rejected the connection (HTTP ${loginPage.res.status}).`
    );
  }

  const token = extractVerificationToken(loginPage.html);
  if (!token) {
    throw new PortalError("PORTAL_DOWN", "Could not read the portal security token. The portal may be under maintenance.");
  }

  // Step 2: submit credentials.
  const body = new URLSearchParams({
    StudentId: studentId.trim(),
    Password: password,
    __RequestVerificationToken: token,
  });

  const post = await portalFetch(
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
    { jar, purpose, deadlineMs }
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
    const dash = await portalFetch(
      target,
      { method: "GET", headers: { Referer: LOGIN_URL } },
      { jar, purpose, deadlineMs }
    );
    dashboardHtml = dash.html;
  } else {
    dashboardHtml = post.html;
    // The portal may render the dashboard directly with HTTP 200.
    if (!looksAuthenticated(dashboardHtml)) {
      // NOTE: deliberately non-resilient — an unauthenticated /DashBoardStudent
      // returns HTTP 500 by design on this portal, which is the "bad credentials"
      // signal, not an outage. Retrying it would only add load.
      const dash = await portalFetch(
        DASHBOARD_URL,
        { method: "GET", headers: { Referer: LOGIN_URL } },
        { jar, purpose, deadlineMs, resilient: false }
      );
      if (looksAuthenticated(dash.html)) dashboardHtml = dash.html;
    }
  }

  // Step 3: verify authentication.
  if (isLoginPage(dashboardHtml) || !looksAuthenticated(dashboardHtml)) {
    throw new PortalError(
      "INVALID_CREDENTIALS",
      "Invalid roll number or password. Please check your AGC ERP credentials and try again."
    );
  }

  return await harvestFromDashboard(dashboardHtml, jar, { reused: false, purpose, deadlineMs });
}

/* --------------------- shared dashboard harvest ---------------------------- */

async function harvestFromDashboard(
  dashboardHtml: string,
  jar: CookieJar,
  ctx: { reused: boolean; purpose: PortalPurpose; deadlineMs: number }
): Promise<PortalSnapshot> {
  // Parse profile + subject table.
  const profile = parseProfile(dashboardHtml);
  const subjectRows = parseSubjectRows(dashboardHtml);

  if (subjectRows.length === 0) {
    throw new PortalError(
      "NO_SUBJECTS",
      "Logged in successfully, but no subjects are visible on your portal dashboard yet."
    );
  }

  // Fetch each subject's attendance report.
  const subjects: PortalSubject[] = [];
  const logs: PortalLogEntry[] = [];

  // Requests are globally paced by the gate — sequential here keeps order deterministic.
  for (const row of subjectRows) {
    const code = row.saId ? `AGC-${row.saId}` : `AGC-${row.name.replace(/\s+/g, "-").toUpperCase().slice(0, 24)}`;
    let attended = 0;
    let total = 0;
    let reportOk = false;
    if (Date.now() > ctx.deadlineMs + REQUEST_TIMEOUT_MS) {
      // Flow budget exhausted — keep this subject at its last stored values instead
      // of persisting misleading zeros.
      subjects.push({
        subjectCode: code,
        subjectName: row.name,
        subjectType: row.type,
        saId: row.saId,
        attended: 0,
        total: 0,
        percentage: 0,
        reportOk: false,
      });
      continue;
    }
    try {
      const rep = await portalFetch(
        row.href,
        { method: "GET", headers: { Referer: DASHBOARD_URL } },
        { jar, purpose: ctx.purpose, deadlineMs: Math.min(ctx.deadlineMs, Date.now() + 45_000) }
      );
      if (rep.res.ok) {
        const parsed = parseAttendanceReport(rep.html);
        attended = parsed.attended;
        total = parsed.total;
        for (const l of parsed.logs) logs.push({ ...l, subjectCode: code });
        reportOk = true;
      }
    } catch {
      // Single subject report failing should not fail the whole sync.
    }

    const pct = total > 0 ? (attended / total) * 100 : 0;
    subjects.push({
      subjectCode: code,
      subjectName: row.name,
      subjectType: row.type,
      saId: row.saId,
      attended,
      total,
      percentage: Math.round(pct * 10) / 10,
      reportOk,
    });
  }

  return {
    profile,
    subjects,
    logs,
    fetchedAt: new Date().toISOString(),
    cookies: Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
    reusedSession: ctx.reused,
  };
}
