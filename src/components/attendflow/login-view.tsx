"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { GraduationCap, Loader2, Lock, ShieldCheck, RefreshCw, BellRing, FileDown } from "lucide-react";

interface LoginViewProps {
  onLogin: (rollNo: string, password: string, remember: boolean) => Promise<void>;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [rollNo, setRollNo] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!rollNo.trim() || !password) {
      setError("Please enter both your roll number and password.");
      return;
    }
    setLoading(true);
    try {
      await onLogin(rollNo.trim(), password, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex-1">
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-8 sm:px-8 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16"
        >
          {/* Left: brand + pitch */}
          <div className="order-2 space-y-8 text-center lg:order-1 lg:text-left">
            <div className="inline-flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCap className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="font-display text-xl tracking-tight whitespace-nowrap shrink-0">
                <span className="brand-attend">Attend</span><span className="brand-agc">AGC</span>
              </span>
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-[1.85rem] font-bold leading-[1.15] tracking-[-0.025em] text-balance sm:text-[2.25rem] lg:text-[2.65rem]">
                Your AGC attendance,{" "}
                tracked automatically.
              </h1>
              <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
                Sign in with your AGC ERP credentials — AttendAGC reads your live
                subject-wise attendance straight from the college portal. No manual
                entry, ever. Every department, every course, every section.
              </p>
            </div>

            <div className="grid gap-2.5 text-left sm:grid-cols-2">
              {[
                { icon: RefreshCw, title: "Auto-sync", desc: "Live data pulled from agclms.in every day" },
                { icon: ShieldCheck, title: "Encrypted", desc: "Credentials sealed with AES-256-GCM" },
                { icon: BellRing, title: "Smart alerts", desc: "Low-attendance warnings & notifications" },
                { icon: FileDown, title: "One-click export", desc: "CSV / JSON reports anytime" },
              ].map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3 rounded-lg border border-border/80 bg-card/50 p-3 transition-colors hover:bg-accent/40"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <f.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium tracking-tight">{f.title}</p>
                    <p className="text-xs leading-snug text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <Badge variant="secondary" className="rounded-full px-3 text-xs font-medium">All departments</Badge>
              <Badge variant="secondary" className="rounded-full px-3 text-xs font-medium">All courses</Badge>
              <Badge variant="secondary" className="rounded-full px-3 text-xs font-medium">All sections</Badge>
            </div>
          </div>

          {/* Right: login card */}
          <Card className="card-premium order-1 w-full max-w-md justify-self-center rounded-xl border-border/70 lg:order-2">
            <CardHeader className="space-y-1.5 p-5 pb-3 sm:px-6 sm:pb-4 sm:pt-7">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Lock className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="pt-2.5 text-center font-display text-lg tracking-tight">
                Student Login
              </CardTitle>
              <CardDescription className="text-center text-[13px]">
                Use the same roll number &amp; password as the college portal
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0 sm:px-6 sm:pb-7">
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="rollNo" className="text-[13px] font-medium">Univ. Roll No / Student ID</Label>
                  <Input
                    id="rollNo"
                    name="rollNo"
                    autoComplete="username"
                    placeholder="e.g. 24BCA1234"
                    value={rollNo}
                    onChange={(e) => setRollNo(e.target.value)}
                    disabled={loading}
                    className="h-10 rounded-lg bg-card text-base sm:text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[13px] font-medium">Portal Password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Your AGC ERP password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="h-10 rounded-lg bg-card text-base sm:text-sm"
                    required
                  />
                </div>

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                    disabled={loading}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="remember" className="cursor-pointer text-[13px] font-medium leading-snug">
                      Remember me &amp; auto-sync daily
                    </Label>
                    <p className="text-xs leading-snug text-muted-foreground/80">
                      Credentials stay encrypted on the server
                    </p>
                  </div>
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    role="alert"
                    className="rounded-lg border border-destructive/25 bg-destructive/[0.08] px-3.5 py-2.5 text-sm leading-relaxed text-destructive"
                  >
                    {error}
                  </motion.p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="min-h-11 w-full rounded-lg text-[14px] font-semibold tracking-tight transition-colors duration-150 ease-out active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Connecting to AGC ERP…
                    </>
                  ) : (
                    "Fetch My Attendance"
                  )}
                </Button>
              </form>

              <Separator className="my-5" />
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                AttendAGC logs in to <span className="font-mono text-[11px]">agclms.in</span> on your
                behalf and reads only your own attendance data. Your password is never
                shared with anyone and is stored encrypted only if you tick
                &quot;Remember me&quot;.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
