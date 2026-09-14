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
    <div className="relative flex-1 overflow-hidden">
      {/* Ambient jade glow — quiet, not loud */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 right-[-10%] h-[26rem] w-[26rem] rounded-full bg-emerald-500/[0.07] blur-3xl" />
        <div className="absolute bottom-[-12rem] left-[-8%] h-[24rem] w-[24rem] rounded-full bg-teal-500/[0.06] blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16"
        >
          {/* Left: brand + pitch */}
          <div className="order-2 space-y-8 text-center lg:order-1 lg:text-left">
            <div className="inline-flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
                <GraduationCap className="h-5.5 w-5.5" aria-hidden="true" />
              </div>
              <span className="font-display text-xl font-semibold tracking-tight">AttendFlow</span>
            </div>

            <div className="space-y-4">
              <h1 className="font-display text-[2rem] font-bold leading-[1.12] tracking-[-0.02em] text-balance sm:text-4xl lg:text-[2.75rem]">
                Your AGC attendance,{" "}
                <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-400">
                  tracked automatically.
                </span>
              </h1>
              <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
                Sign in with your AGC ERP credentials — AttendFlow reads your live
                subject-wise attendance straight from the college portal. No manual
                entry, ever. Every department, every course, every section.
              </p>
            </div>

            <div className="grid gap-3 text-left sm:grid-cols-2">
              {[
                { icon: RefreshCw, title: "Auto-sync", desc: "Live data pulled from agclms.in every day" },
                { icon: ShieldCheck, title: "Encrypted", desc: "Credentials sealed with AES-256-GCM" },
                { icon: BellRing, title: "Smart alerts", desc: "Low-attendance warnings & notifications" },
                { icon: FileDown, title: "One-click export", desc: "CSV / JSON reports anytime" },
              ].map((f) => (
                <div
                  key={f.title}
                  className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 backdrop-blur-sm transition-colors hover:border-emerald-600/25"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-500">
                    <f.icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold tracking-tight">{f.title}</p>
                    <p className="text-xs leading-snug text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <Badge variant="secondary" className="rounded-full px-3 font-medium">All departments</Badge>
              <Badge variant="secondary" className="rounded-full px-3 font-medium">All courses</Badge>
              <Badge variant="secondary" className="rounded-full px-3 font-medium">All sections</Badge>
            </div>
          </div>

          {/* Right: login card */}
          <Card className="card-premium order-1 w-full max-w-md justify-self-center rounded-2xl border-border/60 lg:order-2">
            <CardHeader className="space-y-1.5 pb-4 pt-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-600/25 ring-1 ring-emerald-700/20">
                <Lock className="h-6 w-6" aria-hidden="true" />
              </div>
              <CardTitle className="pt-3 text-center font-display text-xl tracking-tight">
                Student Login
              </CardTitle>
              <CardDescription className="text-center text-sm">
                Use the same roll number &amp; password as the college portal
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-8">
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="rollNo" className="text-[13px] font-medium">Univ. Roll No / Student ID</Label>
                  <Input
                    id="rollNo"
                    name="rollNo"
                    autoComplete="username"
                    placeholder="e.g. 24BCA1234"
                    value={rollNo}
                    onChange={(e) => setRollNo(e.target.value)}
                    disabled={loading}
                    className="h-11 rounded-xl bg-card"
                    required
                  />
                </div>
                <div className="space-y-2">
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
                    className="h-11 rounded-xl bg-card"
                    required
                  />
                </div>

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                    disabled={loading}
                    className="mt-0.5 h-4.5 w-4.5"
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
                    className="rounded-xl border border-destructive/25 bg-destructive/[0.08] px-3.5 py-2.5 text-sm leading-relaxed text-destructive"
                  >
                    {error}
                  </motion.p>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-12 w-full rounded-xl bg-emerald-600 text-[15px] font-semibold tracking-tight text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30 active:scale-[0.99]"
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

              <Separator className="my-6" />
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                AttendFlow logs in to <span className="font-mono text-[11px]">agclms.in</span> on your
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
