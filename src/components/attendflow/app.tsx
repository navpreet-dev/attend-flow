"use client";

import { useCallback, useEffect, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import type { DashboardPayload } from "@/lib/types";
import { apiLogin, apiMe, clearCachedPayload, readCachedPayload } from "@/lib/af-client";
import { LoginView } from "./login-view";
import { DashboardView } from "./dashboard-view";

type Status = "loading" | "anon" | "ready";

export function AttendFlowApp() {
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [offline, setOffline] = useState(false);

  // Boot: check session (fall back to offline cache).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiMe();
        if (cancelled) return;
        if (me) {
          setData(me);
          setStatus("ready");
        } else {
          setStatus("anon");
        }
      } catch {
        if (cancelled) return;
        const cached = readCachedPayload();
        if (cached) {
          setData(cached);
          setOffline(true);
          setStatus("ready");
        } else {
          setStatus("anon");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Track connectivity for the offline banner.
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const handleLogin = useCallback(async (rollNo: string, password: string, remember: boolean) => {
    const payload = await apiLogin(rollNo, password, remember);
    clearCachedPayload();
    setData(payload);
    setOffline(false);
    setStatus("ready");
  }, []);

  const handleData = useCallback((d: DashboardPayload) => {
    setData(d);
    setStatus("ready");
  }, []);

  const handleLogout = useCallback(() => {
    clearCachedPayload();
    setData(null);
    setStatus("anon");
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {status === "loading" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
            <GraduationCap className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking your session…
          </p>
        </div>
      )}

      {status === "anon" && <LoginView onLogin={handleLogin} />}

      {status === "ready" && data && (
        <DashboardView
          data={data}
          offline={offline}
          onData={handleData}
          onLogout={handleLogout}
        />
      )}

      <footer className="mt-auto border-t py-4">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 text-xs text-muted-foreground sm:flex-row">
          <p>
            <span className="font-semibold text-foreground">AttendFlow</span> — autonomous
            attendance tracking for AGC ERP students
          </p>
          <p>
            Data source:{" "}
            <a
              href="https://agclms.in/Elogin/StudentLogin"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              agclms.in/Elogin/StudentLogin
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
