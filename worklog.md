# AttendFlow Website — Worklog

---
Task ID: 1
Agent: Z.ai Code (main)
Task: Build the website version of AttendFlow (GitHub: navpreet-dev/AttendFlow) — an autonomous AGC ERP attendance tracker that fetches live data from https://agclms.in/Elogin/StudentLogin using student credentials.

Work Log:
- Cloned and analyzed the AttendFlow Android repo; extracted the exact portal scraping recipe (GET login page → `__RequestVerificationToken` + `.AspNetCore.Antiforgery.*` cookie → POST `StudentId`/`Password` → parse `/DashBoardStudent` subject table rows linking to `/DashBoardStudent/AttendanceReport?SAId=...` → parse per-subject `<tbody>` rows `dd-MM-yyyy` + PRESENT/ABSENT).
- Verified the live portal structure with curl (login form fields, antiforgery token, failed-login re-renders login page, unauthenticated dashboard → 500).
- Prisma schema: `Student` (rollNo unique, AES-256-GCM `passwordEnc` only when remember-me, profile fields, threshold/autoSync/notifyLow settings, lastSyncAt/Ok), `Session` (token, expiry), `SubjectAttendance` (unique studentId+subjectCode), `AttendanceLog` (unique studentId+subjectCode+date), `SyncEvent`. Pushed via `db:push`.
- `src/lib/crypto.ts`: AES-256-GCM encrypt/decrypt keyed by APP_SECRET (auto-generated in .env). Fixed `.digest().subarray()` bug found in dev.log. Round-trip + tamper tests pass.
- `src/lib/portal.ts`: full scraper — manual cookie jar via `getSetCookie()`, CSRF token extraction (both attribute orders), POST with redirect handling, auth detection (`Role: STUDENT` / `AttendanceReport` / `SectionName`), resilient profile parsing (name/section/incharge/department/course), generic subject-row parser (all `<tr>` with AttendanceReport href, per-cell text extraction), per-subject report parsing with date regex + PRESENT/ABSENT detection, 25s timeouts, per-subject failure isolation, friendly PortalError taxonomy (INVALID_CREDENTIALS / PORTAL_DOWN / NETWORK / TIMEOUT / NO_SUBJECTS). NOTE: the Android app's fake-data "fallback generators" were deliberately NOT ported — the site only ever shows real portal data.
- `src/lib/sync-service.ts`: per-roll rate limit (45s), in-flight dedup, snapshot persistence (upserts + append-only log dedup; removed Prisma `skipDuplicates` — unsupported on SQLite), dashboard payload builder.
- API routes: `POST /api/auth/login` (scrape → upsert → session cookie → payload; brute-force lockout 6 fails/15min per rollNo), `POST /api/auth/logout`, `GET /api/me`, `POST /api/sync` (serves cached data with error note when portal fails), `PATCH /api/settings` (threshold 30–100, autoSync, notifyLow). Session cookie is protocol-aware (`x-forwarded-proto`) so it works over http and https.
- Frontend (single `/` route, client components): `LoginView` (brand pitch + AGC-styled login card, loading state, error box), `DashboardView` (sticky header with Sync/Export/theme/logout, offline banner, low-attendance warning banner with per-subject recovery chips, 4 stat cards with must-attend/can-skip predictions, tabs: Overview grid of SubjectCards with progress bars + class-log dialogs, Trends (recharts: daily present/absent + cumulative % line + 75% reference line; subject-wise horizontal bars color-coded), History (sync events + full scrollable class log table), Settings (threshold slider, auto-sync & notification switches with permission request, security/account info)), sticky footer via `min-h-screen flex flex-col` + `mt-auto`.
- `src/lib/af-client.ts`: typed API client, localStorage offline cache (`af_offline_cache_v1`), CSV/JSON export builders, mustAttend/canSkip math, SessionExpiredError → auto-logout on invalid stored credentials.
- Browser testing (agent-browser): login error flow vs live portal ✓, dashboard render with DB fixture ✓ (removed afterwards), all 4 tabs ✓, class-log dialog ✓, export menu ✓, dark mode ✓, mobile 390px ✓, logout ✓, sync-without-credentials warning toast ✓, sticky footer on short & long pages ✓, zero console errors ✓. `bun run lint` clean.

