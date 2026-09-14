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