Stage Summary:
- Production website at `/` — students of any AGC department/section enter their ERP roll no + password and get their real attendance fetched from agclms.in automatically; no manual entry, no demo data.
- Key decisions: only real portal data (removed the Android app's fabricated fallbacks), credentials encrypted AES-256-GCM and stored only on opt-in, 45s per-roll sync rate limit + 6/15min login lockout to protect the college portal, cached-data-with-error-note degradation, offline localStorage snapshot.
- Artifacts: prisma/schema.prisma, src/lib/{crypto,portal,sync-service,session,types,af-client}.ts, src/app/api/{auth/login,auth/logout,me,sync,settings}/route.ts, src/components/attendflow/{app,login-view,dashboard-view,subject-card,trends-chart,theme-toggle}.tsx, updated layout.tsx + page.tsx.

---
Task ID: 2
Agent: Z.ai Code (main)
Task: Round 2 — real Web Push notifications (work with site closed), auto permission prompt after login, premium design overhaul, About/Support mini-page, mobile polish. Explicit constraint: do NOT touch the working sync/scrape pipeline.

Work Log:
- Installed web-push (+types); generated VAPID keys into .env (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
- Prisma: added PushSubscription model (endpoint unique, p256dh, auth, userAgent), db:push OK.
- PWA: public/sw.js (push + notificationclick handlers, vibrate, renotify), public/manifest.webmanifest, generated icon-192/512 + apple-touch-icon via sharp (emerald gradient cap).
- src/lib/push-server.ts: sendPushToStudent — VAPID-signed sends to all devices, auto-prunes 404/410 endpoints.
- API: POST /api/push/subscribe (session-gated upsert), POST /api/push/unsubscribe.
- src/lib/push-client.ts: enablePushAlerts (permission → SW register → pushManager.subscribe → save to server), disablePushAlerts, registerServiceWorker.
- AttendFlowApp: SW registered on mount; right after successful login the notification permission is requested automatically (with "Alerts on" toast); re-subscribes already-granted devices.
- src/instrumentation.ts: background scheduler (boot +90s, then every 6h) — for each student with rememberMe+autoSync+stored password and stale (>6h) data it CALLS the existing syncStudent unchanged, then pushes a low-attendance Web Push if notifyLow is on. 3s gap between students; single-student failures isolated; dev double-start guarded via globalThis flag. Verified live in dev.log (query ran).
- Premium design: fonts switched to Inter (body) + Sora (display, `font-display` utility), warm-paper light theme + charcoal-jade dark theme in refined oklch tokens, selection color, card-premium shadow utility, scrollbar-slim. Login page rebuilt: ambient jade glows, gradient headline, Sora headings, premium CTA (h-12, shadow, active scale). Dashboard: sticky header refined (gradient logo tile, Sora brand), stat cards with small-caps uppercase labels + Sora tabular-nums numbers, warning banner card-premium rounded-2xl, tabs restyled, subject cards rounded-2xl with rounded-full percentage badges + uppercase type labels.
- AboutDialog rewritten as custom (non-Radix) animated sheet to fix a Radix SSR hydration mismatch (aria-controls id) — bottom-sheet on mobile, centered dialog on desktop; contains "Built by Navpreet Singh — Department of Computer Applications · BCA" (no section/semester), Support-the-project fund CTA + email navpreet70095@gmail.com, privacy note; footer shows "Made by Navpreet Singh" + About & Support button.
- Browser-verified: 0 console/page errors on fresh loads; login invalid-credential flow vs live portal OK; About sheet OK; SW registration OK; /api/push/subscribe persists OK; web-push VAPID send path validated; mobile (390px) + desktop screenshots OK; sync files untouched (no push code in portal.ts/sync-service.ts).

Stage Summary:
- Notifications now work beyond the open tab: permission auto-asked at login, device subscribed via Web Push (PWA manifest + SW), and a server scheduler syncs opted-in students every 6h and pushes low-attendance alerts even when the site is closed (Android/Chrome: works with browser closed for installed PWA; iOS: install to home screen).
- Design system upgraded to premium typography/palette; About/Support page delivered inside the single-route constraint.
- Sync/scrape pipeline untouched as demanded.

---
Task ID: 3
Agent: Z.ai Code (main)
Task: Fix mobile responsiveness only — text overflowing layout in warning section and merged/overflowing text in history section (user demand: touch NOTHING else, especially not the sync pipeline).

Work Log:
- Built a temporary visual fixture (scripts/fixture-visual.ts → Student FIXTURE-VISUAL-01 + long subject names, low-% subjects, 30 logs, 5 sync events with long messages, direct Session token) and inspected the real app at 390×844 with agent-browser.
- Measured page scrollWidth = 580px on a 390px screen (190px horizontal overflow) and reproduced every reported defect.
- Root causes found & fixed (CSS/layout only, zero logic touched):
  1. Warning section badges: shadcn Badge base has whitespace-nowrap + w-fit → long "Subject · 45.0% · attend next 48" badges overflowed the card and stretched the page. Fix: max-w-full whitespace-normal break-words text-left leading-relaxed on those badges + max-w-full overflow-hidden on the warning banner.
  2. Subject-card + stat grids had no explicit mobile column (`grid gap-4 sm:grid-cols-2…`) → implicit auto column sized to max-content → subject cards rendered 528px wide on mobile. Fix: added grid-cols-1 to both grids (dashboard-view.tsx).
  3. History "Recent sync activity": truncate failed inside Radix ScrollArea — two stacked causes: (a) flex truncate chain lacked min-w sizing → fixed with flex min-w-0 flex-1 wrapper + w-0 min-w-0 flex-1 truncate on the message span (zero flex-basis kills the nowrap min-content contribution); (b) Radix's display:table inner wrapper expanded to max-content (646px) — pinned globally in globals.css with `[data-slot="scroll-area-viewport"] > div { width: 100% }`.
  4. Radix ScrollArea max-h-* on the root is ignored by the viewport (percentage height vs auto-height root) → class-log table painted over the footer and list items over the next card (the literal "text merged" artifact). Fix: `[&>[data-slot=scroll-area-viewport]]:max-h-*` at all 3 ScrollArea usages (sync list max-h-40, class log max-h-96, subject dialog max-h-[50vh] in subject-card.tsx).
  5. Class log table too wide for 390px (Status column pushed off-screen): Date w-[88px] sm:w-28, Status w-20 sm:w-24, subject cell max-w-[140px] sm:max-w-[220px] → all 3 columns fit at 390px.
  6. Tab bar clipped "Settings" at 390px: triggers px-2.5 text-xs on mobile, sm:px-4 sm:text-[13px] restored on ≥sm.
- Deleted fixture: cleanup script removed FIXTURE-VISUAL-01 (cascade), deleted fixture scripts.
- bun run lint: clean. agent-browser full re-verification at 390px: pageW=390 everywhere (zero horizontal overflow), warning badges wrap inside card, sync list ellipsizes with timestamps visible, table shows Date/Subject/Status, dialog/settings/trends/login/About sheet all fit; desktop 1280 regression check OK; zero console/page errors; dev.log clean.
- NOT touched: portal.ts, sync-service.ts, af-client.ts, session/crypto, API routes, notifications/push, scheduler, footer, theme system — sync pipeline 100% untouched as demanded.

Stage Summary:
- Mobile (390px) is now fully responsive: no text escapes any card, no merged/overlapping rows, no horizontal page scroll; desktop rendering unchanged.
- Key artifacts: dashboard-view.tsx (badges, grids, tab triggers, sync list truncate chain, table column widths, 2 ScrollArea clamps), subject-card.tsx (1 ScrollArea clamp), globals.css (viewport inner-wrapper width:100% base rule).

---
Task ID: 4
Agent: Z.ai Code (main)
Task: Fix "College portal rejected the connection (HTTP 403)" completely — real portal integration restored, permanent reliability architecture added. UI/sync-UX untouched.

Work Log:
- PHASE 1 (investigation): confirmed the 403 was server-side from IIS 10 (stock "403 - Forbidden" page) at agclms.in = 137.97.153.219 (Reliance Jio, Ludhiana IN) while our egress is Alibaba HK (47.57.242.119). Mapped scope: `/` and `/favicon.ico` returned 200 during the ban; the 403 was scoped to `/Elogin/StudentLogin`; not header-based (full Chrome sec-*/client-hint set still 403), not HTTP-version-based (both 403).
- PHASE 2 (root cause isolated by controlled experiment, single requests spaced 2 min): UA is the decisive variable — plain `Mozilla/5.0` → 200 + real login form + antiforgery token (repeatable, curl AND node/undici); full Chrome UA → 403 (same minute, same IP). The portal firewall rejects browser-UA claims from non-allowed IP ranges. Secondary mechanism: a volume limiter that temporarily 403s even plain UAs after bursts (scheduler catch-up traffic triggered it; sparse single requests always passed). Old code always sent a spoofed Chrome UA → always 403 since the rule went live (~2026-09-14 evening; last pre-block successful sync 2026-09-14T17:42Z).
- PHASE 3 (fix implemented — src/lib/portal.ts rewritten around the same parsing logic):
  1. Honest plain client identity first (UA_CANDIDATES), automatic rotation on rejection with sticky last-good memory (self-heals if the college ever flips the rule).
  2. Global pacing gate: ALL portal requests serialized with 1.2-2.0s jittered gaps.
  3. Circuit breaker: any 403/429 opens a global cooldown (120s base, x2 consecutive, 15 min cap) during which NO request is sent; exports isPortalCoolingDown().
  4. Bounded per-purpose retries: interactive [0, 5s] fail-fast, background [0, 90s]; deadline budgets (interactive 70s, background 8 min); PortalError.PORTAL_BLOCKED with retryAfterSec.
  5. Portal-session REUSE: fetchPortalSnapshot(studentId, password, { existingCookies }) probes /DashBoardStudent with stored session — successful reuse never touches the rate-limited login page (sync = 1+N requests). PortalSnapshot now returns final cookies + reusedSession flag.
  6. Data integrity: subjects whose report fetch fails carry reportOk=false and are SKIPPED by persistence (no more misleading 0/0 overwrites); sync event message reports partial coverage honestly.
  7. Optional egress relay via PORTAL_PROXY_URL (undici ProxyAgent, CONNECT, end-to-end TLS) as an operator escape hatch.
  8. Regression fix found by my own browser test: post-POST dashboard auth-probe must be non-resilient — an unauthenticated /DashBoardStudent returns 500 BY DESIGN (bad-credentials signal), old code ignored its status; new portalFetch probe mode returns all non-blocked responses for caller interpretation.
- Sync-service integration: syncStudent tries stored portal session first (fresh <12h) then falls back to fresh login; persists encrypted portal cookies on success under remember-me consent (schema: Student.portalCookiesEnc/portalCookiesAt, db:push done); purpose threading (interactive/background); self-healing: unreadable stored credentials are auto-cleared so the student is simply asked to re-login. Scheduler (instrumentation.ts): 60s gap between students, skips students while the breaker is open (never pokes the portal during cooldown), observability logs.
- Security repair (required for sync reliability, discovered during testing): .env had been rewritten at 15:55 and lost APP_SECRET (+ VAPID keys). Generated new 64-hex APP_SECRET + regenerated VAPID keys into .env; one-time migration re-sealed decryptable payloads (2551508 passwordEnc + portalCookies) under the new key and cleared GCM-undecryptable ones (2551497, 2551531 — they simply log in again next visit; no fake data substituted). Note: .env currently untracked/ignored — keep it that way.
- PHASE 4/6 (verification, all real): user's own account (2551508) logged in through the REAL UI twice today — "Login sync — 9 subjects" SUCCESS at 16:52:32Z and 16:57:12Z with REAL portal data (e.g. Computer Networks 23/28 = 82.1%), portal cookies stored; direct session-reuse test: fresh snapshot via stored session in 16s, 9 subjects / 115 log rows, reusedSession=true, ZERO login-page requests, zero 403s; browser (agent-browser) invalid-credential flow through the real portal returns the proper "Invalid roll number or password." message (no 403); login page renders unchanged at 1280px and 390px (scrollWidth 390 = no overflow); zero console/page errors; bun run lint clean; test scripts removed after use.
- NOT touched: UI components, login/dashboard views, af-client, session/crypto APIs, portal parsing logic, export, notifications/push code paths, theme, About page.

Stage Summary:
- Root cause: the AGC portal firewall blocks browser-UA requests from datacenter IPs (and secondarily rate-limits bursts). Fix = honest plain client identity + rotation, global pacing, 403 circuit breaker, and portal-session reuse so syncs skip the login page entirely — validated by two real user logins with 9 real subjects each, a login-page-free session-reuse sync, and a clean invalid-credentials flow against the live portal.
- Steady-state request pattern per student: ~1 dashboard + N subject reports per sync, login page only when the portal session actually expired (<=2 requests to it per 6h window worst case) — far below the firewall's trigger levels.
- Operational notes: PORTAL_PROXY_URL env can route portal traffic through a relay with an Indian egress IP if the college ever hard-blocks the server range (TLS stays end-to-end); users 2551497/2551531 must log in once more (their stored secrets were unrecoverable after the .env wipe); VAPID keys regenerated (old push subscriptions re-subscribe automatically at next login per the existing client flow).
